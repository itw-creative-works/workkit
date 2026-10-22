// Tests for the shared parsers' JavaScript port, the hooks/mods/command.js and
// hooks/mods/markers.js exports: each case ports the tests/hooks/lib.test.js
// case its name quotes, whose shell helper the port names. lib.test.js holds
// no case for the gh-edit.js, proof.js or settings.js helpers; the guards'
// suites read those through their verdicts. Not ported: "exit 0 always" (a
// function returns, it has no status), the no-digest-tool refusal (crypto.subtle
// is always there), and hook_pretool_notice (a notice is a `context` now).

const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { mods } = require('../lib/mods-inputs');
const { BASH, NO_RC, shellPath } = require('../lib/platform');
const { mkRepo } = require('../lib/git-repo');

const KIT = path.join(__dirname, '..', '..');

const command = () => mods('command');
const markers = () => mods('markers');

// One walk event in the shell's spelling: `step:<text>`, `open` or `close`.
// An event is `{ kind, text }` (or `[kind, text]`), `dir` beside it in a step walk.
const kindOf = (e) => (Array.isArray(e) ? e[0] : e.kind);
const fieldsOf = (e) => (Array.isArray(e) ? { kind: e[0], dir: e.length > 2 ? e[1] : undefined, text: e[e.length - 1] } : e);

const SHA1_THING = '15da8f6dacb5c1cbf08b4fbd577410882e5c5ae4';

