/* eslint-disable no-console */
//
// Tests for hooks/safety/capture-guard — the PreToolUse hook that keeps
// .workkit/capture.md the owner's capture surface: its CONTENTS are read, and
// its drained entries cleared, only during a triage run, which the
// workkit:triage skill announces by touching a marker. A missing or stale
// (>30 min) marker blocks every read and every rewrite; ADDING to the file is
// never the agent's, marker or not. Counting stays open.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, WORKKIT_DIR: W } = require('../lib/harness');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'safety', 'capture-guard', 'run.sh');

// One throwaway git repo holding the capture file, plus a TMPDIR of its own so
// the marker this suite writes can never be the machine's real one.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-guard-tmp-'));
const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-guard-'));
spawnSync('git', ['init', '-q'], { cwd: REPO });
fs.mkdirSync(path.join(REPO, W, 'agents'), { recursive: true });
fs.writeFileSync(path.join(REPO, W, 'capture.md'), '# capture\n\n- a private thought\n');
fs.writeFileSync(path.join(REPO, W, 'agents', 'session.md'), '# Session\n');

// The repo root as GIT reports it — on macOS the temp dir is reached through a
// symlink, and the marker's name is the sha of the PHYSICAL path.
const REPO_ROOT = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: REPO, encoding: 'utf8' })
  .stdout.trim();
const MARKER_DIR = path.join(TMP, 'claude-triage-marker');
// The marker's name is the sha of the ANCHOR — the capture file's repo root, or the
// .workkit directory's own parent outside a repo.
const markerFor = (anchor) => path.join(
  MARKER_DIR,
  spawnSync('shasum', [], { input: anchor, encoding: 'utf8' }).stdout.split(' ')[0],
);
const MARKER = markerFor(REPO_ROOT);
const CAPTURE = path.join(REPO, W, 'capture.md');

// The user-level capture file — a stray ~/.workkit/capture.md made by hand.
// wk.sh never writes there (outside a repo it files on the home repo), but the
// guard gates it anyway. $HOME is not a git repo, so the anchor is $HOME itself.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-guard-home-'));
fs.mkdirSync(path.join(HOME, W), { recursive: true });
fs.writeFileSync(path.join(HOME, W, 'capture.md'), '# capture\n\n- a private thought\n');
const HOME_CAPTURE = path.join(HOME, W, 'capture.md');
const HOME_MARKER = markerFor(HOME);

const clearMarker = (marker = MARKER) => fs.rmSync(marker, { force: true });
const touchMarker = (ageSeconds = 0, marker = MARKER) => {
  fs.mkdirSync(MARKER_DIR, { recursive: true });
  fs.writeFileSync(marker, '');
  if (ageSeconds) {
    const when = new Date(Date.now() - ageSeconds * 1000);
    fs.utimesSync(marker, when, when);
  }
};

const runHook = (payload, env = {}) => {
  const res = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ cwd: REPO, ...payload }),
    env: {
      ...process.env, HOME: os.homedir(), TMPDIR: TMP, ...env,
    },
    encoding: 'utf8',
    timeout: 10000,
  });
  return { code: res.status, stderr: res.stderr || '' };
};

const read = (file) => runHook({ tool_name: 'Read', tool_input: { file_path: file } });
const bash = (command) => runHook({ tool_name: 'Bash', tool_input: { command } });
const grep = (tool_input) => runHook({ tool_name: 'Grep', tool_input });
const edit = (file) => runHook({ tool_name: 'Edit', tool_input: { file_path: file } });
const write = (file) => runHook({ tool_name: 'Write', tool_input: { file_path: file } });

