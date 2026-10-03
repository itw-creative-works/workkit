/* eslint-disable no-console */
// Tests for hooks/_lib.sh, the helper library every hook sources: one group per
// helper, from the platform seam and hook_sha1 through hook_jq, the manager
// config, the prompt shape, the session model, the notice, the deadline wait,
// the test-path shapes and the marker paths. The suite and qa records are
// tests/hooks/lib-record.test.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, skip, testUnless, skipSuite, selfRun, summary,
} = require('../lib/harness');
const {
  IS_WINDOWS, BASH, SYSTEM_PATH, NO_RC, NO_EXEC_BIT,
  shellPath, which, digestTool, stubTool, crlfJq, systemPathWith,
} = require('../lib/platform');
const { mkTmp } = require('../lib/scratch');
const { runLib } = require('../lib/hook-lib');

const SHA1_ABC = 'a9993e364706816aba3e25717850c26c9cd0d89d';

// A tool this machine has, by absolute path, through the platform seam: the
// digest lookups ask SYSTEM_PATH, the world the shims below are built against;
// everything else asks the session's own PATH, since jq is a Homebrew or winget
// install, never in /usr/bin.

// A PATH world holding exactly one digest tool, under the name given.
const digestWorld = (name, real) => {
  const dir = mkTmp('lib-sha1-');
  // Under the name the case is asking about, which is the whole point: the tool
  // this machine ships, wearing the other machine's spelling.
  stubTool(dir, name, ['#!/bin/bash', `exec "${shellPath(real)}" "$@"`]);
  return dir;
};

