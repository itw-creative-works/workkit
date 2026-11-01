// Tests for the shared parsers' JavaScript port, the hooks/mods/command.js and
// hooks/mods/markers.js exports: each case ports the test/hooks/lib.test.js
// case its name quotes, whose shell helper the port names. lib.test.js holds
// no case for the proof.js or settings.js helpers; the guards' suites read
// those through their verdicts. Not ported: "exit 0 always" (a
// function returns, it has no status), the no-digest-tool refusal (crypto.subtle
// is always there), and hook_pretool_notice (a notice is a `context` now).

const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { mods } = require('../lib/mods-inputs');
const { OPT_IN_SHAPES } = require('../lib/git-repo');

const command = () => mods('command');
const markers = () => mods('markers');

// One walk event in the shell's spelling: `step:<text>`, `open` or `close`.
// An event is `{ kind, text }` (or `[kind, text]`), `dir` beside it in a step walk.
const kindOf = (e) => (Array.isArray(e) ? e[0] : e.kind);
const fieldsOf = (e) => (Array.isArray(e) ? { kind: e[0], dir: e.length > 2 ? e[1] : undefined, text: e[e.length - 1] } : e);

const SHA1_THING = '15da8f6dacb5c1cbf08b4fbd577410882e5c5ae4';

const cases = async () => {
  group('command: redirectSpan');

  // Each word as a guard's walk hands it over: the quote strip has already
  // turned a quoted span into `_hookq_`.
  await test('a bare operator hands its target to the next word: a span of 2', () => {
    for (const w of ['>', '>>', '<', '<<<', '&>', '&>>', '>|', '2>', '2>>', '0<', '<<']) {
      assertEq(command().redirectSpan(w), 2, `${w} is bare`);
    }
  });

  await test('an attached operator carries its target: a span of 1', () => {
    for (const w of ['2>&1', '>file', '2>>err', '&>all', '0<in', '3>&-', '<<<msg', '>_hookq_']) {
      assertEq(command().redirectSpan(w), 1, `${w} is attached`);
    }
  });

  await test('a plain argument or a quoted placeholder is no redirect: a span of 0', () => {
    for (const w of ['app.js', '-m', '-', '2', '_hookq_', 'a>b', '&']) {
      assertEq(command().redirectSpan(w), 0, `${w} is no redirect`);
    }
  });

  group('command: foldRedirectAmp');

  await test('hook_fold_redirect_amp: a redirect\'s & is folded, a clause separator is kept', () => {
    assertEq(command().foldRedirectAmp('git clean 2>&1 -f &>/dev/null <&3 & ls && pwd'),
      'git clean 2>1 -f >/dev/null <3 & ls && pwd', 'the folded text');
  });

  group('command: the command walk');

  await test('hook_cd_step: an absolute folder, or a relative one joined to its base', () => {
    assertEq(command().cdStep('/b/base', 'cd /abs/x'), '/abs/x', 'an absolute folder is itself');
    assertEq(command().cdStep('/b/base', 'cd sub/x'), '/b/base/sub/x', 'a relative folder joins a non-empty base');
    assertEq(command().cdStep('', 'cd sub/x'), 'sub/x', 'a relative folder with an empty base stays relative');
    assertEq(command().cdStep('?', 'cd sub/x'), '?', 'a relative folder from an unknown base is unknown');
  });

  await test('hook_cd_step: every form it cannot follow is ?', () => {
    for (const step of ['pushd /x', 'popd', 'env cd /x', 'cd -P /x', 'cd ~/x', 'cd $X', 'cd a b']) {
      assertEq(command().cdStep('/b/base', step), '?', `${step} is refused`);
    }
  });

  // Each step as `folder|text`; the empty folder is the session's own.
  const dirsOf = (cmd) => command().stepDirs(cmd)
    .filter((e) => (kindOf(e) ?? 'step') === 'step')
    .map((e) => {
      const { dir, text } = fieldsOf(e);
      return `${dir}|${text.trim()}`;
    });

  await test('hook_step_dirs: each step with the folder it runs in, two cd steps chained', () => {
    assertEq(dirsOf('ls ; cd /a && cd b && ls').join(','), '|ls,|cd /a,/a|cd b,/a/b|ls', 'the steps and their folders');
  });

  await test('hook_step_dirs: a subshell\'s cd is undone at its )', () => {
    assertEq(dirsOf('(cd /a && ls) ; ls').join(','), '|cd /a,/a|ls,|ls', 'the steps and their folders');
  });

  group('markers: the marker paths');

  // The workflow home is handed over explicitly: the marker lives under its
  // markers folder, keyed by the sha1 of the root (SHA1_THING, of /repos/thing).
  // A session marker lives under the session's TMPDIR.
  const WH = '/w/home/.workkit';
  const TMP = '/w/tmp';

  await test('hook_review_marker_path is the review marker dir plus the sha of the root', async () => {
    assertEq(await markers().reviewMarkerPath('/repos/thing', WH), `${WH}/markers/claude-review-marker/${SHA1_THING}`, 'the path');
  });

  await test('hook_review_full_marker_path is the full-panel marker dir plus the sha of the root', async () => {
    assertEq(await markers().reviewFullMarkerPath('/repos/thing', WH), `${WH}/markers/claude-review-full-marker/${SHA1_THING}`, 'the path');
  });

  await test('hook_triage_marker_path is the triage marker dir plus the sha of the anchor', async () => {
    assertEq(await markers().triageMarkerPath('/repos/thing', WH), `${WH}/markers/claude-triage-marker/${SHA1_THING}`, 'the path');
  });

  await test('wk_suite_marker_path is the suite marker dir plus the sha of the root', async () => {
    assertEq(await markers().suiteMarkerPath('/repos/thing', WH), `${WH}/markers/claude-suite-marker/${SHA1_THING}`, 'the path');
  });

  await test('hook_session_marker is the named dir plus the session id with every non-alphanumeric as _', async () => {
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
    // The file chain's folder is an opted-in repo, so the guard below runs.
    const read = async (p) => (p === '/r/.workkit/settings.json' ? OPT_IN_SHAPES.current : null);
    const io = { pluginRoot: 'C:/kit', top: async () => '/r', read, run: async () => null, stat: async () => null, now: () => 0 };
    const call = { command: 'true', cwd: '/r' };
    assertEq(mods('guards').bashFacts(io, { TMPDIR: '/tmp/cg-x', ...WIN }, call).env.TMPDIR, 'D:/a/_temp/cg-x', 'a drive-letter kit translates');
    assertEq(mods('guards').bashFacts({ ...io, pluginRoot: '/kit' }, { TMPDIR: '/tmp/cg-x', ...WIN }, call).env.TMPDIR, '/tmp/cg-x', 'a POSIX kit reads it as given');
    assertEq(mods('guards').bashFacts(io, { WORKFLOW_HOME: '/c/Users/x/wk', ...WIN }, call).env.WORKFLOW_HOME, 'C:/Users/x/wk', 'the machine folder too');
    const chain = await mods('guards').runChain(io, { TMPDIR: '/tmp/cg-x', ...WIN }, [{ hook: 'safety:vendor-guard', run: async (facts) => ({ context: facts.env.TMPDIR }) }], { tool: 'Write', gateDir: '/r' });
    assertEq(chain.notice, 'D:/a/_temp/cg-x', 'the file chain\'s facts translate the same');
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
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