const run = async () => {
  group('capture-guard: the Read path');

  await test('reading the capture file with no marker — exit 2, names the rule and the skill', () => {
    clearMarker();
    const { code, stderr } = read(CAPTURE);
    assertEq(code, 2, 'an unannounced read must block');
    assert(stderr.includes('capture-guard'), 'names itself');
    assert(stderr.includes('triage'), 'names the sanctioned path');
    assert(stderr.includes('capture surface'), 'states the rule');
  });

  await test('reading the capture file with a fresh marker — exit 0', () => {
    touchMarker();
    const { code, stderr } = read(CAPTURE);
    assertEq(code, 0, `a triage run reads freely, got: ${stderr}`);
  });

  await test('a marker 31 minutes old — exit 2', () => {
    touchMarker(31 * 60);
    assertEq(read(CAPTURE).code, 2, 'a stale marker is not a triage run');
  });

  await test('a relative capture path is gated too — exit 2', () => {
    clearMarker();
    assertEq(read(`${W}/capture.md`).code, 2, 'the path is matched by suffix, not by shape');
  });

  await test('any other file — exit 0', () => {
    clearMarker();
    for (const f of [
      path.join(REPO, W, 'agents', 'session.md'),
      path.join(REPO, 'capture.md'),
      path.join(REPO, 'README.md'),
    ]) {
      const { code, stderr } = read(f);
      assertEq(code, 0, `${f} must pass, got: ${stderr}`);
    }
  });

  group('capture-guard: the Bash path');

  await test('a content-reading command — exit 2', () => {
    clearMarker();
    for (const c of [
      `cat ${W}/capture.md`,
      `head -20 ${W}/capture.md`,
      `tail -n 5 ${W}/capture.md`,
      `grep -n "note" ${W}/capture.md`,
      `sed -n 1,10p ${W}/capture.md`,
      `awk 'NR<5' ${W}/capture.md`,
    ]) {
      assertEq(bash(c).code, 2, `must block: ${c}`);
    }
  });

  await test('a fresh marker opens the Bash path too — exit 0', () => {
    touchMarker();
    const { code, stderr } = bash(`cat ${W}/capture.md`);
    assertEq(code, 0, `a triage run reads freely, got: ${stderr}`);
  });

  await test('counting the entries — exit 0', () => {
    clearMarker();
    for (const c of [`wc -l ${W}/capture.md`, `wc -l < ${W}/capture.md`]) {
      const { code, stderr } = bash(c);
      assertEq(code, 0, `counts stay open: ${c}, got: ${stderr}`);
    }
  });

  await test('a command naming another file — exit 0', () => {
    clearMarker();
    assertEq(bash(`cat ${W}/agents/session.md`).code, 0, 'only the capture file is gated');
  });

  // The two halves of the path need not be contiguous: a `cd` into .workkit
  // leaves the file named on its own, and that is the same read.
  await test('a read split across a cd — exit 2', () => {
    clearMarker();
    assertEq(bash(`cd ${W} && cat capture.md`).code, 2, 'the cd names the directory the read names the file');
  });

  await test('a split command that only counts — exit 0', () => {
    clearMarker();
    const { code, stderr } = bash(`cd ${W} && wc -l capture.md`);
    assertEq(code, 0, `counts stay open however they are spelled, got: ${stderr}`);
  });

  await test('an capture.md with no .workkit anywhere — exit 0', () => {
    clearMarker();
    for (const c of ['echo x >> notes/capture.md', 'cat notes/capture.md']) {
      const { code, stderr } = bash(c);
      assertEq(code, 0, `somebody else's capture.md is not ours: ${c}, got: ${stderr}`);
    }
  });

  group('capture-guard: the Edit and Write path');

  // The drain is the one write the file takes from an agent, so Edit/Write
  // ride the same marker the reads do.
  await test('editing or writing the capture file with no marker — exit 2', () => {
    clearMarker();
    for (const call of [() => edit(CAPTURE), () => write(CAPTURE), () => edit(`${W}/capture.md`)]) {
      const { code, stderr } = call();
      assertEq(code, 2, 'an unannounced write must block');
      assert(stderr.includes('capture-guard'), 'names itself');
      assert(stderr.includes('triage'), 'names the sanctioned path');
      // The branch is the rewrite gate, so the refusal names the rewrite —
      // the append rule is a different act and a different message.
      assert(stderr.includes('BLOCKED rewriting'), 'the message matches the act');
    }
  });

  await test('editing or writing it with a fresh marker — exit 0', () => {
    touchMarker();
    for (const call of [() => edit(CAPTURE), () => write(CAPTURE)]) {
      const { code, stderr } = call();
      assertEq(code, 0, `the triage drain clears entries, got: ${stderr}`);
    }
  });

  await test('writing another file in .workkit/ — exit 0', () => {
    clearMarker();
    assertEq(write(path.join(REPO, W, 'agents', 'session.md')).code, 0, 'only the capture file is gated');
  });

  group('capture-guard: the agent never adds to the capture file');

  // Owner ruling, 2026-08-05: clear it on triage, never add to it. No marker
  // opens an append — the marker means a DRAIN is running, not a capture.
  await test('an append into the capture file — exit 2 with and without a marker', () => {
    const appends = [
      `echo "- a thought" >> ${W}/capture.md`,
      `echo "- a thought" >>${W}/capture.md`,
      `printf -- '- x\\n' >> "${W}/capture.md"`,
      `echo x | tee -a ${W}/capture.md`,
      `cd ${W} && echo hi >> capture.md`,
    ];
    clearMarker();
    for (const c of appends) {
      const { code, stderr } = bash(c);
      assertEq(code, 2, `an append is never the agent's: ${c}`);
      assert(stderr.includes('never adds to it'), 'states the rule');
    }
    touchMarker();
    for (const c of appends) {
      assertEq(bash(c).code, 2, `and a triage run does not open it either: ${c}`);
    }
  });

  await test('the capture CLI run by the agent — exit 2 with and without a marker', () => {
    const captures = [
      'bash ~/.claude/workkit/wk.sh note "a thought"',
      'workkit note "a thought"',
      'wk.sh note the thought',
      'cd /tmp && wk note "a thought"',
    ];
    clearMarker();
    for (const c of captures) {
      const { code, stderr } = bash(c);
      assertEq(code, 2, `capture is the owner's: ${c}`);
      assert(stderr.includes('status:inbox'), 'points at the issue instead');
    }
    touchMarker();
    for (const c of captures) {
      assertEq(bash(c).code, 2, `and a triage run does not open it either: ${c}`);
    }
  });

  // The CLI is caught where it is RUN, not where it is mentioned: prose about
  // capture in an issue body, and a search for it, touch no capture file.
  await test('the capture CLI merely named — exit 0', () => {
    clearMarker();
    for (const c of [
      `gh issue create --body 'the owner runs wk.sh note "x" to capture'`,
      'gh issue comment 1 --body "use workkit note for capture"',
      'rg wk.sh note docs/',
    ]) {
      const { code, stderr } = bash(c);
      assertEq(code, 0, `a mention runs nothing: ${c}, got: ${stderr}`);
    }
  });

  await test('a rewrite of the capture file — marker-gated like a read', () => {
    const rewrites = [
      `echo x > ${W}/capture.md`,
      `echo x | tee ${W}/capture.md`,
      `sed -i '' 's/a/b/' ${W}/capture.md`,
      `perl -pi -e 's/a/b/' ${W}/capture.md`,
    ];
    clearMarker();
    for (const c of rewrites) {
      assertEq(bash(c).code, 2, `a rewrite outside a triage run blocks: ${c}`);
    }
    touchMarker();
    for (const c of rewrites) {
      const { code, stderr } = bash(c);
      assertEq(code, 0, `the drain rewrites freely: ${c}, got: ${stderr}`);
    }
  });

  await test('a command redirecting elsewhere while naming the capture file — exit 0', () => {
    clearMarker();
    for (const c of [
      `echo "${W}/capture.md" > /dev/null`,
      `echo "the captures live at ${W}/capture.md" >> notes.txt`,
      `ls -la ${W}/capture.md`,
    ]) {
      const { code, stderr } = bash(c);
      assertEq(code, 0, `only a write TO the capture file is gated: ${c}, got: ${stderr}`);
    }
  });

  // tee, sed -i and perl -i are judged by their OWN argument: a pipeline whose
  // writer points at another file writes to that file, whatever the command
  // line mentions elsewhere.
  await test('a writer keyword pointed at another file — exit 0', () => {
    clearMarker();
    for (const c of [
      `wc -l ${W}/capture.md | tee -a /tmp/log`,
      `wc -l ${W}/capture.md | tee /tmp/log`,
      `ls ${W}/capture.md; echo hi | tee -a other.log`,
      `ls ${W}/capture.md; sed -i '' s/a/b/ other.txt`,
      `git log --oneline -- ${W}/capture.md | tee changes.log`,
    ]) {
      const { code, stderr } = bash(c);
      assertEq(code, 0, `the keyword's own target decides: ${c}, got: ${stderr}`);
    }
  });

  await test('the same keywords pointed AT the capture file — still gated', () => {
    clearMarker();
    assertEq(bash(`tee -a ${W}/capture.md`).code, 2, 'an append is never the agent\'s');
    assertEq(bash(`sed -i '' s/a/b/ ${W}/capture.md`).code, 2, 'a rewrite needs the marker');
    touchMarker();
    assertEq(bash(`tee -a ${W}/capture.md`).code, 2, 'and no marker opens the append');
    assertEq(bash(`sed -i '' s/a/b/ ${W}/capture.md`).code, 0, 'while the drain rewrites freely');
  });

  group('capture-guard: the Grep path');

  await test('a Grep whose path IS the capture file — exit 2', () => {
    clearMarker();
    for (const input of [
      { pattern: 'salary', path: CAPTURE, output_mode: 'content' },
      { pattern: 'salary', path: `${W}/capture.md` },
      { pattern: 'salary', path: CAPTURE, output_mode: 'files_with_matches' },
    ]) {
      const { code, stderr } = grep(input);
      assertEq(code, 2, `must block: ${JSON.stringify(input)}`);
      assert(stderr.includes('capture-guard'), 'names itself');
    }
  });

  await test('a Grep whose path is the .workkit directory — exit 2', () => {
    clearMarker();
    for (const p of [path.join(REPO, W), W]) {
      assertEq(grep({ pattern: 'salary', path: p }).code, 2, `must block: ${p}`);
    }
  });

  await test('a glob spelling the capture file out — exit 2', () => {
    clearMarker();
    assertEq(grep({ pattern: 'salary', path: REPO, glob: '**/capture.md' }).code, 2,
      'the glob names the file, so the search is pointed at it');
  });

  await test('a fresh marker opens the Grep path too — exit 0', () => {
    touchMarker();
    const { code, stderr } = grep({ pattern: 'salary', path: CAPTURE, output_mode: 'content' });
    assertEq(code, 0, `a triage run reads freely, got: ${stderr}`);
  });

  await test('a broad repo-wide Grep — exit 0', () => {
    clearMarker();
    for (const input of [
      { pattern: 'salary', path: REPO, output_mode: 'content' },
      { pattern: 'salary' },
      { pattern: 'salary', path: REPO, glob: '**/*.md' },
      { pattern: 'salary', path: path.join(REPO, 'docs') },
    ]) {
      const { code, stderr } = grep(input);
      assertEq(code, 0, `a whole-repo search must never block: ${JSON.stringify(input)}, got: ${stderr}`);
    }
  });

  await test('a .workkit Grep narrowed away from the capture file by its glob — exit 0', () => {
    clearMarker();
    for (const input of [
      { pattern: 'salary', path: path.join(REPO, W), glob: 'agents/session.md' },
      { pattern: 'salary', path: path.join(REPO, W), glob: '*.json' },
    ]) {
      const { code, stderr } = grep(input);
      assertEq(code, 0, `the glob cannot name the capture file: ${JSON.stringify(input)}, got: ${stderr}`);
    }
  });

  await test('a glob merely mentioning capture is still pointed at it — exit 2', () => {
    clearMarker();
    assertEq(grep({ pattern: 'salary', path: REPO, glob: '*capture*' }).code, 2,
      'the glob names the capture file, however it spells it');
  });

  await test('a trailing slash does not slip the Grep gate — exit 2', () => {
    clearMarker();
    for (const p of [`${path.join(REPO, W)}/`, `${CAPTURE}/`]) {
      assertEq(grep({ pattern: 'salary', path: p }).code, 2, `must block: ${p}`);
    }
  });

  await test('a .workkit Grep where no capture file exists — exit 0', () => {
    clearMarker();
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-guard-bare-'));
    spawnSync('git', ['init', '-q'], { cwd: bare });
    fs.mkdirSync(path.join(bare, W, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(bare, W, 'agents', 'session.md'), '# Session\n');
    const { code, stderr } = grep({ pattern: 'salary', path: path.join(bare, W) });
    assertEq(code, 0, `an absent capture file has nothing to protect, got: ${stderr}`);
    fs.rmSync(bare, { recursive: true, force: true });
  });

  group('capture-guard: the user-level capture file');

  // A hand-made ~/.workkit/capture.md sits in no repo, and $HOME is not a git
  // repo — keyed to a repo root alone, this file was read ungated.
  await test('reading the user capture file with no marker — exit 2', () => {
    clearMarker(HOME_MARKER);
    const { code, stderr } = read(HOME_CAPTURE);
    assertEq(code, 2, 'the user capture file is gated like any other');
    assert(stderr.includes('capture-guard'), 'names itself');
  });

  await test('reading it with a fresh $HOME-keyed marker — exit 0', () => {
    touchMarker(0, HOME_MARKER);
    const { code, stderr } = read(HOME_CAPTURE);
    assertEq(code, 0, `a triage run reads freely, got: ${stderr}`);
    clearMarker(HOME_MARKER);
  });

  await test('cat of the user capture file — blocked without the marker, open with it', () => {
    clearMarker(HOME_MARKER);
    assertEq(bash(`cat ${HOME_CAPTURE}`).code, 2, 'blocked with no marker');
    touchMarker(0, HOME_MARKER);
    assertEq(bash(`cat ${HOME_CAPTURE}`).code, 0, 'open during a triage run');
    clearMarker(HOME_MARKER);
  });

  await test('the ~/ spelling resolves to the same anchor', () => {
    const tilde = () => runHook(
      { cwd: REPO, tool_name: 'Bash', tool_input: { command: `cat ~/${W}/capture.md` } },
      { HOME },
    ).code;
    clearMarker(HOME_MARKER);
    assertEq(tilde(), 2, 'the tilde form is the same file and the same gate');
    // The $HOME-keyed marker opens it, which is what proves the tilde expanded
    // — a path left unexpanded would key somewhere else and stay blocked.
    touchMarker(0, HOME_MARKER);
    assertEq(tilde(), 0, 'and the user capture file marker is the one that opens it');
    clearMarker(HOME_MARKER);
  });

  await test('the braced HOME spelling resolves like the bare one', () => {
    const forms = [`cat "$HOME/${W}/capture.md"`, `cat "\${HOME}/${W}/capture.md"`];
    const call = (c) => runHook(
      { cwd: REPO, tool_name: 'Bash', tool_input: { command: c } },
      { HOME },
    );
    clearMarker(HOME_MARKER);
    for (const c of forms) {
      assertEq(call(c).code, 2, `braced or bare, the gate is the same: ${c}`);
    }
    touchMarker(0, HOME_MARKER);
    for (const c of forms) {
      const { code, stderr } = call(c);
      assertEq(code, 0, `and the user capture file marker opens both: ${c}, got: ${stderr}`);
    }
    clearMarker(HOME_MARKER);
  });

  await test("the skill's own recipe, run in $HOME, writes the file this hook checks", () => {
    clearMarker(HOME_MARKER);
    const skill = fs.readFileSync(
      path.join(__dirname, '..', '..', 'skills', 'triage', 'SKILL.md'), 'utf8');
    const recipe = skill.split('\n').find((l) => l.includes('claude-triage-marker') && l.includes('mkdir'));
    assert(recipe, 'the skill carries the marker recipe');
    const res = spawnSync('bash', ['-c', recipe], {
      cwd: HOME,
      env: { ...process.env, HOME, TMPDIR: TMP },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0, `the recipe runs outside a repo, got: ${res.stderr}`);
    assert(fs.existsSync(HOME_MARKER), 'and writes exactly the marker the hook looks for');
    assertEq(read(HOME_CAPTURE).code, 0, 'so the guard opens');
    clearMarker(HOME_MARKER);
  });

  group('capture-guard: wiring and fail-open');

  await test('hooks.json registers the guard on every tool that reaches the capture file', () => {
    const wiring = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    for (const matcher of ['Read', 'Grep', 'Bash', 'Edit', 'Write']) {
      const block = (wiring.hooks.PreToolUse || [])
        .find((b) => (b.matcher || '').split('|').includes(matcher));
      assert(block, `a PreToolUse ${matcher} block exists`);
      assert(block.hooks.some((h) => h.command.includes('safety:capture-guard')),
        `the ${matcher} block routes safety:capture-guard through the loader`);
    }
  });

  await test('the triage skill records the marker this hook checks', () => {
    const skill = fs.readFileSync(
      path.join(__dirname, '..', '..', 'skills', 'triage', 'SKILL.md'), 'utf8');
    assert(skill.includes('claude-triage-marker'), 'the skill touches the marker directory');
    assert(skill.includes('git rev-parse --show-toplevel'), 'by the repo-root recipe');
    assert(skill.includes('echo "$HOME"'), 'falling back to $HOME outside a repo');
  });

  await test('a cwd outside any git repo still keys off the .workkit parent', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-guard-bare-'));
    const bareMarker = markerFor(bare);
    clearMarker(bareMarker);
    const call = () => spawnSync('bash', [HOOK], {
      input: JSON.stringify({
        tool_name: 'Bash', cwd: bare, tool_input: { command: `cat ${W}/capture.md` },
      }),
      env: { ...process.env, HOME: os.homedir(), TMPDIR: TMP },
      encoding: 'utf8',
      timeout: 10000,
    }).status;
    assertEq(call(), 2, 'no repo is not a way past the gate');
    touchMarker(0, bareMarker);
    assertEq(call(), 0, 'and its own marker opens it');
    clearMarker(bareMarker);
    fs.rmSync(bare, { recursive: true, force: true });
  });

  await test('another tool, a missing input, malformed JSON — exit 0', () => {
    for (const input of [
      JSON.stringify({ tool_name: 'Glob', cwd: REPO, tool_input: { pattern: '**/capture.md' } }),
      JSON.stringify({ tool_name: 'Read', cwd: REPO, tool_input: {} }),
      JSON.stringify({ tool_name: 'Write', cwd: REPO, tool_input: {} }),
      JSON.stringify({ tool_name: 'Bash', cwd: REPO, tool_input: {} }),
      'not json',
    ]) {
      const res = spawnSync('bash', [HOOK], {
        input,
        env: { ...process.env, HOME: os.homedir(), TMPDIR: TMP },
        encoding: 'utf8',
        timeout: 10000,
      });
      assertEq(res.status, 0, `must fail open: ${input}`);
    }
  });
};

module.exports = async () => {
  await run();
  const result = summary();
  fs.rmSync(REPO, { recursive: true, force: true });
  fs.rmSync(HOME, { recursive: true, force: true });
  fs.rmSync(TMP, { recursive: true, force: true });
  return result;
};

if (require.main === module) {
  module.exports().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