const run = async () => {
  group('command: redirectSpan');

  // Each word as a guard's walk hands it over: the quote strip has already
  // turned a quoted span into `_hookq_`.
  await test('ports "a bare operator hands its target to the next word": a span of 2', () => {
    for (const w of ['>', '>>', '<', '<<<', '&>', '&>>', '>|', '2>', '2>>', '0<', '<<']) {
      assertEq(command().redirectSpan(w), 2, `${w} is bare`);
    }
  });

  await test('ports "an attached operator carries its target": a span of 1', () => {
    for (const w of ['2>&1', '>file', '2>>err', '&>all', '0<in', '3>&-', '<<<msg', '>_hookq_']) {
      assertEq(command().redirectSpan(w), 1, `${w} is attached`);
    }
  });

  await test('ports "a plain argument or a quoted placeholder is no redirect": a span of 0', () => {
    for (const w of ['app.js', '-m', '-', '2', '_hookq_', 'a>b', '&']) {
      assertEq(command().redirectSpan(w), 0, `${w} is no redirect`);
    }
  });

  await test('ports "hook_redirect_span: 2 for bare, 1 for attached, 0 for no redirect"', () => {
    const words = { '>': 2, '2>': 2, '<<<': 2, '2>&1': 1, '>file': 1, '2>1': 1, 'app.js': 0, 'a>b': 0, '_hookq_': 0 };
    for (const [w, n] of Object.entries(words)) assertEq(command().redirectSpan(w), n, `the span of ${w}`);
  });

  group('command: foldRedirectAmp');

  await test('ports "hook_fold_redirect_amp: a redirect\'s & is folded, a clause separator is kept"', () => {
    assertEq(command().foldRedirectAmp('git clean 2>&1 -f &>/dev/null <&3 & ls && pwd'),
      'git clean 2>1 -f >/dev/null <3 & ls && pwd', 'the folded text');
  });

  group('command: findGitCommit');

  await test('ports "hook_find_git_commit: a redirect between git and its subcommand never hides it"', () => {
    for (const cmd of ['git 2>&1 commit -m "x"', 'git > /tmp/o commit -m "x"', 'git -C . 2>/dev/null commit -m "x"']) {
      assert(/commit/.test(command().findGitCommit(cmd).clause || ''), `${cmd} is a commit clause`);
    }
  });

  await test('ports "hook_find_git_commit: a redirect between an interpreter and its -c string never hides it"', () => {
    for (const cmd of ['bash 2>&1 -c "git commit -m x"', 'sh > /tmp/o -c "git commit -m x"']) {
      assertEq(Boolean(command().findGitCommit(cmd).wrapped), true, `${cmd} wraps a commit`);
    }
  });

  await test('ports "hook_find_git_commit: a quoted redirect target is counted, so the right span is judged"', () => {
    for (const [cmd, want] of [
      ['bash > "out file" -c "git commit -m x"', true],
      ['bash > "git commit" -c "echo hi"', false],
      ['> "git commit" bash -c "echo hi"', false],
    ]) {
      assertEq(Boolean(command().findGitCommit(cmd).wrapped), want, `${cmd} wraps a commit`);
    }
  });

  await test('ports "hook_find_git_commit: a redirect before the command word never ends the peel"', () => {
    for (const cmd of ['2>&1 git commit -m "x"', '> /tmp/out git commit -m "x"']) {
      assert(/git commit/.test(command().findGitCommit(cmd).clause || ''), `${cmd} is a commit clause`);
    }
  });

  await test('ports "hook_find_git_commit: the one peel reads a commit, and a cd before it, past every prefix"', () => {
    for (const cmd of ['time git commit -m x', 'if git commit -m x', '\\git commit -m x', '! git commit -m x']) {
      assert(/git commit/.test(command().findGitCommit(cmd).clause || ''), `${cmd} is a commit clause`);
    }
    for (const cmd of ['builtin cd /x && git commit -m x', 'X=1 cd /x && git commit -m x']) {
      assertEq(Boolean(command().findGitCommit(cmd).sawCd), true, `${cmd} changes directory before the commit`);
    }
  });

  group('command: clauseChangesDir');

  // The clause as its words, the shell's unquoted `$c` split, as HEAD called it.
  const changesDir = (clause) => command().clauseChangesDir(clause.split(/\s+/).filter(Boolean));

  await test('ports "hook_clause_changes_dir: a cd, pushd or popd past the peeled prefixes, and nothing else"', () => {
    for (const clause of ['cd /x', 'pushd /x', 'popd', '(cd /x', '( cd /x', '{ cd /x', 'command cd /x',
      'env cd /x', 'X=1 cd /x', '2>/dev/null cd /x', '> out cd /x', 'builtin cd /x', 'time cd /x', '! cd /x',
      '\\cd /x', '(\\cd /x', 'if cd /x', 'then cd /x', 'elif cd /x', 'else cd /x', 'do cd /x', 'while cd /x',
      'until cd /x']) {
      assertEq(changesDir(clause), true, `${clause} changes directory`);
    }
    for (const clause of ['gh issue close 7', 'echo cd', 'git commit -m _hookq_', 'cdx /x', '']) {
      assertEq(changesDir(clause), false, `${clause || '(empty)'} changes no directory`);
    }
  });

  group('command: the command walk');

  const stepsOf = (cmd) => command().cmdSteps(cmd).map((e) => {
    const { kind, text } = fieldsOf(e);
    return kind === 'step' ? `step:${text.trim()}` : kind;
  });

  await test('ports "hook_cmd_steps: one step per ;, &&, ||, | and newline"', () => {
    assertEq(stepsOf('a 1 ; b 2 && c || d | e\nf').join(','), 'step:a 1,step:b 2,step:c,step:d,step:e,step:f', 'the steps');
  });

  await test('ports "hook_cmd_steps: open and close for each parenthesis, nested"', () => {
    assertEq(stepsOf('( (cd /x) ; b ) && c').join(','), 'open,open,step:cd /x,close,step:b,close,step:c', 'the events');
  });

  await test('ports "hook_cmd_steps: a blank step is dropped"', () => {
    assertEq(stepsOf('\na ;\n\n ; b ;').join(','), 'step:a,step:b', 'the steps');
  });

  await test('ports "hook_cd_step: an absolute folder, or a relative one joined to its base"', () => {
    assertEq(command().cdStep('/b/base', 'cd /abs/x'), '/abs/x', 'an absolute folder is itself');
    assertEq(command().cdStep('/b/base', 'cd sub/x'), '/b/base/sub/x', 'a relative folder joins a non-empty base');
    assertEq(command().cdStep('', 'cd sub/x'), 'sub/x', 'a relative folder with an empty base stays relative');
    assertEq(command().cdStep('?', 'cd sub/x'), '?', 'a relative folder from an unknown base is unknown');
  });

  await test('ports "hook_cd_step: every form it cannot follow is ?"', () => {
    for (const step of ['pushd /x', 'popd', 'env cd /x', 'cd -P /x', 'cd ~/x', 'cd $X', 'cd a b']) {
      assertEq(command().cdStep('/b/base', step), '?', `${step} is refused`);
    }
  });

  await test('ports "hook_unquote_word: one pair of matching quotes is stripped, anything else is left alone"', () => {
    for (const [word, want] of [['"cd"', 'cd'], ["'cd'", 'cd'], ['""', ''], ['"\'cd\'"', "'cd'"],
      ['cd', 'cd'], ['"cd\'', '"cd\''], ['"cd', '"cd'], ['"a"b', '"a"b'], ['"', '"']]) {
      assertEq(command().unquoteWord(word), want, `${word} unquoted`);
    }
  });

  // Each step as `folder|text`; the empty folder is the session's own.
  const dirsOf = (cmd) => command().stepDirs(cmd)
    .filter((e) => (kindOf(e) ?? 'step') === 'step')
    .map((e) => {
      const { dir, text } = fieldsOf(e);
      return `${dir}|${text.trim()}`;
    });

  await test('ports "hook_step_dirs: each step with the folder it runs in, two cd steps chained"', () => {
    assertEq(dirsOf('ls ; cd /a && cd b && ls').join(','), '|ls,|cd /a,/a|cd b,/a/b|ls', 'the steps and their folders');
  });

  await test('ports "hook_step_dirs: a subshell\'s cd is undone at its )"', () => {
    assertEq(dirsOf('(cd /a && ls) ; ls').join(','), '|cd /a,/a|ls,|ls', 'the steps and their folders');
  });

  group('markers: the marker paths');

  // TMPDIR is handed over explicitly: the marker lives under whatever temp dir
  // the session has, keyed by the sha1 of the root (SHA1_THING, of /repos/thing).
  const TMP = '/w/tmp';

  await test('ports "hook_review_marker_path is the review marker dir plus the sha of the root"', async () => {
    assertEq(await markers().reviewMarkerPath('/repos/thing', TMP), `${TMP}/claude-review-marker/${SHA1_THING}`, 'the path');
  });

  await test('ports "hook_review_full_marker_path is the full-panel marker dir plus the sha of the root"', async () => {
    assertEq(await markers().reviewFullMarkerPath('/repos/thing', TMP), `${TMP}/claude-review-full-marker/${SHA1_THING}`, 'the path');
  });

  await test('ports "hook_triage_marker_path is the triage marker dir plus the sha of the anchor"', async () => {
    assertEq(await markers().triageMarkerPath('/repos/thing', TMP), `${TMP}/claude-triage-marker/${SHA1_THING}`, 'the path');
  });

  await test('ports "wk_suite_marker_path is the suite marker dir plus the sha of the root"', async () => {
    assertEq(await markers().suiteMarkerPath('/repos/thing', TMP), `${TMP}/claude-suite-marker/${SHA1_THING}`, 'the path');
  });

  await test('ports "hook_session_marker is the named dir plus the session id with every non-alphanumeric as _"', async () => {
    assertEq(await markers().sessionMarker('workkit-thing', 'ab-12/c.d e', TMP), `${TMP}/workkit-thing/ab_12_c_d_e`, 'the path');
  });

  group('markers: shellDirOf and tempDirOf, the folder Git Bash means by a path and by ${TMPDIR:-/tmp}');

  // The Windows inputs are handed over, so every branch runs on any platform.
  const WIN = { TEMP: 'D:\\a\\_temp', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' };

  await test('off Windows TMPDIR is the answer as given, /tmp when unset', () => {
    assertEq(markers().tempDirOf({ TMPDIR: '/var/folders/gx/T/', ...WIN }, 'darwin'), '/var/folders/gx/T/', 'as given');
    assertEq(markers().tempDirOf({ ...WIN }, 'linux'), '/tmp', 'unset reads /tmp, whatever TEMP says');
  });

  await test('on Windows /tmp, unset or with a rest, is the Windows temp folder plus the rest', () => {
    assertEq(markers().tempDirOf({ ...WIN }, 'win32'), 'D:/a/_temp', 'unset is TEMP');
    assertEq(markers().tempDirOf({ TMPDIR: '/tmp', ...WIN }, 'win32'), 'D:/a/_temp', '/tmp is TEMP');
    assertEq(markers().tempDirOf({ TMPDIR: '/tmp/cg-x/', ...WIN }, 'win32'), 'D:/a/_temp/cg-x', 'the rest kept, its trailing slash off');
    const local = { LOCALAPPDATA: WIN.LOCALAPPDATA };
    assertEq(markers().tempDirOf({ TMPDIR: '/tmp/cg-x', ...local }, 'win32'), 'C:/Users/x/AppData/Local/Temp/cg-x', 'no TEMP: %LOCALAPPDATA%\\Temp');
    assertEq(markers().tempDirOf({ TEMP: '/tmp', ...local }, 'win32'), 'C:/Users/x/AppData/Local/Temp', 'a POSIX TEMP names no Windows folder');
  });

  await test('on Windows a native TMP outranks TEMP, as Git Bash mounts /tmp on it', () => {
    assertEq(markers().tempDirOf({ TMPDIR: '/tmp/cg-x', TMP: 'C:\\Users\\x\\Tmp', ...WIN }, 'win32'), 'C:/Users/x/Tmp/cg-x', 'TMP first');
    assertEq(markers().tempDirOf({ TMP: '/tmp', ...WIN }, 'win32'), 'D:/a/_temp', 'a POSIX TMP falls through to TEMP');
  });

  await test('on Windows the /<drive>/ form is that drive', () => {
    assertEq(markers().tempDirOf({ TMPDIR: '/d/a/_temp/cg-x', ...WIN }, 'win32'), 'D:/a/_temp/cg-x', 'the drive form');
  });

  await test('on Windows a native path is as given, in forward slashes', () => {
    assertEq(markers().tempDirOf({ TMPDIR: 'D:\\a\\_temp\\cg-x\\', ...WIN }, 'win32'), 'D:/a/_temp/cg-x', 'backslashes');
    assertEq(markers().tempDirOf({ TMPDIR: 'E:/scratch', ...WIN }, 'win32'), 'E:/scratch', 'forward slashes');
  });

  await test('shellEnvOf: TMPDIR, WORKFLOW_HOME and HOME are the folders they name; an unset one stays unset', () => {
    const got = markers().shellEnvOf({ TMPDIR: '/tmp/cg-x', WORKFLOW_HOME: '/c/Users/x/wk', HOME: '/c/Users/x', X: '1', ...WIN }, 'win32');
    assertEq(got.TMPDIR, 'D:/a/_temp/cg-x', 'TMPDIR');
    assertEq(got.WORKFLOW_HOME, 'C:/Users/x/wk', 'WORKFLOW_HOME');
    assertEq(got.HOME, 'C:/Users/x', 'HOME');
    assertEq(got.X, '1', 'the rest rides along');
    const unset = markers().shellEnvOf({ ...WIN }, 'win32');
    assertEq(unset.TMPDIR, 'D:/a/_temp', 'TMPDIR unset reads /tmp');
    assert(!('WORKFLOW_HOME' in unset) && !('HOME' in unset), 'an unset folder is not added');
    assertEq(markers().shellEnvOf({ TMPDIR: '/var/t', HOME: '/Users/x' }, 'darwin').HOME, '/Users/x', 'off Windows as given');
  });

  await test('guards: the facts carry TMPDIR as the folder it names, by the kit root\'s spelling', async () => {
    const io = { pluginRoot: 'C:/kit', top: async () => null, read: async () => null, run: async () => null, stat: async () => null, now: () => 0 };
    const call = { command: 'true', cwd: '/r' };
    assertEq(mods('guards').bashFacts(io, { TMPDIR: '/tmp/cg-x', ...WIN }, call).env.TMPDIR, 'D:/a/_temp/cg-x', 'a drive-letter kit translates');
    assertEq(mods('guards').bashFacts({ ...io, pluginRoot: '/kit' }, { TMPDIR: '/tmp/cg-x', ...WIN }, call).env.TMPDIR, '/tmp/cg-x', 'a POSIX kit reads it as given');
    assertEq(mods('guards').bashFacts(io, { WORKFLOW_HOME: '/c/Users/x/wk', ...WIN }, call).env.WORKFLOW_HOME, 'C:/Users/x/wk', 'the machine folder too');
    const chain = await mods('guards').runChain(io, { TMPDIR: '/tmp/cg-x', ...WIN }, [{ hook: 'safety:issue-guard', run: async (facts) => ({ context: facts.env.TMPDIR }) }], { tool: 'Write', gateDir: undefined });
    assertEq(chain.notice, 'D:/a/_temp/cg-x', 'the file chain\'s facts translate the same');
  });

  group('tree-hash.sh: the module\'s entry to wk_tree_hash');

  await test('given bash workflow/lib/tree-hash.sh <repo> and wk_tree_hash on the same tree, then equal ids', () => {
    const w = mkRepo('tree-hash-', { 'a.txt': 'a\n' });
    w.write('staged.txt', 'staged\n');
    w.git('add', 'staged.txt');
    w.write('a.txt', 'a, unstaged\n');
    const repo = shellPath(w.repo);
    const sh = (args) => spawnSync(BASH, [...NO_RC, ...args], { env: w.env, encoding: 'utf8' });
    const entry = sh([shellPath(path.join(KIT, 'workflow', 'lib', 'tree-hash.sh')), repo]);
    // Sourced as workflow/prove.sh sources it: the hooks' library brings the
    // engine's platform and suite records with it.
    const lib = sh(['-c', '. "$1"; wk_tree_hash "$2"', 'sh', shellPath(path.join(KIT, 'hooks', '_lib.sh')), repo]);
    assertEq(entry.status, 0, `tree-hash.sh exits 0, got: ${entry.stderr}`);
    assertEq(lib.status, 0, `wk_tree_hash answers, got: ${lib.stderr}`);
    assert(/^[0-9a-f]{40}\n$/.test(entry.stdout), `one 40-hex line, got: ${JSON.stringify(entry.stdout)}`);
    assertEq(entry.stdout, lib.stdout, 'the entry prints the id wk_tree_hash prints');
  });

  group('command.js: wordsOf');

  await test('wordsOf splits a clause on blanks, dropping the empty words', () => {
    const { wordsOf } = mods('command');
    assertEq(JSON.stringify(wordsOf('  gh  issue\tedit 12 ')), JSON.stringify(['gh', 'issue', 'edit', '12']), 'runs of spaces and tabs are one break');
    assertEq(JSON.stringify(wordsOf('')), '[]', 'an empty clause has no words');
    assertEq(JSON.stringify(wordsOf('   ')), '[]', 'nor does a blank one');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
