/* eslint-disable no-console */
//
// Tests for hooks/safety/inbox-guard — the PreToolUse hook that keeps
// .workkit/inbox.md the owner's scratchpad: its CONTENTS are read only during
// a triage run, which the workkit:triage skill announces by touching a marker.
// Counting and appending stay open; a missing or stale (>30 min) marker blocks
// every read of the contents.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, WORKKIT_DIR: W } = require('../lib/harness');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'safety', 'inbox-guard', 'run.sh');

// One throwaway git repo holding the inbox, plus a TMPDIR of its own so the
// marker this suite writes can never be the machine's real one.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-guard-tmp-'));
const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-guard-'));
spawnSync('git', ['init', '-q'], { cwd: REPO });
fs.mkdirSync(path.join(REPO, W), { recursive: true });
fs.writeFileSync(path.join(REPO, W, 'inbox.md'), '# Inbox\n\n- a private thought\n');

// The repo root as GIT reports it — on macOS the temp dir is reached through a
// symlink, and the marker's name is the sha of the PHYSICAL path.
const REPO_ROOT = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: REPO, encoding: 'utf8' })
  .stdout.trim();
const MARKER_DIR = path.join(TMP, 'claude-triage-marker');
// The marker's name is the sha of the ANCHOR — the inbox's repo root, or the
// .workkit directory's own parent outside a repo.
const markerFor = (anchor) => path.join(
  MARKER_DIR,
  spawnSync('shasum', [], { input: anchor, encoding: 'utf8' }).stdout.split(' ')[0],
);
const MARKER = markerFor(REPO_ROOT);
const INBOX = path.join(REPO, W, 'inbox.md');

// The user-level inbox — ~/.workkit/inbox.md, where wk.sh writes outside a
// repo. $HOME is not a git repo, so the anchor is $HOME itself.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-guard-home-'));
fs.mkdirSync(path.join(HOME, W), { recursive: true });
fs.writeFileSync(path.join(HOME, W, 'inbox.md'), '# Inbox\n\n- a private thought\n');
const HOME_INBOX = path.join(HOME, W, 'inbox.md');
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