const run = async () => {
  const real = digestTool(SYSTEM_PATH);
  if (!real) {
    skipSuite('this machine has neither shasum nor sha1sum, so no digest world can be built');
  }

  group('_lib.sh: hook_sha1');

  await test('a world with only shasum: the hex digest of stdin, no filename', () => {
    const world = digestWorld('shasum', real);
    const out = runLib("printf '%s' abc | hook_sha1", { PATH: world });
    assertEq(out.stdout.trim(), SHA1_ABC, `the sha1 of abc, got: ${out.stdout}|${out.stderr}`);
    fs.rmSync(world, { recursive: true, force: true });
  });

  await test('a world with only sha1sum: the same digest, same shape', () => {
    const world = digestWorld('sha1sum', real);
    const out = runLib("printf '%s' abc | hook_sha1", { PATH: world });
    assertEq(out.stdout.trim(), SHA1_ABC, `the sha1 of abc, got: ${out.stdout}|${out.stderr}`);
    fs.rmSync(world, { recursive: true, force: true });
  });

  await test('a world with neither: non-zero, one line on stderr, never an empty key', () => {
    const world = mkTmp('lib-nosha-');
    const out = runLib("key=$(printf '%s' abc | hook_sha1); printf 'rc=%s key=[%s]' \"$?\" \"$key\"",
      { PATH: world });
    assert(out.stdout.includes('key=[]'), `no key at all, got: ${out.stdout}`);
    assert(!out.stdout.includes('rc=0'), `and says so, got: ${out.stdout}`);
    assert(/shasum/.test(out.stderr) && /sha1sum/.test(out.stderr),
      `the line names both spellings, got: ${out.stderr}`);
    assertEq(out.stderr.trim().split('\n').length, 1, `one line, got: ${out.stderr}`);
    fs.rmSync(world, { recursive: true, force: true });
  });

  group('_lib.sh: the platform seam');

  await test('OSTYPE answers with no uname on PATH: msys is Windows', () => {
    const out = runLib('hook_is_windows && echo win; hook_is_macos && echo mac; hook_is_linux && echo linux',
      { OSTYPE: 'msys', PATH: '' });
    assertEq(out.stdout.trim(), 'win', `Git Bash reads as Windows and nothing else, got: ${out.stdout}`);
  });

  await test('OSTYPE linux-gnu is Linux, darwin is macOS, each exclusive', () => {
    const linux = runLib('hook_is_linux && echo linux; hook_is_windows && echo win; hook_is_macos && echo mac',
      { OSTYPE: 'linux-gnu', PATH: '' });
    assertEq(linux.stdout.trim(), 'linux', `got: ${linux.stdout}`);
    const mac = runLib('hook_is_macos && echo mac; hook_is_windows && echo win; hook_is_linux && echo linux',
      { OSTYPE: 'darwin24', PATH: '' });
    assertEq(mac.stdout.trim(), 'mac', `got: ${mac.stdout}`);
  });

  await test('an OSTYPE this split does not know falls back to uname -s', () => {
    // The reference reading is taken in a shell started exactly as the helper's
    // is: under Git Bash the answer depends on the environment the shell
    // carries (MSYS_NT without MSYSTEM set, MINGW64_NT with it), so a reading
    // from anywhere else would be comparing two different questions.
    const uname = runLib('uname -s').stdout.trim();
    const out = runLib('hook_uname_s; printf "%s" "$HOOK_UNAME_S"', { OSTYPE: 'plan9' });
    assertEq(out.stdout.trim(), uname, `the shell's own answer, got: ${out.stdout}`);
  });

  await test('Git Bash asks for real symlinks once, however often the seam is sourced', () => {
    const seam = shellPath(path.join(__dirname, '..', '..', 'workflow', 'lib', 'platform.sh'));
    // The seed is set in the shell, never in the env: a real MSYS runtime reads
    // MSYS at start, and `noglob` changes how it parses bash's own command line.
    const win = runLib(`MSYS=noglob; . "${seam}"; . "${seam}"; printf '%s' "$MSYS"`, { OSTYPE: 'msys' });
    assertEq(win.stdout, 'noglob winsymlinks:nativestrict', `appended once to the list, got: ${win.stdout}|${win.stderr}`);
    const mac = runLib('printf "%s" "${MSYS-unset}"', { OSTYPE: 'darwin24' });
    assertEq(mac.stdout, 'unset', `macOS sets nothing, got: ${mac.stdout}`);
  });

  await test('the reading is cached: a set HOOK_UNAME_S is never re-probed', () => {
    const out = runLib('hook_is_linux && echo linux', { HOOK_UNAME_S: 'Linux', PATH: '' });
    assertEq(out.stdout.trim(), 'linux', `the cache decides, got: ${out.stdout}`);
  });

  group('_lib.sh: hook_jq');

  // A jq that writes CRLF, as the winget build does on Windows: the platform
  // seam builds it, since the standards suite asks the same machine the same
  // question about the engine's own `wk_jq`.
  const crlfWorld = () => {
    const dir = mkTmp('lib-crlf-jq-');
    crlfJq(dir);
    return dir;
  };

  await test('hook_jq strips the carriage returns of a text-mode jq, on every line', () => {
    // jq's own output proves the stub; hook_jq's is the same lines with nothing
    // left on them, which is the engine's wk_jq answering through the pointer.
    const dir = crlfWorld();
    const env = { PATH: systemPathWith(dir) };
    const filter = `printf '%s' '{"v":["a","b","c"]}' |`;
    assertEq(runLib(`${filter} jq -r '.v[]'`, env).stdout, 'a\r\nb\r\nc\r\n', 'the stub jq writes CRLF');
    assertEq(runLib(`${filter} hook_jq -r '.v[]'`, env).stdout, 'a\nb\nc\n', 'hook_jq hands on LF');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('hook_jq hands back jq\'s own exit status, never the strip\'s', () => {
    // A caller that asks a question (`jq -e`, `jq empty`) reads the status and
    // nothing else, and a wrapper ending in a pipe would answer every one of
    // them yes. safety/release-taken leans on it: `patterns=$(hook_jq ...) ||
    // patterns=""` is how it survives a package.json it cannot read.
    const dir = crlfWorld();
    const env = { PATH: systemPathWith(dir) };
    const ask = (json) => runLib(`printf '%s' '${json}' | hook_jq -e '.v' >/dev/null; printf '%s' "$?"`, env).stdout;
    assertEq(ask('{"v":true}'), '0', 'a true answer is 0');
    assertEq(ask('{"v":false}'), '1', '`-e` says false with 1');
    assertEq(runLib(`printf 'not json' | hook_jq . >/dev/null 2>&1; printf '%s' "$?"`, env).stdout, '5',
      'a parse failure is jq\'s own 5');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('hook_jq_default takes the default only when jq answered nothing', () => {
    // A jq that fails on a stream's tail has already written the first value's
    // answer, so a `|| printf <default>` would hand back the two stuck
    // together. The default is for silence alone.
    const severed = `printf '%s' '{"v":"kept"}{' |`;
    assertEq(runLib(`${severed} hook_jq_default 'fallen-back' -r '.v'`).stdout, 'kept',
      'the answer jq did write, and nothing appended to it');
    assertEq(runLib(`printf 'not json' | hook_jq_default 'fallen-back' -r '.v'`).stdout, 'fallen-back',
      'nothing written at all is what the default is for');
    assertEq(runLib(`printf '%s' '{"v":"here"}' | hook_jq_default 'fallen-back' -r '.v'`).stdout, 'here',
      'and a clean read is just the answer');
  });

  await test('hook_jq_default answers through the engine, CRLF and all', () => {
    // The body is wk_jq_default's, so the strip and the silent status come with
    // it: a text-mode jq's `\r` never reaches the caller, and a failed read is
    // still exit 0, since a read carrying a default has decided that already.
    const dir = crlfWorld();
    const env = { PATH: systemPathWith(dir) };
    assertEq(runLib(`printf '%s' '{"v":"x"}' | hook_jq_default 'd' -r '.v'`, env).stdout, 'x',
      'no carriage return rides along');
    assertEq(runLib(`printf 'not json' | hook_jq_default 'd' -r '.v' >/dev/null; printf '%s' "$?"`, env).stdout, '0',
      'the status is the default\'s, not jq\'s');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  group('_lib.sh: hook_manager_config');

  // The three layers are read from files, so the case plants its own and points
  // the machine layer at one of them: the developer's real ~/.workkit is never
  // part of an answer here. jq and git are the real ones, since what is being
  // asked is which file was read.
  const jq = which('jq');
  await testUnless(!jq, 'this machine has no jq, and the config is read with it')(
    'a settings file in a cwd that is no git repo is not the repo layer', () => {
      // No git root, no repo layer. The file a non-repo cwd carries is the
      // machine's own state (on Windows the user profile holds it and every
      // temp directory sits under that profile), and read as the repo layer it
      // overrides the machine's own config with itself.
      const dir = mkTmp('lib-manager-');
      const ladder = path.join(dir, 'ladder.json');
      fs.writeFileSync(ladder, JSON.stringify({ tiers: { fast: 'ladder-fast' } }));
      const user = path.join(dir, 'user-settings.json');
      fs.writeFileSync(user, JSON.stringify({ manager: { tiers: { frontier: 'machine-frontier' } } }));
      const cwd = path.join(dir, 'not-a-repo');
      fs.mkdirSync(path.join(cwd, '.workkit'), { recursive: true });
      fs.writeFileSync(path.join(cwd, '.workkit', 'settings.json'),
        JSON.stringify({ version: 1, manager: { tiers: { workhorse: 'from-a-non-repo' } } }));

      const ask = () => runLib(
        `hook_manager_config "${shellPath(ladder)}" "${shellPath(cwd)}"; printf '%s' "$HOOK_MANAGER_CONFIG"`,
        { PATH: systemPathWith(path.dirname(jq)), MANAGER_USER_SETTINGS: shellPath(user) },
      ).stdout;

      const outside = ask();
      assert(!outside.includes('from-a-non-repo'),
        `the file in a directory that is no repo is no repo layer, got: ${outside}`);
      assert(outside.includes('machine-frontier'),
        `and the machine layer is still taken outside a repo, got: ${outside}`);

      // The control: the same file, one `git init` later, is that repo's layer.
      spawnSync('git', ['init', '-q', cwd], { encoding: 'utf8' });
      const inside = ask();
      assert(inside.includes('from-a-non-repo'),
        `a repo's own settings file is still read, got: ${inside}`);
      fs.rmSync(dir, { recursive: true, force: true });
    });

  group('_lib.sh: hook_prompt_is_system');

  // [label, prompt text, delivered by Claude Code itself]. The text rides in an
  // env var, so no quoting stands between a fixture and the helper.
  const PROMPTS = [
    ['the notification frame alone', '[SYSTEM NOTIFICATION - NOT USER INPUT]', true],
    ['the notification frame in longer text', 'A background task ended.\n[SYSTEM NOTIFICATION - NOT USER INPUT]\nIt exited 0.', true],
    ['the session frame alone', 'Another Claude session sent a message', true],
    ['the session frame in longer text', 'Heads up. Another Claude session sent a message:\nthe build is green', true],
    ['the agent-message frame alone', '<agent-message ', true],
    ['the agent-message frame in longer text', 'From the scout:\n<agent-message from="scout">recon done</agent-message>', true],
    ['the hand-back frame alone', '[Subagent hand-back]', true],
    ['the hand-back frame in longer text', 'DONE: the brief is built.\n[Subagent hand-back]\nall four suites green', true],
    ['a task-notification opening', '<task-notification>\n<task-id>b1</task-id>\nfinished\n</task-notification>', true],
    ['a pasted_content opening', '<pasted_content lines="2">\nline one\nline two\n</pasted_content>\nwhat does this do?', false],
    ['a bare pasted_content opening', '<pasted_content>\nline one\n</pasted_content>\nwhat does this do?', false],
    ['plain text', 'work on #12 and then compact', false],
    ['plain text that mentions a tag', 'why does <ide_opened_file> show up?', false],
  ];
  const promptWorld = () => ({ PATH: systemPathWith(path.dirname(jq)) });

  await test('a frame line, alone or inside longer text, or a tag opening is system; a paste or plain text is the owner\'s', () => {
    for (const [label, text, system] of PROMPTS) {
      const out = runLib('hook_prompt_is_system "$PROMPT_TEXT"; printf \'%s\' "$?"', { PROMPT_TEXT: text });
      assertEq(out.stdout, system ? '0' : '1', `${label}, got: ${out.stdout}|${out.stderr}`);
    }
  });

  await testUnless(!jq, 'this machine has no jq, and the close-guard pass is a jq read')(
    'the bash helper and a jq pass over the three constants agree on every fixture', () => {
      for (const name of ['HOOK_PROMPT_TAG_RE', 'HOOK_PROMPT_PASTE_RE', 'HOOK_PROMPT_FRAME_RE']) {
        const decl = runLib(`declare -p ${name}`).stdout;
        assert(/^declare -[a-zA-Z]*r[a-zA-Z]* /.test(decl), `${name} is a readonly constant, got: ${decl}`);
        assert(!/=""$/.test(decl.trim()), `${name} holds a pattern, got: ${decl}`);
      }
      // The jq answer is the Spec's rule spelled in jq: a frame line anywhere,
      // or a tag opening that is not the owner's paste.
      const filter = '($s | test($f)) or (($s | test($t)) and ($s | test($p) | not))';
      for (const [label, text, system] of PROMPTS) {
        const env = { ...promptWorld(), PROMPT_TEXT: text };
        const bash = runLib('hook_prompt_is_system "$PROMPT_TEXT" && printf true || printf false', env);
        const viaJq = runLib('hook_jq -n --arg s "$PROMPT_TEXT" --arg t "$HOOK_PROMPT_TAG_RE" '
          + `--arg p "$HOOK_PROMPT_PASTE_RE" --arg f "$HOOK_PROMPT_FRAME_RE" '${filter}'`, env);
        assertEq(viaJq.stdout.trim(), String(system), `${label}: the jq pass, got: ${viaJq.stdout}|${viaJq.stderr}`);
        assertEq(bash.stdout, viaJq.stdout.trim(), `${label}: bash and jq agree, got: ${bash.stdout}|${bash.stderr}`);
      }
    });

  group('_lib.sh: hook_session_model');

  // The statusline cache sits under TMPDIR, so every case plants its own world
  // there; the transcript is assistant entries among tool-result filler.
  const filler = (n) => Array.from({ length: n },
    () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }));
  const assistant = (model) => ({ type: 'assistant', message: { model, content: [{ type: 'text', text: 'hi' }] } });
  const sessionModel = (entries, cacheModel) => {
    const dir = mkTmp('lib-model-');
    const t = path.join(dir, 't.jsonl');
    fs.writeFileSync(t, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
    if (cacheModel) {
      fs.mkdirSync(path.join(dir, 'claude-session-state'));
      fs.writeFileSync(path.join(dir, 'claude-session-state', 'sess1.json'), JSON.stringify({ model: { id: cacheModel } }));
    }
    const out = runLib(`hook_session_model sess1 "${shellPath(t)}"; printf '%s|%s' "$HOOK_SESSION_MODEL" "$HOOK_SESSION_MODEL_SRC"`,
      { TMPDIR: shellPath(dir), PATH: systemPathWith(path.dirname(jq)) });
    fs.rmSync(dir, { recursive: true, force: true });
    return out;
  };

  await testUnless(!jq, 'this machine has no jq, and the model is read with it')(
    'an assistant entry inside the last 200 lines gives its model, from the transcript', () => {
      const out = sessionModel([...filler(500), assistant('model-in-tail'), ...filler(199)]);
      assertEq(out.stdout, 'model-in-tail|transcript', `got: ${out.stdout}|${out.stderr}`);
    });

  await testUnless(!jq, 'this machine has no jq, and the model is read with it')(
    'an assistant entry only before the last 200 lines gives no model, source none', () => {
      const out = sessionModel([...filler(500), assistant('model-in-head'), ...filler(200)]);
      assertEq(out.stdout, '|none', `only the end is read, got: ${out.stdout}|${out.stderr}`);
    });

  await testUnless(!jq, 'this machine has no jq, and the cache is read with it')(
    'the statusline cache still wins when it holds a model', () => {
      const out = sessionModel([...filler(10), assistant('model-in-tail')], 'model-from-cache');
      assertEq(out.stdout, 'model-from-cache|live', `got: ${out.stdout}|${out.stderr}`);
    });

  group('_lib.sh: hook_redirect_word');

  // One judgment per word, spelled the way a guard's walk hands it over: the
  // quote strip has already turned a quoted span into `_hookq_`.
  const redirectVerdicts = (words) => runLib(`for w in ${words.map((w) => `'${w}'`).join(' ')}; do `
    + 'printf \'%s=%s\\n\' "$w" "$(hook_redirect_word "$w" || echo no)"; done');

  await test('a bare operator hands its target to the next word', () => {
    const words = ['>', '>>', '<', '<<<', '&>', '&>>', '>|', '2>', '2>>', '0<', '<<'];
    const out = redirectVerdicts(words);
    assertEq(out.stdout.trim(), words.map((w) => `${w}=bare`).join('\n'), `got: ${out.stdout}|${out.stderr}`);
  });

  await test('an attached operator carries its target', () => {
    const words = ['2>&1', '>file', '2>>err', '&>all', '0<in', '3>&-', '<<<msg', '>_hookq_'];
    const out = redirectVerdicts(words);
    assertEq(out.stdout.trim(), words.map((w) => `${w}=attached`).join('\n'), `got: ${out.stdout}|${out.stderr}`);
  });

  await test('a plain argument or a quoted placeholder is no redirect', () => {
    const words = ['app.js', '-m', '-', '2', '_hookq_', 'a>b', '&'];
    const out = redirectVerdicts(words);
    assertEq(out.stdout.trim(), words.map((w) => `${w}=no`).join('\n'), `got: ${out.stdout}|${out.stderr}`);
  });

  await test("hook_fold_redirect_amp: a redirect's & is folded, a clause separator is kept", () => {
    const out = runLib("hook_fold_redirect_amp 'git clean 2>&1 -f &>/dev/null <&3 & ls && pwd'");
    assertEq(out.stdout, 'git clean 2>1 -f >/dev/null <3 & ls && pwd', `got: ${out.stdout}|${out.stderr}`);
  });

  await test('hook_redirect_span: 2 for bare, 1 for attached, 0 for no redirect, and exit 0 always', () => {
    const words = { '>': 2, '2>': 2, '<<<': 2, '2>&1': 1, '>file': 1, '2>1': 1, 'app.js': 0, 'a>b': 0, '_hookq_': 0 };
    const out = runLib(`for w in ${Object.keys(words).map((w) => `'${w}'`).join(' ')}; do `
      + 'n=$(hook_redirect_span "$w"); printf \'%s=%s:%s\\n\' "$w" "$n" "$?"; done');
    assertEq(out.stdout.trim(), Object.entries(words).map(([w, n]) => `${w}=${n}:0`).join('\n'),
      `got: ${out.stdout}|${out.stderr}`);
  });

  await test('hook_find_git_commit: a redirect between git and its subcommand never hides it', () => {
    for (const cmd of ['git 2>&1 commit -m "x"', 'git > /tmp/o commit -m "x"', 'git -C . 2>/dev/null commit -m "x"']) {
      const out = runLib(`hook_find_git_commit '${cmd}'; printf '%s' "$HOOK_COMMIT_CLAUSE"`);
      assert(/commit/.test(out.stdout), `${cmd} is a commit clause, got: ${out.stdout}|${out.stderr}`);
    }
  });

  await test('hook_find_git_commit: a redirect between an interpreter and its -c string never hides it', () => {
    for (const cmd of ['bash 2>&1 -c "git commit -m x"', 'sh > /tmp/o -c "git commit -m x"']) {
      const out = runLib(`hook_find_git_commit '${cmd}'; printf '%s' "$HOOK_WRAPPED_COMMIT"`);
      assertEq(out.stdout, '1', `${cmd} wraps a commit, got: ${out.stdout}|${out.stderr}`);
    }
  });

  await test('hook_find_git_commit: a quoted redirect target is counted, so the right span is judged', () => {
    for (const [cmd, want] of [
      ['bash > "out file" -c "git commit -m x"', '1'],
      ['bash > "git commit" -c "echo hi"', '0'],
      ['> "git commit" bash -c "echo hi"', '0'],
    ]) {
      const out = runLib(`hook_find_git_commit '${cmd}'; printf '%s' "$HOOK_WRAPPED_COMMIT"`);
      assertEq(out.stdout, want, `${cmd}, got: ${out.stdout}|${out.stderr}`);
    }
  });

  await test('hook_find_git_commit: a redirect before the command word never ends the peel', () => {
    for (const cmd of ['2>&1 git commit -m "x"', '> /tmp/out git commit -m "x"']) {
      const out = runLib(`hook_find_git_commit '${cmd}'; printf '%s' "$HOOK_COMMIT_CLAUSE"`);
      assert(/git commit/.test(out.stdout), `${cmd} is a commit clause, got: ${out.stdout}|${out.stderr}`);
    }
  });

  await test('hook_clause_changes_dir: a cd, pushd or popd past the peeled prefixes, and nothing else', () => {
    const ask = (clause) => runLib(`set -f; c='${clause}'; hook_clause_changes_dir $c && printf yes || printf no`).stdout;
    for (const clause of ['cd /x', 'pushd /x', 'popd', '(cd /x', '( cd /x', '{ cd /x', 'command cd /x',
      'env cd /x', 'X=1 cd /x', '2>/dev/null cd /x', '> out cd /x', 'builtin cd /x', 'time cd /x', '! cd /x',
      '\\cd /x', '(\\cd /x', 'if cd /x', 'then cd /x', 'elif cd /x', 'else cd /x', 'do cd /x', 'while cd /x',
      'until cd /x']) {
      assertEq(ask(clause), 'yes', `${clause} changes directory`);
    }
    for (const clause of ['gh issue close 7', 'echo cd', 'git commit -m _hookq_', 'cdx /x', '']) {
      assertEq(ask(clause), 'no', `${clause || '(empty)'} changes no directory`);
    }
  });

  await test('hook_find_git_commit: the one peel reads a commit, and a cd before it, past every prefix', () => {
    for (const cmd of ['time git commit -m x', 'if git commit -m x', '\\git commit -m x', '! git commit -m x']) {
      const out = runLib(`hook_find_git_commit '${cmd}'; printf '%s' "$HOOK_COMMIT_CLAUSE"`);
      assert(/git commit/.test(out.stdout), `${cmd} is a commit clause, got: ${out.stdout}|${out.stderr}`);
    }
    for (const cmd of ['builtin cd /x && git commit -m x', 'X=1 cd /x && git commit -m x']) {
      const out = runLib(`hook_find_git_commit '${cmd}'; printf '%s' "$HOOK_SAW_CD"`);
      assertEq(out.stdout, '1', `${cmd} changes directory before the commit`);
    }
  });

  group('_lib.sh: the command walk');

  // The command rides in an env var, so no quoting stands between a fixture and
  // the helper. Events are one per line, fields split by the unit separator.
  const US = '\x1f';
  const events = (snippet, cmd) => {
    const out = runLib(snippet, { CMD: cmd });
    return { out, lines: out.stdout.split('\n').filter((l) => l !== '') };
  };
  const stepsOf = (cmd) => {
    const { out, lines } = events('hook_cmd_steps "$CMD"', cmd);
    const shown = lines.map((l) => {
      const [kind, ...rest] = l.split(US);
      return kind === 'step' ? `step:${rest.join(US).trim()}` : kind;
    });
    return { out, shown };
  };

  await test('hook_cmd_steps: one step per ;, &&, ||, | and newline', () => {
    const { out, shown } = stepsOf('a 1 ; b 2 && c || d | e\nf');
    assertEq(shown.join(','), 'step:a 1,step:b 2,step:c,step:d,step:e,step:f', `got: ${out.stdout}|${out.stderr}`);
  });

  await test('hook_cmd_steps: open and close for each parenthesis, nested', () => {
    const { out, shown } = stepsOf('( (cd /x) ; b ) && c');
    assertEq(shown.join(','), 'open,open,step:cd /x,close,step:b,close,step:c', `got: ${out.stdout}|${out.stderr}`);
  });

  await test('hook_cmd_steps: a blank step is dropped', () => {
    const { out, shown } = stepsOf('\na ;\n\n ; b ;');
    assertEq(shown.join(','), 'step:a,step:b', `got: ${out.stdout}|${out.stderr}`);
  });

  const cdDir = (base, step) => runLib('hook_cd_step "$BASE" "$STEP"; printf \'%s\' "$HOOK_CD_DIR"',
    { BASE: base, STEP: step }).stdout;

  await test('hook_cd_step: an absolute folder, or a relative one joined to its base', () => {
    assertEq(cdDir('/b/base', 'cd /abs/x'), '/abs/x', 'an absolute folder is itself');
    assertEq(cdDir('/b/base', 'cd sub/x'), '/b/base/sub/x', 'a relative folder joins a non-empty base');
    assertEq(cdDir('', 'cd sub/x'), 'sub/x', 'a relative folder with an empty base stays relative');
    assertEq(cdDir('?', 'cd sub/x'), '?', 'a relative folder from an unknown base is unknown');
  });

  await test('hook_cd_step: every form it cannot follow is ?', () => {
    for (const step of ['pushd /x', 'popd', 'env cd /x', 'cd -P /x', 'cd ~/x', 'cd $X', 'cd a b']) {
      assertEq(cdDir('/b/base', step), '?', `${step} is refused`);
    }
  });

  await test('hook_unquote_word: one pair of matching quotes is stripped, anything else is left alone', () => {
    for (const [word, want] of [['"cd"', 'cd'], ["'cd'", 'cd'], ['""', ''], ['"\'cd\'"', "'cd'"],
      ['cd', 'cd'], ['"cd\'', '"cd\''], ['"cd', '"cd'], ['"a"b', '"a"b'], ['"', '"']]) {
      const out = runLib('hook_unquote_word "$W"', { W: word });
      assertEq(out.stdout, want, `${word}, got: ${out.stdout}|${out.stderr}`);
    }
  });

  // Each step as `folder|text`; the empty folder is the session's own.
  const dirsOf = (cmd) => {
    const { out, lines } = events('hook_step_dirs "$CMD"', cmd);
    const shown = lines.filter((l) => l.startsWith(`step${US}`)).map((l) => {
      const [, dir, ...text] = l.split(US);
      return `${dir}|${text.join(US).trim()}`;
    });
    return { out, shown };
  };

  await test('hook_step_dirs: each step with the folder it runs in, two cd steps chained', () => {
    const { out, shown } = dirsOf('ls ; cd /a && cd b && ls');
    assertEq(shown.join(','), '|ls,|cd /a,/a|cd b,/a/b|ls', `got: ${out.stdout}|${out.stderr}`);
  });

  await test('hook_step_dirs: a subshell\'s cd is undone at its )', () => {
    const { out, shown } = dirsOf('(cd /a && ls) ; ls');
    assertEq(shown.join(','), '|cd /a,/a|ls,|ls', `got: ${out.stdout}|${out.stderr}`);
  });

  group('_lib.sh: hook_pretool_notice');

  await test('prints the two-field JSON a PreToolUse hook exiting 0 is heard by', () => {
    const out = runLib("hook_pretool_notice 'a line: with \"quotes\"'");
    assertEq(out.code, 0, `it prints, got: ${out.stderr}`);
    const parsed = JSON.parse(out.stdout);
    assertEq(Object.keys(parsed).sort().join(','), 'hookSpecificOutput,systemMessage', 'two top-level fields');
    assertEq(parsed.systemMessage, 'a line: with "quotes"', 'the message, escaped by jq');
    assertEq(JSON.stringify(parsed.hookSpecificOutput),
      JSON.stringify({ hookEventName: 'PreToolUse', additionalContext: 'a line: with "quotes"' }),
      'the model hears the same line, and nothing decides the call');
  });

  group('_lib.sh: hook_wait_deadline and hook_end_tree');

  await test('a child still running at a 1s deadline: returns 1, and the child is ended', () => {
    const out = runLib('sleep 30 & pid=$!; hook_wait_deadline "$pid" 1; rc=$?; wait "$pid" 2>/dev/null; '
      + 'if kill -0 "$pid" 2>/dev/null; then alive=1; else alive=0; fi; printf \'rc=%s alive=%s\' "$rc" "$alive"');
    assertEq(out.stdout, 'rc=1 alive=0', `the deadline ended it, got: ${out.stdout}|${out.stderr}`);
  });

  await test('a quick child: returns 0 and leaves its exit status to wait', () => {
    const out = runLib('(exit 3) & pid=$!; hook_wait_deadline "$pid" 5; rc=$?; wait "$pid"; '
      + 'printf \'rc=%s status=%s\' "$rc" "$?"');
    assertEq(out.stdout, 'rc=0 status=3', `it ended in time, got: ${out.stdout}|${out.stderr}`);
  });

  group('_lib.sh: the test-path shapes');

  await test('hook_is_test_name: the basename shapes, at any depth, and nothing else', () => {
    const cases = ['a.test.js', 'src/a.spec.ts', 'pkg/a_test.go', 'tests/helpers.js', 'test/run.js', 'lib/x.js'];
    const out = runLib(`for p in ${cases.join(' ')}; do hook_is_test_name "$p" && echo "$p"; done; true`);
    assertEq(out.stdout.trim().split('\n').join(','), 'a.test.js,src/a.spec.ts,pkg/a_test.go', `got: ${out.stdout}|${out.stderr}`);
  });

  await test('hook_is_test_path: a test name, or any test folder, the top level included', () => {
    const cases = ['a.test.js', 'tests/helpers.js', 'test/run.js', '__tests__/x.js', 'pkg/__tests__/x.js',
      'pkg/test/x.js', 'lib/x.js', 'contest/x.js', 'testing/x.js'];
    const out = runLib(`for p in ${cases.join(' ')}; do hook_is_test_path "$p" && echo "$p"; done; true`);
    assertEq(out.stdout.trim().split('\n').join(','),
      'a.test.js,tests/helpers.js,test/run.js,__tests__/x.js,pkg/__tests__/x.js,pkg/test/x.js', `got: ${out.stdout}|${out.stderr}`);
  });

  await test('hook_is_code_path: a code extension, never a test path, a config file or the attic', () => {
    const cases = ['lib/x.js', 'run.sh', 'a/b.tsx', 'tool.py', 'README.md', 'data.json', 'a.test.js', 'tests/helpers.js',
      'eslint.config.js', '_attic/old.js', 'pkg/_attic/old.sh'];
    const out = runLib(`for p in ${cases.join(' ')}; do hook_is_code_path "$p" && echo "$p"; done; true`);
    assertEq(out.stdout.trim().split('\n').join(','), 'lib/x.js,run.sh,a/b.tsx,tool.py', `got: ${out.stdout}|${out.stderr}`);
  });

  await test('hook_has_code_ext: the code extensions, read off the basename alone', () => {
    const cases = ['x.js', 'x.cjs', 'x.mjs', 'x.ts', 'x.jsx', 'x.tsx', 'run.sh', 'rc.zsh', 'tool.py', 'gem.rb',
      'README.md', 'data.json', 'x.json.bak', 'Makefile'];
    const out = runLib(`for p in ${cases.join(' ')}; do hook_has_code_ext "$p" && echo "$p"; done; true`);
    assertEq(out.stdout.trim().split('\n').join(','), 'x.js,x.cjs,x.mjs,x.ts,x.jsx,x.tsx,run.sh,rc.zsh,tool.py,gem.rb',
      `got: ${out.stdout}|${out.stderr}`);
  });

  await test('hook_test_package_dir: the nearest package declaring a test script, below the root', () => {
    const root = mkTmp('lib-pkgdir-');
    for (const d of ['pkg/src/deep', 'pkg/bare/src', 'other', 'node_modules/x']) fs.mkdirSync(path.join(root, d), { recursive: true });
    const tested = JSON.stringify({ scripts: { test: 'node --test' } });
    for (const d of ['', 'pkg', 'node_modules/x']) fs.writeFileSync(path.join(root, d, 'package.json'), tested);
    fs.writeFileSync(path.join(root, 'pkg', 'bare', 'package.json'), '{"name":"bare"}');
    const ask = (p) => runLib(`hook_test_package_dir "${shellPath(root)}" "${p}"`).stdout.trim();
    assertEq(ask('pkg/src/deep/a.js'), 'pkg', 'a file under a package with a script names it');
    assertEq(ask('pkg/bare/src/a.js'), 'pkg', 'a package without a script never hides the tested one above it');
    assertEq(ask('other/x.js'), '', 'a file under no package names nothing');
    assertEq(ask('app.js'), '', "a file at the root names nothing, the root's own package included");
    assertEq(ask('node_modules/x/index.js'), '', 'a vendored package names nothing, script or not');
    fs.rmSync(root, { recursive: true, force: true });
  });

  await test('wk_has_test_script: a package.json that defines scripts.test, and nothing else', () => {
    const root = mkTmp('lib-testscript-');
    for (const d of ['tested', 'bare', 'none']) fs.mkdirSync(path.join(root, d));
    fs.writeFileSync(path.join(root, 'tested', 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    fs.writeFileSync(path.join(root, 'bare', 'package.json'), JSON.stringify({ name: 'bare', scripts: { lint: 'x' } }));
    const ask = (d) => runLib(`wk_has_test_script "${shellPath(path.join(root, d))}"`).code;
    assertEq(ask('tested'), 0, 'a package.json with a test script answers yes');
    assertEq(ask('bare'), 1, 'a package.json without a test script answers no');
    assertEq(ask('none'), 1, 'a folder with no package.json answers no');
    fs.rmSync(root, { recursive: true, force: true });
  });

  await test('an empty scripts.test is no script', () => {
    const root = mkTmp('lib-emptyscript-');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: '' } }));
    assertEq(runLib(`wk_has_test_script "${shellPath(root)}"`).code, 1, 'wk_has_test_script answers no');
    fs.rmSync(root, { recursive: true, force: true });
  });

  await test('hook_test_script_text: the scripts.test text, empty when absent, unreadable or with no package.json', () => {
    const root = mkTmp('lib-scripttext-');
    for (const d of ['tested', 'bare', 'broken', 'none']) fs.mkdirSync(path.join(root, d));
    fs.writeFileSync(path.join(root, 'tested', 'package.json'), JSON.stringify({ scripts: { test: 'node tests/run.js' } }));
    fs.writeFileSync(path.join(root, 'bare', 'package.json'), JSON.stringify({ name: 'bare', scripts: { lint: 'x' } }));
    // jq answers the first value before failing on the second: that half answer is never the text.
    fs.writeFileSync(path.join(root, 'broken', 'package.json'), '{"scripts":{"test":"half"}} {');
    const ask = (d) => runLib(`hook_test_script_text "${shellPath(path.join(root, d))}"`);
    const tested = ask('tested');
    assertEq(tested.stdout, 'node tests/run.js', `the script text, got: ${tested.stdout}|${tested.stderr}`);
    for (const d of ['bare', 'broken', 'none']) {
      const res = ask(d);
      assertEq(res.stdout, '', `${d}: nothing printed, got: ${JSON.stringify(res.stdout)}`);
      assertEq(res.code, 0, `${d}: and a clean exit, so a caller reads the empty text`);
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  group('_lib.sh: the marker paths');

  const sha1 = (text) => spawnSync(BASH, [...NO_RC, '-c', `printf '%s' "$1" | "${shellPath(real)}"`, 'sh', text],
    { encoding: 'utf8' }).stdout.split(' ')[0];

  // TMPDIR is handed over explicitly: the marker lives under whatever temp dir
  // the session has, which is the seam the two guard suites move.
  const TMP = mkTmp('lib-marker-');

  await test('hook_review_marker_path is the review marker dir plus the sha of the root', () => {
    const out = runLib('hook_review_marker_path /repos/thing', { TMPDIR: shellPath(TMP) });
    assertEq(out.stdout.trim(),
      shellPath(path.join(TMP, 'claude-review-marker', sha1('/repos/thing'))),
      `got: ${out.stdout}|${out.stderr}`);
  });

  await test('hook_review_full_marker_path is the full-panel marker dir plus the sha of the root', () => {
    const out = runLib('hook_review_full_marker_path /repos/thing', { TMPDIR: shellPath(TMP) });
    assertEq(out.stdout.trim(),
      shellPath(path.join(TMP, 'claude-review-full-marker', sha1('/repos/thing'))),
      `got: ${out.stdout}|${out.stderr}`);
  });

  await test('hook_triage_marker_path is the triage marker dir plus the sha of the anchor', () => {
    const out = runLib('hook_triage_marker_path /repos/thing', { TMPDIR: shellPath(TMP) });
    assertEq(out.stdout.trim(),
      shellPath(path.join(TMP, 'claude-triage-marker', sha1('/repos/thing'))),
      `got: ${out.stdout}|${out.stderr}`);
  });

  await test('wk_suite_marker_path is the suite marker dir plus the sha of the root', () => {
    const out = runLib('wk_suite_marker_path /repos/thing', { TMPDIR: shellPath(TMP) });
    assertEq(out.stdout.trim(),
      shellPath(path.join(TMP, 'claude-suite-marker', sha1('/repos/thing'))),
      `got: ${out.stdout}|${out.stderr}`);
  });

  await test('hook_session_marker is the named dir plus the session id with every non-alphanumeric as _', () => {
    const out = runLib('hook_session_marker workkit-thing "ab-12/c.d e"', { TMPDIR: shellPath(TMP) });
    assertEq(out.stdout.trim(), `${shellPath(TMP)}/workkit-thing/ab_12_c_d_e`, `got: ${out.stdout}|${out.stderr}`);
  });

  await test('no digest tool: a marker path is refused, never half-built', () => {
    const world = mkTmp('lib-nosha-');
    const out = runLib('p=$(hook_review_marker_path /repos/thing); printf \'rc=%s p=[%s]\' "$?" "$p"',
      { PATH: world });
    assert(out.stdout.includes('p=[]'), `no path at all, got: ${out.stdout}`);
    assert(!out.stdout.includes('rc=0'), `and says so, got: ${out.stdout}`);
    fs.rmSync(world, { recursive: true, force: true });
  });

  group('_lib.sh: the scripts');

  // A marker script, and the reader keyed on the same marker, name it only
  // through its helper; red-proof.sh reads no marker.
  for (const [script, keys] of [
    ['review-marker.sh', [['hook_review_marker_path', 'claude-review-marker'],
      ['hook_review_full_marker_path', 'claude-review-full-marker']]],
    ['triage-marker.sh', [['hook_triage_marker_path', 'claude-triage-marker']]],
    ['review-covers.sh', [['hook_review_full_marker_path', 'claude-review-full-marker']]],
    ['red-proof.sh', []],
  ]) {
    await test(`scripts/${script} exists, is executable, and parses`, () => {
      const file = path.join(__dirname, '..', '..', 'scripts', script);
      assert(fs.existsSync(file), `missing ${file}`);
      if (IS_WINDOWS) skip(`${script} carries the executable bit`, NO_EXEC_BIT);
      else assert((fs.statSync(file).mode & 0o111) !== 0, `${script} is executable`);
      const parsed = spawnSync(BASH, [...NO_RC, '-n', shellPath(file)], { encoding: 'utf8' });
      assertEq(parsed.status, 0, `${script} parses, got: ${parsed.stderr}`);
      const text = fs.readFileSync(file, 'utf8');
      for (const [fn, dir] of keys) {
        assert(text.includes(fn), `${script} keys through ${fn}, never its own spelling`);
        assert(!text.includes(`${dir}/`), `${script} never spells the marker path itself`);
      }
    });
  }
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