const run = async () => {
  group('inbox-guard: the Read path');

  await test('reading the inbox with no marker — exit 2, names the rule and the skill', () => {
    clearMarker();
    const { code, stderr } = read(INBOX);
    assertEq(code, 2, 'an unannounced read must block');
    assert(stderr.includes('inbox-guard'), 'names itself');
    assert(stderr.includes('triage'), 'names the sanctioned path');
    assert(stderr.includes('scratchpad'), 'states the rule');
  });

  await test('reading the inbox with a fresh marker — exit 0', () => {
    touchMarker();
    const { code, stderr } = read(INBOX);
    assertEq(code, 0, `a triage run reads freely, got: ${stderr}`);
  });

  await test('a marker 31 minutes old — exit 2', () => {
    touchMarker(31 * 60);
    assertEq(read(INBOX).code, 2, 'a stale marker is not a triage run');
  });

  await test('a relative inbox path is gated too — exit 2', () => {
    clearMarker();
    assertEq(read(`${W}/inbox.md`).code, 2, 'the path is matched by suffix, not by shape');
  });

  await test('any other file — exit 0', () => {
    clearMarker();
    for (const f of [
      path.join(REPO, W, 'session.md'),
      path.join(REPO, 'inbox.md'),
      path.join(REPO, 'README.md'),
    ]) {
      const { code, stderr } = read(f);
      assertEq(code, 0, `${f} must pass, got: ${stderr}`);
    }
  });

  group('inbox-guard: the Bash path');

  await test('a content-reading command — exit 2', () => {
    clearMarker();
    for (const c of [
      `cat ${W}/inbox.md`,
      `head -20 ${W}/inbox.md`,
      `tail -n 5 ${W}/inbox.md`,
      `grep -n "note" ${W}/inbox.md`,
      `sed -n 1,10p ${W}/inbox.md`,
      `awk 'NR<5' ${W}/inbox.md`,
    ]) {
      assertEq(bash(c).code, 2, `must block: ${c}`);
    }
  });

  await test('a fresh marker opens the Bash path too — exit 0', () => {
    touchMarker();
    const { code, stderr } = bash(`cat ${W}/inbox.md`);
    assertEq(code, 0, `a triage run reads freely, got: ${stderr}`);
  });

  await test('counting the entries — exit 0', () => {
    clearMarker();
    for (const c of [`wc -l ${W}/inbox.md`, `wc -l < ${W}/inbox.md`]) {
      const { code, stderr } = bash(c);
      assertEq(code, 0, `counts stay open: ${c}, got: ${stderr}`);
    }
  });

  await test('appending a note — exit 0', () => {
    clearMarker();
    for (const c of [
      `echo "- a thought" >> ${W}/inbox.md`,
      `bash ~/.claude/workkit/wk.sh note "a thought"`,
      `printf -- '- x\\n' >> ${W}/inbox.md`,
    ]) {
      const { code, stderr } = bash(c);
      assertEq(code, 0, `appends stay open: ${c}, got: ${stderr}`);
    }
  });

  await test('a command naming another file — exit 0', () => {
    clearMarker();
    assertEq(bash(`cat ${W}/session.md`).code, 0, 'only the inbox is gated');
  });

  group('inbox-guard: the Grep path');

  await test('a Grep whose path IS the inbox — exit 2', () => {
    clearMarker();
    for (const input of [
      { pattern: 'salary', path: INBOX, output_mode: 'content' },
      { pattern: 'salary', path: `${W}/inbox.md` },
      { pattern: 'salary', path: INBOX, output_mode: 'files_with_matches' },
    ]) {
      const { code, stderr } = grep(input);
      assertEq(code, 2, `must block: ${JSON.stringify(input)}`);
      assert(stderr.includes('inbox-guard'), 'names itself');
    }
  });

  await test('a Grep whose path is the .workkit directory — exit 2', () => {
    clearMarker();
    for (const p of [path.join(REPO, W), W]) {
      assertEq(grep({ pattern: 'salary', path: p }).code, 2, `must block: ${p}`);
    }
  });

  await test('a glob spelling the inbox out — exit 2', () => {
    clearMarker();
    assertEq(grep({ pattern: 'salary', path: REPO, glob: '**/inbox.md' }).code, 2,
      'the glob names the file, so the search is pointed at it');
  });

  await test('a fresh marker opens the Grep path too — exit 0', () => {
    touchMarker();
    const { code, stderr } = grep({ pattern: 'salary', path: INBOX, output_mode: 'content' });
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

  await test('a .workkit Grep narrowed away from the inbox by its glob — exit 0', () => {
    clearMarker();
    for (const input of [
      { pattern: 'salary', path: path.join(REPO, W), glob: 'session.md' },
      { pattern: 'salary', path: path.join(REPO, W), glob: '*.json' },
    ]) {
      const { code, stderr } = grep(input);
      assertEq(code, 0, `the glob cannot name the inbox: ${JSON.stringify(input)}, got: ${stderr}`);
    }
  });

  await test('a glob merely mentioning inbox is still pointed at it — exit 2', () => {
    clearMarker();
    assertEq(grep({ pattern: 'salary', path: REPO, glob: '*inbox*' }).code, 2,
      'the glob names the inbox, however it spells it');
  });

  await test('a trailing slash does not slip the Grep gate — exit 2', () => {
    clearMarker();
    for (const p of [`${path.join(REPO, W)}/`, `${INBOX}/`]) {
      assertEq(grep({ pattern: 'salary', path: p }).code, 2, `must block: ${p}`);
    }
  });

  await test('a .workkit Grep where no inbox exists — exit 0', () => {
    clearMarker();
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-guard-bare-'));
    spawnSync('git', ['init', '-q'], { cwd: bare });
    fs.mkdirSync(path.join(bare, W), { recursive: true });
    fs.writeFileSync(path.join(bare, W, 'session.md'), '# Session\n');
    const { code, stderr } = grep({ pattern: 'salary', path: path.join(bare, W) });
    assertEq(code, 0, `an absent inbox has nothing to protect, got: ${stderr}`);
    fs.rmSync(bare, { recursive: true, force: true });
  });

  group('inbox-guard: the user-level inbox');

  // ~/.workkit/inbox.md is where wk.sh writes outside a repo, and $HOME is not
  // a git repo — keyed to a repo root alone, this inbox was read ungated.
  await test('reading the user inbox with no marker — exit 2', () => {
    clearMarker(HOME_MARKER);
    const { code, stderr } = read(HOME_INBOX);
    assertEq(code, 2, 'the user inbox is gated like any other');
    assert(stderr.includes('inbox-guard'), 'names itself');
  });

  await test('reading it with a fresh $HOME-keyed marker — exit 0', () => {
    touchMarker(0, HOME_MARKER);
    const { code, stderr } = read(HOME_INBOX);
    assertEq(code, 0, `a triage run reads freely, got: ${stderr}`);
    clearMarker(HOME_MARKER);
  });

  await test('cat of the user inbox — blocked without the marker, open with it', () => {
    clearMarker(HOME_MARKER);
    assertEq(bash(`cat ${HOME_INBOX}`).code, 2, 'blocked with no marker');
    touchMarker(0, HOME_MARKER);
    assertEq(bash(`cat ${HOME_INBOX}`).code, 0, 'open during a triage run');
    clearMarker(HOME_MARKER);
  });

  await test('the ~/ spelling resolves to the same anchor', () => {
    const tilde = () => runHook(
      { cwd: REPO, tool_name: 'Bash', tool_input: { command: `cat ~/${W}/inbox.md` } },
      { HOME },
    ).code;
    clearMarker(HOME_MARKER);
    assertEq(tilde(), 2, 'the tilde form is the same file and the same gate');
    // The $HOME-keyed marker opens it, which is what proves the tilde expanded
    // — a path left unexpanded would key somewhere else and stay blocked.
    touchMarker(0, HOME_MARKER);
    assertEq(tilde(), 0, 'and the user inbox marker is the one that opens it');
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
    assertEq(read(HOME_INBOX).code, 0, 'so the guard opens');
    clearMarker(HOME_MARKER);
  });

  group('inbox-guard: wiring and fail-open');

  await test('hooks.json registers the guard on PreToolUse Read, Grep and Bash', () => {
    const wiring = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    for (const matcher of ['Read', 'Grep', 'Bash']) {
      const block = (wiring.hooks.PreToolUse || [])
        .find((b) => (b.matcher || '').split('|').includes(matcher));
      assert(block, `a PreToolUse ${matcher} block exists`);
      assert(block.hooks.some((h) => h.command.includes('safety:inbox-guard')),
        `the ${matcher} block routes safety:inbox-guard through the loader`);
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
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-guard-bare-'));
    const bareMarker = markerFor(bare);
    clearMarker(bareMarker);
    const call = () => spawnSync('bash', [HOOK], {
      input: JSON.stringify({
        tool_name: 'Bash', cwd: bare, tool_input: { command: `cat ${W}/inbox.md` },
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
      JSON.stringify({ tool_name: 'Write', cwd: REPO, tool_input: { file_path: INBOX } }),
      JSON.stringify({ tool_name: 'Read', cwd: REPO, tool_input: {} }),
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
