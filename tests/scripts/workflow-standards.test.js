//
// Tests for workflow/: the label vocabulary manifest (labels.json) and
// the repo standards script (standards.sh).
//
// The script's label step talks to GitHub through `gh`; every test here runs
// against a PATH shim that records its arguments and answers from a fixture, so
// nothing in this suite touches the network or a real repository.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, skip, testUnless, summary, selfRun, WORKKIT_DIR: W,
} = require('../lib/harness');
const {
  IS_WINDOWS, BASH, SYSTEM_BASH, SYSTEM_PATH, NODE_DIR, NO_RC, NO_EXEC_BIT, shellPath,
  gitPath, which, linkTool, stubTool, crlfJq, cygpathStub, basePathWithout, systemPathWith,
  joinPath,
} = require('../lib/platform');
const { recordArgv, readArgv, isCall, eqArgv, fmtCalls } = require('../lib/argv-log');

const WORKFLOW_DIR = path.join(__dirname, '..', '..', 'workflow');
const SCRIPT = path.join(WORKFLOW_DIR, 'standards.sh');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(WORKFLOW_DIR, 'labels.json'), 'utf8'));

// The two .gitignore lines the engine writes, built from the harness constant
// so the directory's name is spelled out in exactly one place here too.
const W_RE = W.replace(/\./g, '\\.');
const IGNORE_GLOB = new RegExp(`^${W_RE}/\\*$`, 'm');
const IGNORE_GLOB_ALL = new RegExp(`^${W_RE}/\\*$`, 'gm');
const IGNORE_NEGATION = new RegExp(`^!${W_RE}/settings\\.json$`, 'm');

// The hooks' copy of the name, checked against the harness by the drift test.
const HOOK_LIB = path.join(__dirname, '..', '..', 'hooks', '_lib.sh');

// Every group:value pair the manifest asks for, with its resolved color.
const desiredLabels = () => {
  const out = [];
  for (const [groupName, groupBody] of Object.entries(MANIFEST.groups)) {
    for (const [value, body] of Object.entries(groupBody.values)) {
      out.push({
        name: `${groupName}:${value}`,
        description: body.description,
        color: body.color || groupBody.color,
      });
    }
  }
  return out;
};

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wf-std-'));
const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// The roster and the declines, out of the machine-maintained `.repos.json`:
// absent until the engine has something to record there (issue #80).
const rosterOf = (home) => {
  const file = path.join(home, '.repos.json');
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')).repos || {}) : {};
};

// The roster key a repo takes on the WINDOWS branch: git's spelling of its
// root. On Windows this machine's own cygpath answers; off it, the seam's stub
// does, prefixing the drive letter the MSYS root maps to (tests/lib/platform.js).
const winRosterKey = (repo) => (IS_WINDOWS
  ? gitPath(fs.realpathSync(repo))
  : `C:${fs.realpathSync(repo)}`);

// A git repo with an origin remote: the shape the script expects. No commits
// are made and the remote is never contacted (gh is stubbed).
// Participation: the committed .workkit/settings.json is the repo's yes, so
// every fixture carries one unless a test is exercising another state.
const makeRepo = ({ remote = true, settings = '{ "version": 1, "enabled": true }\n' } = {}) => {
  const dir = mkTmp();
  spawnSync('git', ['init', '-q'], { cwd: dir });
  if (remote) {
    spawnSync('git', ['remote', 'add', 'origin', 'https://example.invalid/alice/repo.git'], { cwd: dir });
  }
  if (settings !== null) {
    fs.mkdirSync(path.join(dir, W), { recursive: true });
    fs.writeFileSync(path.join(dir, W, 'settings.json'), settings);
  }
  return dir;
};

// PATH shim: records each `gh` invocation, answers `label list` and
// `issue list` from fixtures. The recording keeps argument boundaries (see
// tests/lib/argv-log.js): a label description is a phrase with spaces, and
// losing the boundary would make an unquoted expansion in the script
// indistinguishable from a correct call.
const makeGhStub = ({
  labels = [], issues = [], authed = true, createFails = false, editFails = false,
  // `labeled` maps a label name to the issues carrying it, so
  // `gh issue list --label <name>` answers per label instead of handing back
  // the whole fixture. `labelQueryFails` makes that query fail.
  labeled = {}, labelQueryFails = false,
  // Branch-protection knobs. `protection`: 'absent' (404s, PUT accepted),
  // 'present' (GET succeeds), or 'denied' (404s, PUT rejected: the free-plan
  // private repo). `repoView`: answer `gh repo view` with a real owner/branch;
  // off by default so every older test exercises the "cannot resolve" bail-out.
  protection = 'absent', repoView = false,
} = {}) => {
  const dir = mkTmp();
  const logFile = path.join(dir, 'gh.log');
  const labelsFile = path.join(dir, 'labels.json');
  const issuesFile = path.join(dir, 'issues.json');
  fs.writeFileSync(labelsFile, JSON.stringify(labels));
  fs.writeFileSync(issuesFile, JSON.stringify(issues));
  // An entry is a bare number when the caller only cares which issues carry the
  // label, or a whole object when the fields matter (the stale-claim sweep
  // reads updatedAt and assignees).
  // A label name is never a file name: the colon in `agent:working` opens an
  // NTFS alternate data stream on Windows instead of creating a file, and the
  // shell cannot see one at all, so every label query would answer the empty
  // list there. The fixtures are numbered and the stub LOOKS ITS LABEL UP, so
  // the name lives in the case pattern and the path is spelled once, here.
  const labelFixtures = Object.entries(labeled).map(([label, numbers], i) => {
    const file = path.join(dir, `issues-${i}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify(numbers.map((n) => (typeof n === 'object' ? n : { number: n }))),
    );
    return { label, file };
  });
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  stubTool(binDir, 'gh', [
    '#!/usr/bin/env bash',
    recordArgv(logFile),
    'if [[ "$1 $2" == "auth status" ]]; then',
    `  exit ${authed ? 0 : 1}`,
    'fi',
    'if [[ "$1 $2" == "label list" ]]; then',
    `  cat "${labelsFile}"`,
    '  exit 0',
    'fi',
    'if [[ "$1 $2" == "issue list" ]]; then',
    // A --label query asks who carries one label; without it this is the
    // whole-repo report, which gets the full fixture.
    '  want=""; prev=""',
    '  for a in "$@"; do [[ "$prev" == "--label" ]] && want="$a"; prev="$a"; done',
    '  if [[ -z "$want" ]]; then',
    `    cat "${issuesFile}"`,
    '    exit 0',
    '  fi',
    ...(labelQueryFails ? ['  exit 1'] : []),
    '  case "$want" in',
    ...labelFixtures.map(({ label, file }) => `    '${label}') cat "${shellPath(file)}" ;;`),
    '    *) echo "[]" ;;',
    '  esac',
    '  exit 0',
    'fi',
    'if [[ "$1 $2" == "issue edit" ]]; then',
    '  exit 0',
    'fi',
    'if [[ "$1 $2" == "label create" ]]; then',
    `  exit ${createFails ? 1 : 0}`,
    'fi',
    'if [[ "$1 $2" == "label edit" ]]; then',
    `  exit ${editFails ? 1 : 0}`,
    'fi',
    'if [[ "$1" == "repo" && "$2" == "view" ]]; then',
    ...(repoView ? [
      '  if [[ "$*" == *nameWithOwner* ]]; then echo "stub/repo"; fi',
      '  if [[ "$*" == *defaultBranchRef* ]]; then echo "main"; fi',
      '  exit 0',
    ] : ['  exit 0']),
    'fi',
    'if [[ "$1" == "api" ]]; then',
    '  if [[ "$*" == *"-X PUT"* ]]; then',
    `    cat > "${path.join(dir, 'put-body.json')}"`,
    `    exit ${protection === 'denied' ? 1 : 0}`,
    '  fi',
    // A real 404 answers with this text; the heal must see it to distinguish
    // "unprotected" from a transient failure it must not write over.
    ...(protection === 'present' ? ['  exit 0'] : ['  echo "gh: Branch not protected (HTTP 404)" >&2', '  exit 1']),
    'fi',
    'exit 0',
  ]);
  return { binDir, logFile, dir };
};

const readFile = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
// One argv array per recorded `gh` invocation.
const ghCalls = (stub) => readArgv(stub.logFile);

// `pathPrefix: null` means run with no gh on PATH at all (the offline machine).
// WORKFLOW_HOME always points at a throwaway directory: the user-level
// settings file this script writes must never be the real ~/.workkit.
// A PATH holding every tool the script needs EXCEPT one. `command -v <tool>`
// searches every PATH entry, so the only way to prove the missing-tool branch
// is to build the PATH: where a tool lives varies by machine (a CI runner keeps
// gh in /usr/bin, Homebrew does not), and a test that assumed a layout was
// testing the host instead of the script. The seam builds and checks it.
const binDirWithout = (excluded) => basePathWithout(mkTmp(), excluded);

const runScript = (repoDir, {
  pathPrefix, args = [], workflowHome, claudeHome, hooksDir, env = {},
} = {}) => {
  // node is on the PATH of any machine running this standard (the engine lints
  // CHANGELOGs with it, and so does the hook layer), so the default PATH
  // carries it. A test proving what happens WITHOUT a tool builds its own PATH
  // with binDirWithout(): the suite's idiom for exactly that.
  const basePath = joinPath(SYSTEM_PATH, NODE_DIR);
  const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT), ...args, shellPath(repoDir)], {
    env: {
      ...process.env,
      PATH: pathPrefix ? joinPath(pathPrefix, basePath) : basePath,
      // Unset means the real hook layer beside the engine, which is what most
      // of this suite runs against; the self-check tests point at a fixture.
      ...(hooksDir ? { WORKFLOW_HOOKS_DIR: shellPath(hooksDir) } : {}),
      WORKFLOW_HOME: shellPath(workflowHome || path.join(mkTmp(), 'workflow-home')),
      // Same rule as WORKFLOW_HOME for the engine's address symlink: the step
      // that maintains ~/.claude/workkit must never reach the real ~/.claude.
      WORKFLOW_CLAUDE_HOME: shellPath(claudeHome || path.join(mkTmp(), 'claude-home')),
      // Last, so a case driving another platform's branch (OSTYPE) wins over
      // the environment this suite inherited.
      ...env,
    },
    encoding: 'utf8',
    timeout: 20000,
  });
  // The engine keeps stdout for machine-readable answers (--state, --announce)
  // and sends every diagnostic to stderr. `output` is what a human sees in a
  // terminal: assert human-facing lines against it, and stdout only when the
  // test cares that something IS machine-readable.
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  return { code: res.status, stdout, stderr, output: stdout + stderr };
};

const run = async () => {
  // A case that STRIPS a file's executable bit to see what the heal says about
  // it. There is no bit to strip on Windows, so the whole case is the skip.
  const strippedBitTest = testUnless(IS_WINDOWS, `${NO_EXEC_BIT}, so no script can be stripped of one`);

  group('labels.json: manifest shape');

  await test('all four groups present', () => {
    const groups = Object.keys(MANIFEST.groups).sort();
    assertEq(groups.join(','), 'agent,priority,status,type', 'the day-one groups');
  });

  await test('exact values per group', () => {
    const values = (g) => Object.keys(MANIFEST.groups[g].values).sort().join(',');
    assertEq(values('status'), 'backlog,blocked,building,complete,inbox,qa,specced', 'status values');
    assertEq(values('type'), 'bug,enhancement,idea', 'type values');
    assertEq(values('priority'), 'high,low', 'priority values');
    assertEq(values('agent'), 'ok,working', 'agent values');
  });

  await test('status:complete is the stage after qa, and its label teaches what it means (#196)', () => {
    // The manifest lists the statuses in PIPELINE order: inbox, specced,
    // building, qa, complete, then the side pockets, so a reader with nothing
    // but `gh label list` learns the road in the order it is walked. The stage
    // a ship reads from sits directly after the one whose passing check grants
    // it, and it wears the verdict green qa gave up.
    const status = MANIFEST.groups.status.values;
    assertEq(Object.keys(status).slice(0, 5).join(','), 'inbox,specced,building,qa,complete', 'the pipeline in order');
    assertEq(status.complete.description, 'QA passed, ready to ship. Exactly one status: label per open issue.', 'complete says QA passed');
    assertEq(status.complete.color, '12925C', 'complete wears the verdict green');
    assertEq(status.qa.color, 'B0416A', 'qa moved off it: qa only means waiting on the check');
  });

  await test('values are single lowercase words: no hyphens', () => {
    for (const { name } of desiredLabels()) {
      const value = name.split(':')[1];
      assert(/^[a-z]+$/.test(value), `${name}: value must be one lowercase word`);
    }
  });

  await test('every value carries a non-empty description', () => {
    for (const { name, description } of desiredLabels()) {
      assert(typeof description === 'string' && description.trim().length > 0, `${name} needs a description`);
    }
  });

  await test('descriptions fit the GitHub API limit (100 chars)', () => {
    // Learned live 2026-07-24: the labels API 422s past 100 characters.
    for (const { name, description } of desiredLabels()) {
      assert(description.length <= 100, `${name} description is ${description.length} chars (max 100)`);
    }
  });

  await test('every value resolves a 6-digit hex color', () => {
    for (const { name, color } of desiredLabels()) {
      assert(/^[0-9A-Fa-f]{6}$/.test(color || ''), `${name} color must be bare 6-digit hex, got ${color}`);
    }
  });

  await test('a fixed label’s hex is its board token’s light value: the pairing, pinned', () => {
    // A label's colour on GitHub is not free-chosen: it is the LIGHT-mode value
    // of the theme token the tower draws that label in, so the board and the
    // issue page agree. Only this half can be pinned here: the token values
    // live in the omega framework, so an edit that breaks the pairing from the
    // hex side fails loudly instead of drifting. Every fixed label is in it
    // since #149: `priority:high` gave up the brand accent, which no fixed hex
    // could track, for the danger red that `status:blocked` also wears.
    const expected = {
      status: {
        inbox: '0F8FA9', specced: '7A45B5', building: 'C47206', qa: 'B0416A', complete: '12925C', blocked: 'D92D20', backlog: 'A1A19E',
      },
      type: { bug: 'D92D20', enhancement: 'A06A08', idea: '7A45B5' },
      priority: { high: 'D92D20', low: 'A1A19E' },
    };
    for (const [group, values] of Object.entries(expected)) {
      for (const [value, color] of Object.entries(values)) {
        assertEq(MANIFEST.groups[group].values[value].color, color, `${group}:${value} wears its token's light value`);
      }
    }
  });

  await test('a hex repeats across the groups but never inside one (#149)', () => {
    // The rule the palette is built on: a colour is unique WITHIN a vocabulary,
    // since a column header, a card chip and a chart slice are read by hue,
    // and free across them, since every chip carries its own word and glyph.
    for (const group of ['status', 'type', 'priority']) {
      const colors = Object.values(MANIFEST.groups[group].values).map((body) => body.color.toUpperCase());
      assertEq(new Set(colors).size, colors.length, `no two ${group}: labels share a colour`);
    }
    assertEq(MANIFEST.groups.type.values.idea.color, MANIFEST.groups.status.values.specced.color, 'idea and specced share the purple');
    assertEq(MANIFEST.groups.priority.values.high.color, MANIFEST.groups.status.values.blocked.color, 'high and blocked share the alarm red');
    assertEq(MANIFEST.groups.priority.values.low.color, MANIFEST.groups.status.values.backlog.color, 'low and backlog share the faint gray');
  });

  await test('status is exclusive and every status description says so', () => {
    assertEq(MANIFEST.groups.status.exclusive, true, 'status.exclusive');
    for (const [value, body] of Object.entries(MANIFEST.groups.status.values)) {
      assert(/exactly one status:/i.test(body.description), `status:${value} must state the one-per-issue rule`);
    }
  });

  await test('priority is exclusive: high plus low on one issue is a contradiction', () => {
    assertEq(MANIFEST.groups.priority.exclusive, true, 'priority.exclusive');
  });

  await test('status and type are the required groups: priority absence means normal', () => {
    for (const [name, body] of Object.entries(MANIFEST.groups)) {
      assertEq(body.required === true, name === 'status' || name === 'type', `${name}.required`);
    }
  });

  await test('type is exclusive: an issue is one kind of thing', () => {
    assertEq(MANIFEST.groups.type.exclusive, true, 'type.exclusive');
  });

  await test('inbox description names triage as the drain', () => {
    assert(/triage/i.test(MANIFEST.groups.status.values.inbox.description), 'status:inbox points at triage');
  });

  await test('building description says the work is in flight', () => {
    assert(/in flight/i.test(MANIFEST.groups.status.values.building.description),
      'status:building is the label in-flight work carries');
  });

  await test('priority descriptions state that absence means normal', () => {
    for (const [value, body] of Object.entries(MANIFEST.groups.priority.values)) {
      assert(/absence/i.test(body.description) && /normal/i.test(body.description),
        `priority:${value} must state absence = normal`);
    }
    assert(!Object.keys(MANIFEST.groups.priority.values).includes('normal'), 'no priority:normal label exists');
  });

  await test('agent:ok grants autonomous work', () => {
    assert(/agent may work/i.test(MANIFEST.groups.agent.values.ok.description), 'agent:ok states the permission');
  });

  group('standards.sh: guards');

  await test('a non-git directory is skipped cleanly', () => {
    const dir = mkTmp();
    const { code, output: stdout } = runScript(dir);
    assertEq(code, 0, 'exit 0');
    assert(stdout.includes('not a git repo'), `says why, got: ${stdout}`);
    assert(!fs.existsSync(path.join(dir, '.github')), 'creates nothing');
    cleanup(dir);
  });

  group('the state directory name is one string per layer');

  // Three layers hold the name (the engine, the hooks, and this harness) and
  // a rename that misses one leaves a hook reading a directory nothing writes.
  const assignment = (file, variable) => {
    const found = new RegExp(`^\\s*(?:const\\s+)?${variable}\\s*=\\s*['"]([^'"]+)['"]`, 'm')
      .exec(fs.readFileSync(file, 'utf8'));
    assert(found, `${variable} is assigned in ${file}`);
    return found[1];
  };

  await test('the engine, the hooks, and the harness all say the same name', () => {
    assertEq(assignment(SCRIPT, 'WORKKIT_DIR'), W, 'standards.sh matches the harness');
    assertEq(assignment(HOOK_LIB, 'WORKKIT_DIR'), W, 'hooks/_lib.sh matches the harness');
  });

  group('standards.sh: .workkit/ in .gitignore');

  await test('adds the .workkit/ pattern when .gitignore is absent', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    const ignore = readFile(path.join(repo, '.gitignore'));
    assert(IGNORE_GLOB.test(ignore), `${W}/* line written, got: ${ignore}`);
    assert(IGNORE_NEGATION.test(ignore), `settings.json re-included, got: ${ignore}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('git honors the pattern: settings.json tracked, the rest ignored', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    fs.mkdirSync(path.join(repo, W), { recursive: true });
    fs.writeFileSync(path.join(repo, W, 'settings.json'), '{ "version": 1 }\n');
    fs.writeFileSync(path.join(repo, W, 'capture.md'), '- a note\n');
    const ignored = (rel) => spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: repo }).status === 0;
    assert(!ignored(`${W}/settings.json`), 'settings.json is committable');
    assert(ignored(`${W}/capture.md`), 'the local capture file stays untracked');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('second run neither duplicates the lines nor reports a change', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    const first = readFile(path.join(repo, '.gitignore'));
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    const second = readFile(path.join(repo, '.gitignore'));
    assertEq(second, first, 'file untouched on re-run');
    assertEq((second.match(IGNORE_GLOB_ALL) || []).length, 1, `exactly one ${W}/* line`);
    assert(stdout.includes('already ignored'), `reports the existing state, got: ${stdout}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('appending to a file with no trailing newline keeps the last line', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/');
    runScript(repo, { pathPrefix: stub.binDir });
    const ignore = readFile(path.join(repo, '.gitignore'));
    assert(/^node_modules\/$/m.test(ignore), `existing entry intact, got: ${ignore}`);
    assert(IGNORE_GLOB.test(ignore), `${W}/* appended on its own line`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a generated .gitignore does not start with a blank line', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    const ignore = readFile(path.join(repo, '.gitignore'));
    assert(!ignore.startsWith('\n'), `no leading blank line, got: ${JSON.stringify(ignore.slice(0, 20))}`);
    cleanup(repo); cleanup(stub.dir);
  });

  // The heal is verified by OUTCOME (git check-ignore), not by grepping for its
  // own block: the two cases below both passed a string check while leaving
  // settings.json untrackable (review regression, 2026-07-24).
  await test('a .gitignore with only .workkit/* gains the negation', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(repo, '.gitignore'), `node_modules\n${W}/*\n`);
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    const ignore = readFile(path.join(repo, '.gitignore'));
    assert(IGNORE_NEGATION.test(ignore), `negation added, got: ${ignore}`);
    assertEq((ignore.match(IGNORE_GLOB_ALL) || []).length, 1, `no duplicate ${W}/* line`);
    const ignored = (rel) => spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: repo }).status === 0;
    assert(!ignored(`${W}/settings.json`), 'the opt-in file is committable');
    assert(ignored(`${W}/capture.md`), 'session state still ignored');
    assert(!stdout.includes('already ignored'), `the broken state is not reported as correct, got: ${stdout}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('the DIRECTORY form .workkit/ is named as needing a human', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(repo, '.gitignore'), `${W}/\n`);
    const { code, output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    // Non-zero means "not fully standardized", which is what lets the hook retry
    // next session instead of caching a half-heal. The hook handles it and still
    // exits 0, so a session start is never wedged.
    assertEq(code, 1, 'a heal needing a human reports itself as unfinished');
    const ignored = spawnSync('git', ['check-ignore', '-q', '--', `${W}/settings.json`], { cwd: repo }).status === 0;
    assert(ignored, 'git cannot descend into an excluded directory, still ignored');
    assert(stdout.includes('STILL ignored'), `the run says so plainly, got: ${stdout}`);
    assert(stdout.includes(`.gitignore:1:${W}/`), `and names the offending line, got: ${stdout}`);
    assert(stdout.includes('not fully standardized'), `the run reports the repo as needing attention, got: ${stdout}`);
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: the .gitignore basics');

  // The two entries every repo needs, read from the engine so the suite asks
  // for whatever the engine actually heals.
  const BASICS = /^GITIGNORE_BASICS="([^"]+)"/m
    .exec(fs.readFileSync(SCRIPT, 'utf8'))[1].split(' ');
  const countLine = (text, entry) =>
    (text.match(new RegExp(`^${entry.replace(/\./g, '\\.')}$`, 'gm')) || []).length;

  await test('a repo with no .gitignore gets both entries', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    const ignore = readFile(path.join(repo, '.gitignore'));
    for (const entry of BASICS) {
      assertEq(countLine(ignore, entry), 1, `${entry} written once, got: ${ignore}`);
    }
    assert(output.includes(`gitignore: added ${BASICS.join(' ')}`),
      `the run reports what it added, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a partial .gitignore gains only the missing entry', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(repo, '.gitignore'), `node_modules\n${BASICS[0]}\n`);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    const ignore = readFile(path.join(repo, '.gitignore'));
    assertEq(countLine(ignore, BASICS[0]), 1, `${BASICS[0]} not duplicated, got: ${ignore}`);
    assertEq(countLine(ignore, BASICS[1]), 1, `${BASICS[1]} appended, got: ${ignore}`);
    assert(output.includes(`gitignore: added ${BASICS[1]}`),
      `only the missing one is reported, got: ${output}`);
    assert(!output.includes(`added ${BASICS[0]}`), 'the present one is not claimed');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('glob forms already covering them are left untouched, and a re-run changes nothing', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const covered = `node_modules\n**/.DS_Store\n*.env\n`;
    fs.writeFileSync(path.join(repo, '.gitignore'), covered);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    const ignore = readFile(path.join(repo, '.gitignore'));
    for (const entry of BASICS) {
      assertEq(countLine(ignore, entry), 0, `${entry} not appended over a covering glob, got: ${ignore}`);
    }
    assert(output.includes(`${BASICS.join(' ')} already ignored`),
      `the run reports the existing state, got: ${output}`);
    const { output: second } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(path.join(repo, '.gitignore')), ignore, 'second run leaves the file alone');
    assert(second.includes('already ignored'), `and says so, got: ${second}`);
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: participation');

  // Four states, two files. A yes (or a deliberate project-level no) is the
  // repo's committed settings.json; never-asked and declined are personal and
  // live in the user file, so a teammate never reads one developer's hesitation
  // as the project's decision (Ian 2026-07-24).
  const stateOf = (repo, opts) => runScript(repo, { ...opts, args: ['--state'] }).stdout.trim();

  // Nothing at all may land in a repo that has not said yes.
  const assertUntouched = (repo) => {
    assert(!fs.existsSync(path.join(repo, '.github')), 'no issue templates written');
    assert(!fs.existsSync(path.join(repo, '.gitignore')), 'no .gitignore written');
    assert(!fs.existsSync(path.join(repo, W)), `no ${W} directory written`);
  };

  await test('enabled: true heals the repo', () => {
    const repo = makeRepo();
    const { code, output: stdout } = runScript(repo);
    assertEq(code, 0, 'exit 0');
    assertEq(stateOf(repo), 'enabled', 'state');
    assert(stdout.includes('issue forms'), `heals, got: ${stdout}`);
    assert(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'templates installed');
    cleanup(repo);
  });

  await test('legacy { version: 1 } with no enabled key still heals', () => {
    const repo = makeRepo({ settings: '{ "version": 1 }\n' });
    const { output: stdout } = runScript(repo);
    assertEq(stateOf(repo), 'enabled', 'an opt-in file that predates the key is a yes');
    assert(stdout.includes('issue forms'), `heals, got: ${stdout}`);
    cleanup(repo);
  });

  await test('enabled: false heals nothing and says nothing', () => {
    const repo = makeRepo({ settings: '{ "version": 1, "enabled": false }\n' });
    const { code, output: stdout } = runScript(repo);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', `the project turned it off on purpose, got: ${stdout}`);
    assertEq(stateOf(repo), 'disabled', 'state');
    assert(!fs.existsSync(path.join(repo, '.github')), 'nothing installed');
    assert(!fs.existsSync(path.join(repo, '.gitignore')), 'nothing appended');
    cleanup(repo);
  });

  await test('no file and no record: offers to enable, writes nothing', () => {
    const repo = makeRepo({ settings: null });
    const { code, output: stdout } = runScript(repo);
    assertEq(code, 0, 'exit 0');
    assertEq(stateOf(repo), 'undecided', 'state');
    assert(stdout.includes('not in the issue workflow'), `offers, got: ${stdout}`);
    assert(stdout.includes('--enable'), 'and says how to opt in');
    assert(stdout.includes('--decline'), 'and how to be left alone');
    assertUntouched(repo);
    cleanup(repo);
  });

  await test('a declined repo is silent and stays untouched', () => {
    const repo = makeRepo({ settings: null });
    const home = mkTmp();
    runScript(repo, { args: ['--decline'], workflowHome: home });
    assertEq(stateOf(repo, { workflowHome: home }), 'declined', 'state');
    const { code, output: stdout } = runScript(repo, { workflowHome: home });
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', `never asks again, got: ${stdout}`);
    assertUntouched(repo);
    cleanup(repo); cleanup(home);
  });

  // The tower clone at <WORKFLOW_HOME>/tower is ENGINE TERRITORY (issue #79):
  // it is a git repo, but it carries no committed opt-in, is never offered, and
  // the heal writes nothing into it.
  const makeHomeClone = () => {
    const home = mkTmp();
    const tower = path.join(home, 'tower');
    fs.mkdirSync(tower, { recursive: true });
    spawnSync('git', ['init', '-q'], { cwd: tower });
    return { home, tower };
  };

  await test('the tower clone is the `home` state: no offer, nothing written', () => {
    const { home, tower } = makeHomeClone();
    assertEq(stateOf(tower, { workflowHome: home }), 'home', 'state');
    const { code, output: stdout } = runScript(tower, { workflowHome: home });
    assertEq(code, 0, 'exit 0');
    assert(!stdout.includes('not in the issue workflow'), `never offered, got: ${stdout}`);
    assertUntouched(tower);
    // And it never joins the roster: the tower finds it by path instead.
    assertEq(JSON.stringify(rosterOf(home)), '{}', 'not registered');
    cleanup(home);
  });

  await test('--enable refuses on the tower clone', () => {
    const { home, tower } = makeHomeClone();
    const { code, output: stdout } = runScript(tower, { workflowHome: home, args: ['--enable'] });
    assert(code !== 0, `the refusal is a failure, got exit ${code}`);
    assert(stdout.includes('engine territory'), `says why, got: ${stdout}`);
    assertUntouched(tower);
    cleanup(home);
  });

  await test('--decline refuses on the tower clone', () => {
    // Symmetric with --enable: a decline recorded against the clone's path
    // would drop the home repo from the board's by-path discovery for good.
    const { home, tower } = makeHomeClone();
    const { code, output: stdout } = runScript(tower, { workflowHome: home, args: ['--decline'] });
    assert(code !== 0, `the refusal is a failure, got exit ${code}`);
    assert(stdout.includes('engine territory'), `says why, got: ${stdout}`);
    assert(!rosterOf(home)[gitPath(fs.realpathSync(tower))], 'no decline recorded');
    assertEq(JSON.stringify(rosterOf(home)), '{}', 'the roster is untouched');
    cleanup(home);
  });

  await test('the user settings file exists from the first run, before any decision', () => {
    // It used to appear only on the first decline, so someone running the
    // workflow system found no ~/.workkit at all and read that as broken
    // (Ian 2026-07-25). The site options spelled out are the honest starting
    // state: it is the hand-edited file (issue #80), and an empty one would
    // show nobody what there is to set.
    const repo = makeRepo({ settings: null });
    const home = path.join(mkTmp(), 'never-touched');
    runScript(repo, { args: ['--state'], workflowHome: home });
    const file = path.join(home, 'settings.json');
    assert(fs.existsSync(file), 'created without any decline');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assertEq(parsed.version, 1, 'seeded with a version');
    assertEq(parsed.repos, undefined, 'the roster is not in the hand-edited file');
    assertEq(parsed.site.repo, null, 'the home repo is unset');
    // Null, not false: the switch has three states (issue #84), and a seeded
    // false is an answer nobody gave: it is what setup reads to know there is
    // still a question to put.
    assert('publish' in parsed.site, 'the switch is spelled out');
    assertEq(parsed.site.publish, null, 'and it is unanswered: nobody has been asked yet');
    assertEq(parsed.site.url, null, 'and there is no custom domain');
    cleanup(repo);
  });

  await test('an existing user settings file is never overwritten by the ensure', () => {
    const repo = makeRepo({ settings: null });
    const home = mkTmp();
    const file = path.join(home, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, site: { repo: 'owner/workkit', publish: true, url: null } }));
    runScript(repo, { args: ['--state'], workflowHome: home });
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assertEq(parsed.site.publish, true, 'what the owner typed survives');
    assertEq(parsed.site.repo, 'owner/workkit', 'home slug and all');
    cleanup(repo); cleanup(home);
  });

  await test('--decline records the repo under repos in the machine\'s roster file', () => {
    // The decline is the machine's record, not the owner's typing, so it lands
    // in `.repos.json` beside the settings rather than in them (issue #80).
    const repo = makeRepo({ settings: null });
    const home = mkTmp();
    const { code, output: stdout } = runScript(repo, { args: ['--decline'], workflowHome: home });
    assertEq(code, 0, 'exit 0');
    assert(stdout.includes('recorded'), `reports the record, got: ${stdout}`);
    const file = path.join(home, '.repos.json');
    assert(fs.existsSync(file), 'the roster file exists');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assertEq(parsed.version, 1, 'seeded with a version');
    const root = fs.realpathSync(repo);
    assertEq(parsed.repos[gitPath(root)], 'declined', 'keyed by the absolute repo root');
    const settings = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
    assertEq(settings.repos, undefined, 'and nothing was written into the hand-edited file');
    cleanup(repo); cleanup(home);
  });

  await test('--decline writes only the repos key: every other key survives', () => {
    const repo = makeRepo({ settings: null });
    const home = mkTmp();
    const seeded = {
      version: 1,
      editor: 'code',
      nested: { keep: ['me', 1] },
      repos: { '/some/other/repo': 'declined' },
    };
    fs.writeFileSync(path.join(home, '.repos.json'), `${JSON.stringify(seeded, null, 2)}\n`);
    runScript(repo, { args: ['--decline'], workflowHome: home });
    const parsed = JSON.parse(fs.readFileSync(path.join(home, '.repos.json'), 'utf8'));
    assertEq(parsed.editor, 'code', 'unrelated key survives with its value');
    assertEq(JSON.stringify(parsed.nested), JSON.stringify({ keep: ['me', 1] }), 'nested value survives');
    assertEq(parsed.repos['/some/other/repo'], 'declined', 'other repo decisions survive');
    assertEq(parsed.repos[gitPath(fs.realpathSync(repo))], 'declined', 'and the new one is added');
    cleanup(repo); cleanup(home);
  });

  await test('--enable writes the committed opt-in and then heals', () => {
    const repo = makeRepo({ settings: null });
    const { code, output: stdout } = runScript(repo, { args: ['--enable'] });
    assertEq(code, 0, 'exit 0');
    const settings = path.join(repo, W, 'settings.json');
    assert(fs.existsSync(settings), 'the repo now carries its yes');
    const parsed = JSON.parse(fs.readFileSync(settings, 'utf8'));
    assertEq(parsed.enabled, true, 'enabled: true');
    // A repo opting in today is born at the current standard: there is no
    // legacy layout for the drift report to find.
    assertEq(parsed.version, STANDARD_VERSION, `version: ${STANDARD_VERSION}`);
    assert(stdout.includes('commit it'), `says the file must be committed, got: ${stdout}`);
    assert(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'and the heal ran');
    assertEq(stateOf(repo), 'enabled', 'state');
    cleanup(repo);
  });

  await test('--enable flips an existing enabled: false back on', () => {
    const repo = makeRepo({ settings: '{ "version": 1, "enabled": false, "keep": "me" }\n' });
    runScript(repo, { args: ['--enable'] });
    const parsed = JSON.parse(fs.readFileSync(path.join(repo, W, 'settings.json'), 'utf8'));
    assertEq(parsed.enabled, true, 'flipped');
    assertEq(parsed.keep, 'me', 'other repo settings survive');
    cleanup(repo);
  });

  await test('--state on a non-git directory says so instead of guessing', () => {
    const dir = mkTmp();
    assertEq(stateOf(dir), 'nogit', 'a directory with no repo has no participation state');
    cleanup(dir);
  });

  group('standards.sh: the roster');

  // The machine-local index the tower reads instead of walking a disk. It is
  // maintained ON CONTACT (a heal registers the repo it is standing in and
  // prunes what has gone away) and it is silent, so every assertion here is
  // against the file rather than the output.
  await test('a heal registers the repo it healed', () => {
    const repo = makeRepo();
    const home = mkTmp();
    const stub = makeGhStub({ authed: false });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    assertEq(code, 0, 'exit 0');
    assertEq(rosterOf(home)[gitPath(fs.realpathSync(repo))], 'enabled', 'keyed by the absolute repo root');
    assert(!/roster/.test(output), `registration is silent, got: ${output}`);
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  await test('running twice registers once: no duplicate, no rewrite', () => {
    const repo = makeRepo();
    const home = mkTmp();
    const stub = makeGhStub({ authed: false });
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    const file = path.join(home, '.repos.json');
    const first = fs.readFileSync(file, 'utf8');
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    assertEq(fs.readFileSync(file, 'utf8'), first, 'an up-to-date roster is not written again');
    assertEq(Object.keys(rosterOf(home)).length, 1, 'and the repo appears once');
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  await test('--enable registers the repo it just opted in', () => {
    const repo = makeRepo({ settings: null });
    const home = mkTmp();
    const stub = makeGhStub({ authed: false });
    runScript(repo, { args: ['--enable'], pathPrefix: stub.binDir, workflowHome: home });
    assertEq(rosterOf(home)[gitPath(fs.realpathSync(repo))], 'enabled', 'joining and being indexed are one act');
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  await test('sessions opening at once in several repos all end registered', async () => {
    // The roster edit is a whole-file read-modify-write, so without the mutex
    // the last writer wins and the other repos are silently left off. Three
    // heals started together against ONE user settings file; every one of them
    // has to be on the roster when they finish.
    //
    // And the home repo's writers edit that same file: `wk_home_set_slug` runs
    // alongside them here, because a mutex only two of the three writers take
    // is not a mutex: the slug it records has to survive as well.
    //
    // The roster is not the only machine-level thing they all write: the
    // engine's address is one path for the whole machine, so the claude home
    // below EXISTS, which is what puts that step in the race too. A heal that
    // ends on it never reaches the roster at all, so the count alone would
    // report a lost write for a session that died two steps earlier.
    const home = mkTmp();
    const stub = makeGhStub({ authed: false });
    const repos = [makeRepo(), makeRepo(), makeRepo()];
    const claudeHome = path.join(mkTmp(), 'claude-home');
    fs.mkdirSync(claudeHome, { recursive: true });
    const basePath = joinPath(stub.binDir, SYSTEM_PATH, NODE_DIR);
    // Seeded here rather than by whichever process gets there first: the race
    // under test is the EDIT, and two creations racing is a different one.
    fs.writeFileSync(path.join(home, '.repos.json'), `${JSON.stringify({ version: 1, repos: {} }, null, 2)}\n`);
    fs.writeFileSync(
      path.join(home, 'settings.json'),
      `${JSON.stringify({ version: 1, site: { repo: null, publish: false, url: null } }, null, 2)}\n`,
    );
    const env = {
      ...process.env,
      PATH: basePath,
      WORKFLOW_HOME: shellPath(home),
      WORKFLOW_CLAUDE_HOME: shellPath(claudeHome),
    };
    // Sourced by their POSIX spelling, like every other path handed INTO a
    // shell: a `C:\...` source gives `${BASH_SOURCE[0]%/*}` no `/` to cut, so
    // lib.sh dies on the sibling it loads and the writer below is never
    // defined at all.
    const setSlug = [
      'set -euo pipefail',
      `. ${JSON.stringify(shellPath(path.join(WORKFLOW_DIR, 'lib.sh')))}`,
      `. ${JSON.stringify(shellPath(path.join(WORKFLOW_DIR, 'discussions.sh')))}`,
      `. ${JSON.stringify(shellPath(path.join(WORKFLOW_DIR, 'home.sh')))}`,
      'wk_home_set_slug owner/workkit',
    ].join('\n');
    const [codes, slugCode] = await Promise.all([
      Promise.all(repos.map((repo) => new Promise((resolve) => {
        const child = spawn(BASH, [...NO_RC, shellPath(SCRIPT), shellPath(repo)], { env, stdio: 'ignore' });
        child.on('close', (code) => resolve(code));
      }))),
      new Promise((resolve) => {
        const child = spawn(BASH, [...NO_RC, '-c', setSlug], { env, stdio: 'ignore' });
        child.on('close', (code) => resolve(code));
      }),
    ]);
    assertEq(codes.join(','), '0,0,0', `every session finished, none of them ended on a step another one won: ${codes.join(',')}`);
    // Swept before it is asserted on, never after: a regression here writes a
    // link INSIDE the tracked engine folder, and one left lying there is a
    // loop the next run of this suite walks into.
    const stray = path.join(WORKFLOW_DIR, 'workflow');
    const strayed = fs.existsSync(stray);
    if (strayed) fs.rmSync(stray, { recursive: true, force: true });
    assert(!strayed, 'and none of them wrote the address INSIDE the engine folder');
    // The address itself is what they were racing over, so it is asserted on
    // directly: writing it by unlinking and re-creating leaves a gap where a
    // second session finds nothing there, and the roster count cannot see that.
    const address = path.join(claudeHome, 'workkit');
    const made = fs.lstatSync(address, { throwIfNoEntry: false });
    assert(!!made && made.isSymbolicLink(), 'the address they all wrote is a symlink, neither gone nor a copy');
    assertEq(fs.realpathSync(address), fs.realpathSync(WORKFLOW_DIR), 'and it resolves to this engine');
    const roster = rosterOf(home);
    for (const repo of repos) {
      assertEq(roster[gitPath(fs.realpathSync(repo))], 'enabled', `${path.basename(repo)} survived the concurrent write`);
    }
    // The writer's own status, read rather than dropped: a slug writer that
    // died says so here, instead of arriving as a null on the next line with
    // nothing to account for it.
    assertEq(slugCode, 0, 'the slug writer finished');
    const settings = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
    assertEq(settings.site.repo, 'owner/workkit', 'and so did the home slug written beside them');
    assert(!fs.existsSync(path.join(home, '.state.lock')), 'and the lock is released, not left behind');
    for (const repo of repos) cleanup(repo);
    cleanup(home); cleanup(stub.dir);
  });

  // The global layer's half of the same fact used to be a committed project
  // list in the home repo. Issue #77 retired it: the dashboard's board data is
  // baked from this machine's roster at publish time and never committed as
  // source, so the heal owes the global layer nothing but the roster above.
  await test('the heal writes nothing into the global layer but the roster', () => {
    const repo = makeRepo();
    const home = mkTmp();
    const stub = makeGhStub({ authed: false });
    const { code } = runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    assertEq(code, 0, 'exit 0');

    const left = fs.readdirSync(home).sort();
    assertEq(left.join(','), '.repos.json,settings.json', `only the machine state: ${left.join(', ')}`);
    assertEq(rosterOf(home)[gitPath(fs.realpathSync(repo))], 'enabled', 'and the roster is the thing it wrote');
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  await test('a ~/.workkit holding a tower clone is not touched by the heal', () => {
    // The tower repo is a repo like any other: it is healed by standing IN it,
    // never by a heal of some other repo reaching across into it.
    const repo = makeRepo();
    const home = mkTmp();
    const tower = path.join(home, 'tower');
    fs.mkdirSync(tower, { recursive: true });
    spawnSync('git', ['init', '-q'], { cwd: tower });
    spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/owner/workkit.git'], { cwd: tower });
    fs.writeFileSync(
      path.join(home, 'settings.json'),
      `${JSON.stringify({ version: 1, site: { repo: 'owner/workkit', publish: false, url: null } }, null, 2)}\n`,
    );

    const stub = makeGhStub({ authed: false });
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    const status = spawnSync('git', ['-C', tower, 'status', '--short'], { encoding: 'utf8' }).stdout;
    assertEq(status.trim(), '', `nothing was written into the clone: ${status}`);
    const log = spawnSync('git', ['-C', tower, 'log', '--oneline'], { encoding: 'utf8' });
    assert(!log.stdout.trim(), `and nothing was committed there: ${log.stdout}`);
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  await test('an entry whose path is gone, and one that turned itself off, are pruned', () => {
    const repo = makeRepo();
    const gone = mkTmp();
    const off = makeRepo({ settings: '{ "version": 1, "enabled": false }\n' });
    const home = mkTmp();
    fs.writeFileSync(path.join(home, '.repos.json'), JSON.stringify({
      version: 1,
      repos: { [gitPath(gone)]: 'enabled', [gitPath(fs.realpathSync(off))]: 'enabled' },
    }, null, 2));
    cleanup(gone);

    const stub = makeGhStub({ authed: false });
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    const roster = rosterOf(home);
    assertEq(roster[gone], undefined, 'the path that no longer exists is dropped');
    assertEq(roster[gitPath(fs.realpathSync(off))], undefined, 'and so is the repo whose committed file now says no');
    assertEq(roster[gitPath(fs.realpathSync(repo))], 'enabled', 'while the repo being healed is registered');
    cleanup(repo); cleanup(off); cleanup(home); cleanup(stub.dir);
  });

  await test('an entry whose committed settings file was deleted is pruned too', () => {
    // Removing the committed file is the tri-state's way back to undecided, so
    // the entry is exactly as stale as a path that no longer exists.
    const repo = makeRepo();
    const left = makeRepo();
    fs.rmSync(path.join(left, W, 'settings.json'));
    const home = mkTmp();
    fs.writeFileSync(path.join(home, '.repos.json'), JSON.stringify({
      version: 1,
      repos: { [gitPath(fs.realpathSync(left))]: 'enabled' },
    }, null, 2));

    const stub = makeGhStub({ authed: false });
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    assertEq(rosterOf(home)[gitPath(fs.realpathSync(left))], undefined, 'no committed answer, no membership');
    cleanup(repo); cleanup(left); cleanup(home); cleanup(stub.dir);
  });

  await test('a legacy opt-in with no enabled key is kept: it is still a yes', () => {
    // resolve_state reads a file that predates the key as opted in, and the
    // prune has to read it the same way or it would evict a member.
    const repo = makeRepo();
    const legacy = makeRepo({ settings: '{ "version": 1 }\n' });
    const home = mkTmp();
    fs.writeFileSync(path.join(home, '.repos.json'), JSON.stringify({
      version: 1,
      repos: { [gitPath(fs.realpathSync(legacy))]: 'enabled' },
    }, null, 2));

    const stub = makeGhStub({ authed: false });
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    assertEq(rosterOf(home)[gitPath(fs.realpathSync(legacy))], 'enabled', 'the legacy shape stays on the roster');
    cleanup(repo); cleanup(legacy); cleanup(home); cleanup(stub.dir);
  });

  await test('a decline is a decision, not an observation: it is never pruned', () => {
    const repo = makeRepo();
    const declined = mkTmp();
    const home = mkTmp();
    fs.writeFileSync(path.join(home, '.repos.json'), JSON.stringify({
      version: 1,
      editor: 'code',
      repos: { [gitPath(declined)]: 'declined' },
    }, null, 2));
    cleanup(declined);

    const stub = makeGhStub({ authed: false });
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    const parsed = JSON.parse(fs.readFileSync(path.join(home, '.repos.json'), 'utf8'));
    assertEq(parsed.repos[gitPath(declined)], 'declined', 'the decline survives a vanished path');
    assertEq(parsed.editor, 'code', 'and every other key survives the write');
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  await test('an undecided repo is never registered: nothing observes it', () => {
    const repo = makeRepo({ settings: null });
    const home = mkTmp();
    const stub = makeGhStub({ authed: false });
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    assertEq(Object.keys(rosterOf(home)).length, 0, 'the offer writes nothing, here included');
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  await test('a malformed roster file warns and skips: the heal still finishes', () => {
    const repo = makeRepo();
    const home = mkTmp();
    fs.writeFileSync(path.join(home, '.repos.json'), '{ not json');
    const stub = makeGhStub({ authed: false });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    assertEq(code, 0, 'a broken index never fails a heal');
    assert(/not valid JSON/.test(output), `it says what is wrong, got: ${output}`);
    assertEq(fs.readFileSync(path.join(home, '.repos.json'), 'utf8'), '{ not json', 'and the file is left alone');
    assertEq(fs.readdirSync(home).sort().join(','), '.repos.json,settings.json', 'with no temp file left behind');
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  await test('without jq the roster is simply not maintained', () => {
    const repo = makeRepo();
    const home = mkTmp();
    // A PATH with no jq anywhere on it: the roster edit is a jq edit, and a
    // machine without it must lose the index, never the heal.
    const binDir = binDirWithout('jq');
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), shellPath(repo)], {
      env: { PATH: binDir, WORKFLOW_HOME: shellPath(home), WORKFLOW_CLAUDE_HOME: shellPath(path.join(mkTmp(), 'ch')) },
      encoding: 'utf8',
      timeout: 20000,
    });
    assertEq(res.status, 0, `the heal runs without it: ${res.stderr}`);
    assertEq(rosterOf(home)[gitPath(fs.realpathSync(repo))], undefined, 'no jq, no edit, and no half-written file');
    cleanup(repo); cleanup(home); cleanup(binDir);
  });

  // Windows is the machine where one repo has two spellings: git prints
  // `C:/Users/x` and the Git Bash around it says `/c/Users/x`. A roster holding
  // both is a repo the tower lists twice and a decline that stops nothing, so
  // the key is git's spelling and every write and every lookup asks
  // `wk_git_path` for it. The branch is driven from here rather than only on
  // Windows so the rule holds at every commit: OSTYPE is what the engine
  // branches on, and bash honors an inherited one.
  const msysWorld = () => {
    const cyg = mkTmp();
    cygpathStub(cyg);
    return cyg;
  };

  await test('the roster key is git\'s spelling of the repo root, on the Windows branch too', () => {
    const repo = makeRepo();
    const home = mkTmp();
    const stub = makeGhStub({ authed: false });
    const cyg = msysWorld();
    const { code } = runScript(repo, {
      pathPrefix: joinPath(cyg, stub.binDir), workflowHome: home, env: { OSTYPE: 'msys' },
    });
    assertEq(code, 0, 'exit 0');
    const keys = Object.keys(rosterOf(home));
    assertEq(keys.length, 1, `one repo, one key, got: ${keys.join(' + ')}`);
    assertEq(keys[0], winRosterKey(repo), 'spelled the way git spells it');
    cleanup(repo); cleanup(home); cleanup(stub.dir); cleanup(cyg);
  });

  await test('a decline writes that same key, and the state read after it finds it', () => {
    const repo = makeRepo({ settings: null });
    const home = mkTmp();
    const stub = makeGhStub({ authed: false });
    const cyg = msysWorld();
    const opts = {
      pathPrefix: joinPath(cyg, stub.binDir), workflowHome: home, env: { OSTYPE: 'msys' },
    };
    runScript(repo, { ...opts, args: ['--decline'] });
    const keys = Object.keys(rosterOf(home));
    assertEq(keys.length, 1, `the decline wrote one key, got: ${keys.join(' + ')}`);
    assertEq(keys[0], winRosterKey(repo), 'git\'s spelling, the one every lookup asks for');
    const { stdout } = runScript(repo, { ...opts, args: ['--state'] });
    assertEq(stdout.trim(), 'declined', 'and the lookup finds what the write left');
    cleanup(repo); cleanup(home); cleanup(stub.dir); cleanup(cyg);
  });

  group('standards.sh: it fails loudly, never silently');

  // Every case here was a reproduced defect before 3.1.0: the suite proved the
  // happy path across all four states and nothing about what happens when the
  // ground shifts (review findings, 2026-07-24).

  // The engine runs under `set -e` on whatever bash the machine has. A bare
  // `(( x++ ))` yields the value BEFORE the increment, so a counter starting at
  // 0 makes the command exit non-zero on its first pass; bash 4.1 and later end
  // the run there. Stock macOS bash is 3.2 and does not, so the shape has to be
  // banned by inspection: no Darwin test run would ever fail on it.
  await test('no arithmetic command that can exit non-zero under errexit', () => {
    const offenders = fs.readFileSync(SCRIPT, 'utf8').split('\n')
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => /^\(\(.*\)\)\s*$/.test(line));
    assertEq(offenders.length, 0,
      `use an assignment or [ ] instead, got: ${offenders.map((o) => `line ${o.n}: ${o.line}`).join(', ')}`);
  });

  await test('every shipped template is tracked by git', () => {
    // The suite reads templates from the working tree, so an untracked one
    // passes every other test and then breaks every machine that pulls.
    const listed = spawnSync('git', ['ls-files', 'workflow/templates'], {
      cwd: path.join(__dirname, '..', '..'), encoding: 'utf8',
    }).stdout.split('\n').filter(Boolean);
    const onDisk = [];
    const walk = (dir, prefix) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}/`);
        else onDisk.push(`workflow/templates/${prefix}${e.name}`);
      }
    };
    walk(path.join(WORKFLOW_DIR, 'templates'), '');
    for (const f of onDisk) assert(listed.includes(f), `${f} is on disk but untracked: a fresh clone would half-heal`);
  });

  await test('a missing template warns, keeps healing, and exits non-zero', () => {
    const engine = mkTmp();
    spawnSync('cp', ['-R', `${WORKFLOW_DIR}/.`, engine]);
    fs.rmSync(path.join(engine, 'templates', 'session.md'));
    const repo = makeRepo();
    const stub = makeGhStub();
    const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(engine, 'standards.sh')), shellPath(repo)], {
      env: {
        ...process.env, PATH: systemPathWith(stub.binDir),
        WORKFLOW_HOME: shellPath(path.join(mkTmp(), 'wh')), WORKFLOW_CLAUDE_HOME: shellPath(path.join(mkTmp(), 'ch')),
      },
      encoding: 'utf8', timeout: 20000,
    });
    const out = (res.stdout || '') + (res.stderr || '');
    assert(out.includes('template missing'), `names the missing template, got: ${out}`);
    assertEq(res.status, 1, 'a partial heal exits non-zero so the caller can tell');
    assert(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'and the rest of the heal still ran');
    cleanup(repo); cleanup(stub.dir); cleanup(engine);
  });

  await test('a missing labels.json still answers --state and --announce, and the heal says what broke', () => {
    // The manifest check used to sit before mode dispatch, so a broken install
    // answered --state with exit 1, which the hook read as nogit and went
    // silent forever.
    const engine = mkTmp();
    spawnSync('cp', ['-R', `${WORKFLOW_DIR}/.`, engine]);
    fs.rmSync(path.join(engine, 'labels.json'));
    const repo = makeRepo();
    const env = {
      ...process.env, PATH: SYSTEM_PATH,
      WORKFLOW_HOME: shellPath(path.join(mkTmp(), 'wh')), WORKFLOW_CLAUDE_HOME: shellPath(path.join(mkTmp(), 'ch')),
    };
    const state = spawnSync(BASH, [...NO_RC, shellPath(path.join(engine, 'standards.sh')), '--state', shellPath(repo)], { env, encoding: 'utf8', timeout: 20000 });
    assertEq(state.status, 0, '--state answers without the manifest');
    assertEq((state.stdout || '').trim(), 'enabled', 'and answers correctly');
    const announce = spawnSync(BASH, [...NO_RC, shellPath(path.join(engine, 'standards.sh')), '--announce', shellPath(repo)], { env, encoding: 'utf8', timeout: 20000 });
    assertEq(announce.status, 0, '--announce answers without the manifest');
    assert((announce.stdout || '').includes('--enable'), 'and still offers');
    const heal = spawnSync(BASH, [...NO_RC, shellPath(path.join(engine, 'standards.sh')), shellPath(repo)], { env, encoding: 'utf8', timeout: 20000 });
    const out = (heal.stdout || '') + (heal.stderr || '');
    assert(out.includes('labels.json missing'), `the heal names the broken install, got: ${out}`);
    assertEq(heal.status, 1, 'and exits non-zero so the caller retries');
    assert(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'the local heals still ran');
    cleanup(repo); cleanup(engine);
  });

  await test('a timed-out decline leaves the other run\'s lock in place', () => {
    // The rmdir trap used to be installed even when the lock was never
    // acquired, so a run that gave up after 5s deleted another run's mutex on
    // its way out.
    const repo = makeRepo({ settings: null });
    const home = mkTmp();
    fs.mkdirSync(path.join(home, '.state.lock'), { recursive: true });
    const { output } = runScript(repo, { args: ['--decline'], workflowHome: home });
    assert(output.includes('without the lock'), `says it proceeded unlocked, got: ${output}`);
    assert(fs.existsSync(path.join(home, '.state.lock')), 'the mutex it never held survives');
    assertEq(rosterOf(home)[gitPath(fs.realpathSync(repo))], 'declined', 'the decline is still recorded');
    // And a decline that did acquire the lock removes its own on exit.
    const home2 = mkTmp();
    runScript(repo, { args: ['--decline'], workflowHome: home2 });
    assert(!fs.existsSync(path.join(home2, '.state.lock')), 'a held lock is released');
    cleanup(repo); cleanup(home); cleanup(home2);
  });

  await test('a repo settings.json that is not valid JSON never resolves to enabled', () => {
    const repo = makeRepo({ settings: 'garbage{\n' });
    assertEq(runScript(repo, { args: ['--state'] }).stdout.trim(), 'unreadable', 'an unparseable answer is not a legacy yes');
    const { output } = runScript(repo);
    assert(output.includes('not valid JSON'), `and it says so, got: ${output}`);
    assert(!fs.existsSync(path.join(repo, '.github')), 'healing nothing until it is fixed');
    cleanup(repo);
  });

  await test('a committed no with a severed tail is still a no, never a heal', () => {
    // jq prints the answer it parsed and THEN fails on the tail, so a read
    // whose fallback is appended to that answer resolves to neither `false`
    // nor `unreadable`: it falls through to the enabled arm and heals a repo
    // that said no.
    const repo = makeRepo({ settings: '{ "version": 1, "enabled": false }{\n' });
    assertEq(runScript(repo, { args: ['--state'] }).stdout.trim(), 'disabled', 'the deliberate no is read as a no');
    const { output } = runScript(repo);
    assertEq(output, '', `nothing is said about a repo that opted out, got: ${output}`);
    assert(!fs.existsSync(path.join(repo, '.github')), 'and nothing is written into it');
    cleanup(repo);
  });

  await test('a severed tail does not cost a repo the version it recorded', () => {
    // The version read is the same file read, one line down: jq prints the
    // version and then fails on the tail, so a read that throws that answer
    // away calls a current repo a legacy one and tries to stamp a version it
    // already carries onto a file nothing can write.
    const repo = makeRepo({ settings: `{ "version": ${STANDARD_VERSION}, "enabled": true }{\n` });
    const { output } = runScript(repo);
    assert(output.includes('issue forms'), `the mechanical heals still run, got: ${output}`);
    assert(!/not valid JSON/.test(output),
      `a repo already at the standard is not stamped again, got: ${output}`);
    cleanup(repo);
  });

  await test('a malformed roster file: declines cleanly, records nothing, leaves no litter', () => {
    const home = mkTmp();
    fs.writeFileSync(path.join(home, '.repos.json'), '{ this is not json\n');
    const repo = makeRepo({ settings: null });
    const { output } = runScript(repo, { args: ['--decline'], workflowHome: home });
    assert(output.includes('not valid JSON'), `says what is wrong, got: ${output}`);
    assertEq(fs.readdirSync(home).filter((f) => f.includes('.tmp.')).length, 0, 'and leaves no temp file behind');
    cleanup(repo); cleanup(home);
  });

  await test('a symlinked roster file is updated in place, not replaced', () => {
    // This repo's whole model is symlinking config out of ~, so writing over the
    // link would replace it with a regular file and orphan the real one.
    const home = mkTmp();
    const realDir = mkTmp();
    const realFile = path.join(realDir, '.repos.json');
    fs.writeFileSync(realFile, '{\n  "version": 1,\n  "repos": {},\n  "digest": { "hour": 9 }\n}\n');
    fs.symlinkSync(realFile, path.join(home, '.repos.json'));
    const repo = makeRepo({ settings: null });
    runScript(repo, { args: ['--decline'], workflowHome: home });
    assert(fs.lstatSync(path.join(home, '.repos.json')).isSymbolicLink(), 'still a symlink');
    const written = JSON.parse(fs.readFileSync(realFile, 'utf8'));
    assertEq(written.repos[gitPath(fs.realpathSync(repo))] || written.repos[gitPath(repo)], 'declined', 'the real target got the decline');
    assertEq(written.digest.hour, 9, 'and an unrelated key survived');
    cleanup(repo); cleanup(home); cleanup(realDir);
  });

  await test('declining a repo whose committed file says yes admits it will not take effect', () => {
    const home = mkTmp();
    const repo = makeRepo();
    const { output } = runScript(repo, { args: ['--decline'], workflowHome: home });
    assert(/committed answer, which wins/.test(output), `does not claim a decline it cannot deliver, got: ${output}`);
    assertEq(runScript(repo, { args: ['--state'], workflowHome: home }).stdout.trim(), 'enabled', 'and the repo file still wins');
    cleanup(repo); cleanup(home);
  });

  await test('no jq: a committed enabled:false is still honored, not healed over', () => {
    // The grep fallback exists for exactly this; the only jq-free test used an
    // enabled repo, so the branch that matters had no coverage.
    const repo = makeRepo({ settings: '{ "version": 1, "enabled": false }\n' });
    const binDir = mkTmp();
    // cygpath is the engine's path spelling on Windows (wk_git_path), as much a
    // need there as git; `which` answers nothing for it on macOS and Linux.
    for (const tool of ['git', 'grep', 'tail', 'head', 'cp', 'mkdir', 'tr', 'cat', 'dirname', 'basename', 'cygpath']) {
      const real = which(tool);
      if (real) linkTool(binDir, real);
    }
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), '--state', shellPath(repo)], {
      env: { PATH: binDir, WORKFLOW_HOME: shellPath(path.join(binDir, 'wh')) }, encoding: 'utf8', timeout: 20000,
    });
    assertEq((res.stdout || '').trim(), 'disabled', 'a deliberate no survives a jq-less machine');
    cleanup(repo); cleanup(binDir);
  });

  await test('the offer line survives a repo path containing a space', () => {
    const parent = mkTmp();
    const repo = path.join(parent, 'has space');
    fs.mkdirSync(repo);
    spawnSync('git', ['init', '-q'], { cwd: repo });
    const { stdout } = runScript(repo, { args: ['--announce'] });
    assert(!/--enable [^'"]*has space/.test(stdout), `the suggested command must survive a paste, got: ${stdout}`);
    cleanup(parent);
  });

  group("standards.sh: the engine's address");

  // ~/.claude/workkit → the engine. The step runs on a real HEAL from a
  // CANONICAL checkout: this suite's SCRIPT is that checkout, and every claude
  // home below is a temp directory, so the machine's own address is untouched.
  const ENGINE = path.resolve(WORKFLOW_DIR);
  const claudeHomeWith = () => {
    const home = mkTmp();
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    return { home, claude: path.join(home, '.claude') };
  };

  await test('links ~/.claude/workkit at the engine it is running from', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const { output } = runScript(repo, { claudeHome: claude });
    const link = path.join(claude, 'workkit');
    assertEq(fs.realpathSync(link), fs.realpathSync(ENGINE), 'the address points at this engine');
    assert(fs.lstatSync(link).isSymbolicLink(), 'and it is a symlink, not a copy');
    assert(output.includes('engine: linked'), `says so once, got: ${output}`);
    cleanup(repo); cleanup(claude);
  });

  await test('an address already correct is silent: the step is idempotent', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    runScript(repo, { claudeHome: claude });
    const { output } = runScript(repo, { claudeHome: claude });
    assert(!output.includes('engine:'), `a correct address says nothing, got: ${output}`);
    assertEq(fs.realpathSync(path.join(claude, 'workkit')), fs.realpathSync(ENGINE), 'and stays put');
    cleanup(repo); cleanup(claude);
  });

  await test('an address pointing somewhere else is repaired', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const stale = mkTmp();
    fs.symlinkSync(stale, path.join(claude, 'workkit'));
    const { output } = runScript(repo, { claudeHome: claude });
    assertEq(fs.realpathSync(path.join(claude, 'workkit')), fs.realpathSync(ENGINE), 'repointed at this engine');
    assert(output.includes('engine: repointed'), `and says so, got: ${output}`);
    cleanup(repo); cleanup(claude); cleanup(stale);
  });

  // The address is ONE path for the whole machine, so sessions opening at once
  // in several repos all write it. What it must never be is MISSING: a maker
  // that unlinks the address and then creates it leaves a gap, and a session
  // reading it in that gap finds no engine at all, while every one of those
  // sessions still exits 0 and registers its repo. Nothing but repetition can
  // see that, so the rounds are the case: three sessions, because that is the
  // smallest number with a loser reading while another one writes.
  await test('sessions writing the address at once never leave it missing', async () => {
    const { claude } = claudeHomeWith();
    const address = path.join(claude, 'workkit');
    const env = {
      ...process.env,
      PATH: joinPath(SYSTEM_PATH, NODE_DIR),
      WORKFLOW_HOME: shellPath(path.join(mkTmp(), 'workflow-home')),
      WORKFLOW_CLAUDE_HOME: shellPath(claude),
    };
    for (let round = 1; round <= 20; round++) {
      fs.rmSync(address, { recursive: true, force: true });
      // eslint-disable-next-line no-await-in-loop
      await Promise.all([0, 1, 2].map(() => new Promise((resolve) => {
        const child = spawn(BASH, [...NO_RC, shellPath(SCRIPT), '--engine-link'], { env, stdio: 'ignore' });
        child.on('close', resolve);
      })));
      const made = fs.lstatSync(address, { throwIfNoEntry: false });
      assert(!!made && made.isSymbolicLink(), `round ${round}: the address is a symlink, not gone`);
      assertEq(fs.realpathSync(address), fs.realpathSync(ENGINE), `round ${round}: and it resolves to this engine`);
    }
    const stray = path.join(ENGINE, 'workflow');
    const strayed = fs.existsSync(stray);
    if (strayed) fs.rmSync(stray, { recursive: true, force: true });
    assert(!strayed, 'and no round wrote a link inside the engine folder');
    cleanup(claude);
  });

  // Git Bash without symlink rights answers `ln -s` with a COPY and exit 0.
  // A copy at the engine's address is worse than no address at all: the marker
  // scripts the skills call sit one level ABOVE the engine folder (#245), so a
  // copy of the engine hides them and every skill's fallback resolves into
  // ~/.claude. The `ln` stub below is that machine, on this one.
  await test('an `ln` that copies instead of linking: the copy is removed and named', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const bin = mkTmp();
    stubTool(bin, 'ln', [
      '#!/bin/bash',
      '# Git Bash without symlink rights: a copy, and exit 0.',
      'dst="${@: -1}"; src="${@: -2:1}"',
      'cp -R "$src" "$dst"',
    ]);
    const link = path.join(claude, 'workkit');
    const { output } = runScript(repo, { claudeHome: claude, pathPrefix: bin });
    assert(!fs.existsSync(link), `the copy is removed, not left at the address, got: ${output}`);
    assert(output.includes('engine:') && output.includes(shellPath(link)),
      `and the human is told, naming the address, got: ${output}`);
    assert(/symlink/.test(output), `and what is wrong with it, got: ${output}`);
    assert(!output.includes('engine: linked'), `never reported as linked, got: ${output}`);
    cleanup(repo); cleanup(claude); cleanup(bin);
  });

  await test('a REAL directory at the address is never replaced', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const real = path.join(claude, 'workkit');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, 'keep.txt'), 'mine\n');
    const { output } = runScript(repo, { claudeHome: claude });
    assert(fs.statSync(real).isDirectory() && !fs.lstatSync(real).isSymbolicLink(), 'the directory survives');
    assertEq(fs.readFileSync(path.join(real, 'keep.txt'), 'utf8'), 'mine\n', 'with its contents');
    assert(output.includes('is a real file or directory'), `and the human is told, got: ${output}`);
    cleanup(repo); cleanup(claude);
  });

  await test('no ~/.claude on the machine: nothing is created', () => {
    const repo = makeRepo();
    const home = mkTmp();
    const claude = path.join(home, '.claude');
    const { output } = runScript(repo, { claudeHome: claude });
    assert(!fs.existsSync(claude), 'the engine creates no agent directory of its own');
    assert(!output.includes('engine:'), `and says nothing about it, got: ${output}`);
    cleanup(repo); cleanup(home);
  });

  // The address belongs to the machine's real engine, and only a real heal from
  // it may write one. A --state probe or a fixture copy that repointed it stole
  // the machine's engine from under every other session, which is exactly what
  // a partial-checkout test run did on 2026-07-29.
  await test('a probe never touches the address: --state and --announce', () => {
    for (const args of [['--state'], ['--announce']]) {
      const repo = makeRepo();
      const { claude } = claudeHomeWith();
      const { output } = runScript(repo, { args, claudeHome: claude });
      assert(!fs.existsSync(path.join(claude, 'workkit')), `${args[0]} asked a question and wrote nothing`);
      assert(!output.includes('engine:'), `and said nothing about the address, got: ${output}`);
      cleanup(repo); cleanup(claude);
    }
  });

  // The machine-side install (`workkit setup|update`) needs the address without
  // a heal of anything, and must not own a second copy of the step.
  await test('--engine-link writes the address and heals nothing', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const { output } = runScript(repo, { args: ['--engine-link'], claudeHome: claude });
    assertEq(fs.realpathSync(path.join(claude, 'workkit')), fs.realpathSync(ENGINE), 'the address points at this engine');
    assert(!output.includes('standards:'), `and nothing else ran, got: ${output}`);
    cleanup(repo); cleanup(claude);
  });

  await test('a probe leaves an EXISTING address alone', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const other = mkTmp();
    fs.symlinkSync(other, path.join(claude, 'workkit'));
    runScript(repo, { args: ['--state'], claudeHome: claude });
    assertEq(fs.realpathSync(path.join(claude, 'workkit')), fs.realpathSync(other),
      'the address a probe found is the address it leaves');
    cleanup(repo); cleanup(claude); cleanup(other);
  });

  await test('a repo that has not said yes never repoints it', () => {
    const repo = makeRepo({ settings: null });
    const { claude } = claudeHomeWith();
    runScript(repo, { claudeHome: claude, workflowHome: path.join(mkTmp(), 'wh') });
    assert(!fs.existsSync(path.join(claude, 'workkit')), 'an undecided repo is offered, and nothing else happens');
    cleanup(repo); cleanup(claude);
  });

  await test('a NON-canonical copy of the engine leaves the address alone, silently', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    // A copy in a temp directory: no git repo above it, which is what a
    // fixture, an archive, or a partial checkout looks like.
    const copy = mkTmp();
    spawnSync('cp', ['-R', `${WORKFLOW_DIR}/.`, copy]);
    const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(copy, 'standards.sh')), shellPath(repo)], {
      env: {
        ...process.env,
        PATH: joinPath(SYSTEM_PATH, NODE_DIR),
        WORKFLOW_HOME: shellPath(path.join(mkTmp(), 'wh')),
        WORKFLOW_CLAUDE_HOME: shellPath(claude),
      },
      encoding: 'utf8',
      timeout: 20000,
    });
    assertEq(res.status, 0, `the heal itself still runs: ${res.stderr}`);
    assert(!fs.existsSync(path.join(claude, 'workkit')), 'a copy is not the machine engine and takes no address');
    assert(!(res.stdout + res.stderr).includes('engine:'), `and says nothing: it is a skip, not a fault, got: ${res.stderr}`);
    cleanup(repo); cleanup(claude); cleanup(copy);
  });

  await test('a copy whose origin is some OTHER repo leaves it alone too', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    // A git repo this time, so only the origin tells the two apart.
    const copyRoot = mkTmp();
    const copy = path.join(copyRoot, 'workflow');
    fs.mkdirSync(copy, { recursive: true });
    spawnSync('cp', ['-R', `${WORKFLOW_DIR}/.`, copy]);
    spawnSync('git', ['init', '-q'], { cwd: copyRoot });
    spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/someone/not-the-kit.git'], { cwd: copyRoot });
    const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(copy, 'standards.sh')), shellPath(repo)], {
      env: {
        ...process.env,
        PATH: joinPath(SYSTEM_PATH, NODE_DIR),
        WORKFLOW_HOME: shellPath(path.join(mkTmp(), 'wh')),
        WORKFLOW_CLAUDE_HOME: shellPath(claude),
      },
      encoding: 'utf8',
      timeout: 20000,
    });
    assertEq(res.status, 0, `the heal itself still runs: ${res.stderr}`);
    assert(!fs.existsSync(path.join(claude, 'workkit')), 'the origin is what makes a checkout the machine engine');
    cleanup(repo); cleanup(claude); cleanup(copyRoot);
  });

  await test('a copy whose origin IS the kit takes the address', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const copyRoot = mkTmp();
    const copy = path.join(copyRoot, 'workflow');
    fs.mkdirSync(copy, { recursive: true });
    spawnSync('cp', ['-R', `${WORKFLOW_DIR}/.`, copy]);
    spawnSync('git', ['init', '-q'], { cwd: copyRoot });
    spawnSync('git', ['remote', 'add', 'origin', 'git@github.com:ITW-Creative-Works/workkit.git'], { cwd: copyRoot });
    runScript(repo, { claudeHome: claude });   // prime it with THIS engine first
    const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(copy, 'standards.sh')), shellPath(repo)], {
      env: {
        ...process.env,
        PATH: joinPath(SYSTEM_PATH, NODE_DIR),
        WORKFLOW_HOME: shellPath(path.join(mkTmp(), 'wh')),
        WORKFLOW_CLAUDE_HOME: shellPath(claude),
      },
      encoding: 'utf8',
      timeout: 20000,
    });
    assertEq(res.status, 0, `the heal runs: ${res.stderr}`);
    assertEq(fs.realpathSync(path.join(claude, 'workkit')), fs.realpathSync(copy),
      'a second real checkout is still a real checkout: the address follows the one that ran');
    cleanup(repo); cleanup(claude); cleanup(copyRoot);
  });

  await test('an origin spelled as a native Windows path is the kit too', () => {
    // The canonical gate reads the SLUG through the engine's one rule
    // (wk_slug_from_remote, workflow/slug.sh), so it takes a remote in either
    // separator: git stores a path exactly as it was typed, and a checkout
    // cloned from a local path on Windows carries backslashes. A gate that
    // took only a forward slash refused the machine's own engine there.
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const copyRoot = mkTmp();
    const copy = path.join(copyRoot, 'workflow');
    fs.mkdirSync(copy, { recursive: true });
    spawnSync('cp', ['-R', `${WORKFLOW_DIR}/.`, copy]);
    spawnSync('git', ['init', '-q'], { cwd: copyRoot });
    spawnSync('git', ['remote', 'add', 'origin', 'C:\\Users\\x\\kits\\workkit.git'], { cwd: copyRoot });
    runScript(repo, { claudeHome: claude });   // prime it with THIS engine first
    const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(copy, 'standards.sh')), shellPath(repo)], {
      env: {
        ...process.env,
        PATH: joinPath(SYSTEM_PATH, NODE_DIR),
        WORKFLOW_HOME: shellPath(path.join(mkTmp(), 'wh')),
        WORKFLOW_CLAUDE_HOME: shellPath(claude),
      },
      encoding: 'utf8',
      timeout: 20000,
    });
    assertEq(res.status, 0, `the heal runs: ${res.stderr}`);
    assertEq(fs.realpathSync(path.join(claude, 'workkit')), fs.realpathSync(copy),
      'a natively spelled origin names the kit, so the checkout takes the address');
    cleanup(repo); cleanup(claude); cleanup(copyRoot);
  });

  group('standards.sh: local working files');

  await test('creates .workkit/capture.md with the capture header', () => {
    const repo = makeRepo();
    runScript(repo);
    const capture = path.join(repo, W, 'capture.md');
    assert(fs.existsSync(capture), 'the capture file is created');
    const text = fs.readFileSync(capture, 'utf8');
    assert(text.includes('Triage drains every entry'), 'header explains the drain');
    cleanup(repo);
  });

  await test('never overwrites a capture file that has entries', () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, W, 'capture.md'), 'my precious note\n');
    const { output: stdout } = runScript(repo);
    assertEq(fs.readFileSync(path.join(repo, W, 'capture.md'), 'utf8'), 'my precious note\n', 'existing content untouched');
    assert(stdout.includes('already exists'), 'reported as a skip');
    cleanup(repo);
  });

  await test('creates .workkit/agents/session.md with its three fixed sections', () => {
    const repo = makeRepo();
    runScript(repo);
    const text = readFile(path.join(repo, W, 'agents', 'session.md'));
    assert(text.startsWith('# Session'), `titled Session, got: ${text.slice(0, 20)}`);
    for (const section of ['## Active', '## Queue', '## Notes']) {
      assert(text.includes(section), `${section} present`);
    }
    // Fixed shape: the three sections and nothing else.
    assertEq((text.match(/^## /gm) || []).length, 3, 'exactly three sections');
    assert(/priority.*high/i.test(text) && /low/i.test(text), 'Queue states the order rule');
    assert(/promoted/i.test(text), 'Notes states the promotion rule');
    cleanup(repo);
  });

  await test('the seeded session.md states its purpose and the light bar', () => {
    // The docs:session hook reads this file back at every session start; the
    // header is what tells the agent it is a queue and not a journal.
    const repo = makeRepo();
    runScript(repo);
    const text = readFile(path.join(repo, W, 'agents', 'session.md'));
    assert(/compaction/i.test(text), 'names the job it does: surviving a compaction');
    assert(/40/.test(text), 'states the light bar');
    cleanup(repo);
  });

  await test('never overwrites a session file that has content', () => {
    const repo = makeRepo();
    fs.mkdirSync(path.join(repo, W, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(repo, W, 'agents', 'session.md'), '# Session\n\n## Active\n#42: mid-flight\n');
    const { output: stdout } = runScript(repo);
    assert(
      readFile(path.join(repo, W, 'agents', 'session.md')).includes('#42: mid-flight'),
      'the session in progress is never clobbered',
    );
    assert(stdout.includes(`session: ${W}/agents/session.md already exists`), `reported as a skip, got: ${stdout}`);
    cleanup(repo);
  });

  group('standards.sh: issue templates');

  await test('creates all four templates with the right auto-labels', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    const dir = path.join(repo, '.github', 'ISSUE_TEMPLATE');
    for (const form of ['bug', 'enhancement', 'idea', 'dump']) {
      const body = readFile(path.join(dir, `${form}.md`));
      assert(body, `${form}.md created`);
      // Markdown templates carry their labels in the YAML frontmatter.
      const frontmatter = body.split('---')[1] || '';
      const labelsLine = frontmatter.split('\n').find((line) => line.startsWith('labels:')) || '';
      assert(labelsLine.includes('status:inbox'), `${form}.md applies status:inbox`);
      if (form === 'dump') {
        // type: is required on every issue; a dump of unshaped notes is type:idea by convention.
        assert(labelsLine.includes('type:idea'), 'dump.md applies type:idea');
      } else {
        assert(labelsLine.includes(`type:${form}`), `${form}.md applies type:${form}`);
      }
    }
    cleanup(repo); cleanup(stub.dir);
  });

  // The whole point of markdown templates over YAML forms: the pre-filled body
  // IS the spec's anatomy, so a filed issue conforms without triage rewriting it.
  await test('every template pre-fills the issue anatomy', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    const dir = path.join(repo, '.github', 'ISSUE_TEMPLATE');
    for (const form of ['bug', 'enhancement', 'idea', 'dump']) {
      const body = readFile(path.join(dir, `${form}.md`));
      const afterFrontmatter = body.split('---').slice(2).join('---');
      assert(afterFrontmatter.includes('## Description'), `${form}.md pre-fills ## Description`);
      assert(afterFrontmatter.includes('## Spec'), `${form}.md pre-fills ## Spec`);
      assert(
        afterFrontmatter.indexOf('## Description') < afterFrontmatter.indexOf('## Spec'),
        `${form}.md orders Description before Spec`,
      );
      assert(
        afterFrontmatter.includes('None needed: small item.'),
        `${form}.md defaults the Spec so an untouched body still conforms`,
      );
    }
    cleanup(repo); cleanup(stub.dir);
  });

  await test('never overwrites a template the repo already customized', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const bug = path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md');
    fs.mkdirSync(path.dirname(bug), { recursive: true });
    fs.writeFileSync(bug, 'name: Custom Bug\n');
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(bug), 'name: Custom Bug\n', 'customization preserved');
    assert(stdout.includes('created 3'), `only the missing three created, got: ${stdout}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a fully standardized repo reports no creations on re-run', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    assert(stdout.includes('4 already present'), `all four seen as present, got: ${stdout}`);
    assert(!stdout.includes('issue forms: created'), 'nothing recreated');
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: CI workflow');

  await test('installs the required-checks workflow on heal', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    const body = readFile(path.join(repo, '.github', 'workflows', 'checks.yml'));
    assert(body, 'checks.yml created');
    assert(body.includes('pull_request'), 'runs on pull requests');
    assert(body.includes('npm test'), 'runs the test suite');
    assert(stdout.includes('checks: created'), `reported the install, got: ${stdout}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('never overwrites a checks workflow the repo already owns', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'name: custom\n');
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(file), 'name: custom\n', 'repo copy preserved');
    assert(stdout.includes('checks: .github/workflows/checks.yml already present'), `reported as a skip, got: ${stdout}`);
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: the CHANGELOG separator');

  await test('an em dash CHANGELOG is converted to spaced hyphens once (#248)', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const file = path.join(repo, 'CHANGELOG.md');
    fs.writeFileSync(file,
      '# Changelog\n\n## [Unreleased]\n\n- [#4](../../issues/4) \u2014 One thing \u2014 with a dash inside,\n  wrapped \u2014\n  \u2014 and twice at a boundary.\n');
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(file), '# Changelog\n\n## [Unreleased]\n\n- [#4](../../issues/4) - One thing - with a dash inside,\n  wrapped -\n  - and twice at a boundary.\n', 'every em dash became a hyphen, and no newline was swallowed');
    assert(output.includes('changelog separator: converted 4 em dashes'), `reported the conversion, got: ${output}`);
    const again = runScript(repo, { pathPrefix: stub.binDir }).output;
    assert(!again.includes('changelog separator'), `a clean file is silent, got: ${again}`);
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: the retired CHANGELOG linter copy');

  // What an earlier heal vendored: a shebang, the vendor header on line 2,
  // then the linter's body.
  const VENDORED_COPY = '#!/usr/bin/env node\n// Vendored from the workflow core\'s changelog.js by standards.sh. The kit is the SSOT; edit it there. This copy is resynced on every heal.\nconsole.log("lint");\n';
  const git = (repo, ...args) => spawnSync('git',
    ['-c', 'user.name=checks', '-c', 'user.email=checks@example.invalid', ...args], { cwd: repo, encoding: 'utf8' });
  const writeCopy = (repo, name, body) => {
    const file = path.join(repo, '.github', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    return file;
  };

  await test('a copy the kit vendored is removed, the deletion left unstaged like every heal output', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const cjs = writeCopy(repo, 'changelog-lint.cjs', VENDORED_COPY);
    const js = writeCopy(repo, 'changelog-lint.js', VENDORED_COPY);
    git(repo, 'add', '.github/changelog-lint.cjs');
    git(repo, 'commit', '-q', '-m', 'the vendored copy');
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(!fs.existsSync(cjs), `the tracked copy is gone, got: ${output}`);
    assert(!fs.existsSync(js), `and so is the untracked legacy one, got: ${output}`);
    assertEq(git(repo, 'status', '--porcelain', '--', '.github/changelog-lint.cjs').stdout,
      ' D .github/changelog-lint.cjs\n', 'the deletion is in the working tree, never staged');
    assert(output.includes('changelog lint: removed .github/changelog-lint.cjs, CI runs the kit\'s workflow now; commit it'),
      `the tracked removal is reported, got: ${output}`);
    assert(output.includes('changelog lint: removed .github/changelog-lint.js'), `and the untracked one, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('the removal runs once: a second heal finds nothing and says nothing', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    writeCopy(repo, 'changelog-lint.cjs', VENDORED_COPY);
    const once = runScript(repo, { pathPrefix: stub.binDir }).output;
    assert(once.includes('changelog lint: removed'), `the first heal removed it, got: ${once}`);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(!output.includes('changelog lint'), `nothing to say the second time, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a copy without the vendor header is reported and kept', () => {
    for (const name of ['changelog-lint.cjs', 'changelog-lint.js']) {
      const repo = makeRepo();
      const stub = makeGhStub();
      const owned = '#!/usr/bin/env node\n// a linter someone here wrote\n';
      const file = writeCopy(repo, name, owned);
      const { output } = runScript(repo, { pathPrefix: stub.binDir });
      assertEq(readFile(file), owned, `${name}: a file without the vendor header is left exactly as found`);
      assert(output.includes(`.github/${name} is not the kit's copy`), `${name}: and reported, got: ${output}`);
      cleanup(repo); cleanup(stub.dir);
    }
  });

  await test('a repo with no copy gets none, and hears nothing about it', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(!fs.existsSync(path.join(repo, '.github', 'changelog-lint.cjs')), 'no copy is vendored');
    assert(!fs.existsSync(path.join(repo, '.github', 'changelog-lint.js')), 'under either name');
    assert(!output.includes('changelog lint'), `and the step is silent, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: the changelog job in checks.yml');

  // The job line the template carries: CI lints through the kit's reusable workflow.
  const USES = 'uses: itw-creative-works/workkit/.github/workflows/changelog.yml@main';
  // The job an earlier template installed, running a vendored copy by name.
  const nodeJob = (copy) => [
    '  changelog:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v5',
    '      - name: CHANGELOG entry format',
    '        run: |',
    '          if [ -f CHANGELOG.md ]; then',
    `            node ${copy} CHANGELOG.md --unreleased-only`,
    '          else',
    '            echo "no CHANGELOG.md, nothing to check"',
    '          fi',
  ].join('\n');

  await test('a freshly installed checks.yml carries the job', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    const body = readFile(path.join(repo, '.github', 'workflows', 'checks.yml'));
    assert(/^ {2}changelog:$/m.test(body), `the job is defined, got: ${body}`);
    assert(body.includes(`  changelog:\n    ${USES}\n`), `and calls the kit's workflow, got: ${body}`);
    assert(!body.includes('changelog-lint'), 'no vendored copy is named anywhere');
    assert(output.includes('changelog job is already in'), `no second append, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a checks.yml healed before this standard gains the job, keeping its own edits', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const owned = 'name: checks\n\non:\n  pull_request:\n  push:\n\njobs:\n  test:\n    runs-on: macos-14\n    steps:\n      - run: npm test\n';
    fs.writeFileSync(file, owned);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    const body = readFile(file);
    assert(body.startsWith(owned), 'every line the repo owned survives, in place');
    assert(/^ {2}changelog:$/m.test(body), `the job is appended, got: ${body}`);
    assert(body.endsWith(`  changelog:\n    ${USES}\n`), `calling the kit's workflow, got: ${body}`);
    assert(output.includes('checks: added the changelog job'), `reported, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('the job is added once: a second heal appends nothing', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'name: checks\n\non:\n  pull_request:\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n');
    runScript(repo, { pathPrefix: stub.binDir });
    const once = readFile(file);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(file), once, 'idempotent');
    assert(output.includes('changelog job is already in'), `seen as present, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a job running a vendored copy is rewritten in place to call the kit\'s workflow, once', () => {
    for (const copy of ['.github/changelog-lint.cjs', '.github/changelog-lint.js']) {
      const repo = makeRepo();
      const stub = makeGhStub();
      const file = path.join(repo, '.github', 'workflows', 'checks.yml');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const head = 'name: checks\n\non:\n  pull_request:\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n';
      const tail = '\n\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run lint\n';
      fs.writeFileSync(file, `${head}${nodeJob(copy)}${tail}`);
      const { output } = runScript(repo, { pathPrefix: stub.binDir });
      assertEq(readFile(file), `${head}  changelog:\n    ${USES}${tail}`,
        `${copy}: only the changelog job changed, and the job after it survives`);
      assert(output.includes('checks: the changelog job in .github/workflows/checks.yml now calls the kit\'s workflow; commit it'),
        `${copy}: reported, got: ${output}`);
      const once = readFile(file);
      const again = runScript(repo, { pathPrefix: stub.binDir }).output;
      assertEq(readFile(file), once, `${copy}: idempotent`);
      assert(!again.includes('now calls the kit\'s workflow'), `${copy}: no second rewrite, got: ${again}`);
      assert(again.includes('changelog job is already in'), `${copy}: seen as current, got: ${again}`);
      cleanup(repo); cleanup(stub.dir);
    }
  });

  await test('the job ends at the next job whatever its id, and the comment above that job stays', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const head = 'name: checks\n\non:\n  pull_request:\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n';
    const tail = '\n\n  # end to end, on every pull request\n  e2e:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run e2e\n  lint.v2:\n    runs-on: ubuntu-latest\n';
    fs.writeFileSync(file, `${head}${nodeJob('.github/changelog-lint.cjs')}${tail}`);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(file), `${head}  changelog:\n    ${USES}${tail}`,
      `the e2e and lint.v2 jobs and the comment above them survive, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('the retired header comment is replaced by the template\'s own, with the job', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const oldHeader = '# The `changelog` job is the only job the heal adds to an EXISTING checks.yml,\n'
      + '# appended once at the end of `jobs:`. Its linter is the copy of the kit\'s\n'
      + '# changelog.js the heal vendors to .github/changelog-lint.cjs on every run.\n';
    // The template's current paragraph: the anchor line through its last comment line.
    const template = readFile(path.join(WORKFLOW_DIR, 'templates', 'github-workflows', 'checks.yml')).split('\n');
    const from = template.findIndex((l) => l.startsWith('# The `changelog` job is the only job'));
    const to = template.findIndex((l, i) => i > from && !l.startsWith('#'));
    const newHeader = `${template.slice(from, to).join('\n')}\n`;
    assert(from !== -1 && newHeader !== oldHeader, 'the template carries a different paragraph');
    const intro = '# Checks: the repo\'s own words.\n#\n';
    const body = 'name: checks\n\non:\n  pull_request:\n\njobs:\n';
    fs.writeFileSync(file, `${intro}${oldHeader}${body}${nodeJob('.github/changelog-lint.cjs')}\n`);
    runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(file), `${intro}${newHeader}${body}  changelog:\n    ${USES}\n`,
      'the old paragraph is swapped for the template\'s, and nothing else in the header moves');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a retired header above a job already in the uses: form is swapped on its own, once', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const older = '# The `changelog` job is the only job the heal adds to an EXISTING checks.yml,\n'
      + '# appended once at the end of `jobs:`. Its linter is the copy of the kit\'s\n'
      + '# changelog.js the heal vendors to .github/changelog-lint.js on every run.\n';
    const template = readFile(path.join(WORKFLOW_DIR, 'templates', 'github-workflows', 'checks.yml')).split('\n');
    const from = template.findIndex((l) => l.startsWith('# The `changelog` job is the only job'));
    const to = template.findIndex((l, i) => i > from && !l.startsWith('#'));
    const newHeader = `${template.slice(from, to).join('\n')}\n`;
    const body = `name: checks\n\non:\n  pull_request:\n\njobs:\n  changelog:\n    ${USES}\n`;
    fs.writeFileSync(file, `${older}${body}`);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(file), `${newHeader}${body}`, `the header swapped and the job untouched, got: ${output}`);
    assert(output.includes('checks: the header comment in .github/workflows/checks.yml now describes the kit\'s workflow; commit it'),
      `reported, got: ${output}`);
    const again = runScript(repo, { pathPrefix: stub.binDir }).output;
    assertEq(readFile(file), `${newHeader}${body}`, 'a second heal changes nothing');
    assert(!again.includes('now describes the kit\'s workflow'), `and says nothing of it, got: ${again}`);
    assert(again.includes('changelog job is already in'), `seen as current, got: ${again}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a comment naming the copy does not hold the copy in place', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const cjs = writeCopy(repo, 'changelog-lint.cjs', VENDORED_COPY);
    const other = path.join(repo, '.github', 'workflows', 'release.yml');
    fs.mkdirSync(path.dirname(other), { recursive: true });
    fs.writeFileSync(other, 'name: release\n# the old linter lived at .github/changelog-lint.cjs\non:\n  push:\n');
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(!fs.existsSync(cjs), `a comment is not a run, so the copy is removed, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a job that is the last one in the file is rewritten to the end', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const head = 'name: checks\n\non:\n  pull_request:\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n';
    fs.writeFileSync(file, `${head}${nodeJob('.github/changelog-lint.cjs')}\n`);
    runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(file), `${head}  changelog:\n    ${USES}\n`, 'the old job is replaced whole');
    cleanup(repo); cleanup(stub.dir);
  });

  // The heal rewrites the job BEFORE it removes the copy: the other order finds
  // the old job still naming the copy, keeps the copy, and leaves a repo that
  // needs a second heal.
  await test('one heal rewrites a job running the copy and then removes the copy', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const cjs = writeCopy(repo, 'changelog-lint.cjs', VENDORED_COPY);
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const head = 'name: checks\n\non:\n  pull_request:\n\njobs:\n';
    fs.writeFileSync(file, `${head}${nodeJob('.github/changelog-lint.cjs')}\n`);
    git(repo, 'add', '.github');
    git(repo, 'commit', '-q', '-m', 'the vendored copy and the job running it');
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(file), `${head}  changelog:\n    ${USES}\n`, `the job calls the kit's workflow, got: ${output}`);
    assert(!fs.existsSync(cjs), `and the copy is gone in the same heal, got: ${output}`);
    assertEq(git(repo, 'status', '--porcelain', '--', '.github/changelog-lint.cjs').stdout,
      ' D .github/changelog-lint.cjs\n', 'the deletion is left unstaged');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a copy another workflow still runs is kept and reported, even once checks.yml is rewritten', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const cjs = writeCopy(repo, 'changelog-lint.cjs', VENDORED_COPY);
    const head = 'name: checks\n\non:\n  pull_request:\n\njobs:\n';
    const checks = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(checks), { recursive: true });
    fs.writeFileSync(checks, `${head}${nodeJob('.github/changelog-lint.cjs')}\n`);
    const other = path.join(repo, '.github', 'workflows', 'release.yml');
    const owned = 'name: release\n\non:\n  push:\n\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node .github/changelog-lint.cjs CHANGELOG.md\n';
    fs.writeFileSync(other, owned);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(checks), `${head}  changelog:\n    ${USES}\n`, `the job the heal owns is rewritten, got: ${output}`);
    assertEq(readFile(cjs), VENDORED_COPY, 'the copy stays, since deleting it would break release.yml');
    assertEq(readFile(other), owned, 'and the workflow the heal does not own is untouched');
    assert(output.includes('changelog lint: kept .github/changelog-lint.cjs: a workflow under .github/workflows still runs it'),
      `the keep is reported, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a workflow that does not end in its jobs: block is described, never rewritten', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const owned = 'name: checks\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n\nconcurrency:\n  group: checks\n';
    fs.writeFileSync(file, owned);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(file), owned, 'a layout the script cannot reason about is left exactly as found');
    assert(output.includes('does not end in its jobs: block'), `says so, got: ${output}`);
    assert(output.includes(USES), `and names the line to add by hand, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: branch protection');

  await test('asks GitHub to require the test check when none is set', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ repoView: true, protection: 'absent' });
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(output.includes('protection: main now requires the test check'), `applied, got: ${output}`);
    const put = ghCalls(stub).find((c) => c.includes('api') && c.includes('PUT'));
    assert(put, 'a PUT went to the protection endpoint');
    assert(put.join(' ').includes('repos/stub/repo/branches/main/protection'), `right endpoint, got: ${put.join(' ')}`);
    const body = JSON.parse(readFile(path.join(stub.dir, 'put-body.json')));
    assertEq(JSON.stringify(body.required_status_checks.contexts), '["test"]',
      'requires exactly the test check: the job id checks.yml defines');
    assertEq(body.enforce_admins, false, 'admins stay exempt, so the direct path keeps working');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a GET that fails for any reason but 404 writes nothing', () => {
    // "protected but unreadable" (rate limit, outage) must not be answered by
    // PUTting the minimal payload over whatever configuration exists.
    const repo = makeRepo();
    const stub = makeGhStub({ repoView: true, protection: 'absent' });
    stubTool(stub.binDir, 'gh',
      readFile(path.join(stub.binDir, 'gh'))
        .replace('Branch not protected (HTTP 404)', 'API rate limit exceeded')
        .trimEnd().split('\n'));
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assert(!ghCalls(stub).some((c) => c.includes('PUT')), `no PUT after an unexplained GET failure, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('an existing protection is left exactly as found', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ repoView: true, protection: 'present' });
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(output.includes('protection: main already protected'), `reported as a skip, got: ${output}`);
    assert(!ghCalls(stub).some((c) => c.includes('PUT')), 'no PUT: never overwrites a configured protection');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a rejected protection is a quiet skip, never a failed heal', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ repoView: true, protection: 'denied' });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0: advisory by design');
    assert(output.includes('protection: not applied'), `says so quietly, got: ${output}`);
    assert(!output.includes('not fully standardized'), 'needs_attention untouched');
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: labels');

  await test('creates every manifest label with its description and color', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ labels: [] });
    const { code, output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    const calls = ghCalls(stub).filter((c) => isCall(c, 'label', 'create'));
    const wanted = desiredLabels();
    assertEq(calls.length, wanted.length, 'one create per manifest label');
    for (const { name, description, color } of wanted) {
      // Argument-exact: a description is a phrase, so an unquoted expansion in
      // the script would arrive as several arguments and fail here.
      const want = ['label', 'create', name, '--description', description, '--color', color];
      assert(
        calls.some((c) => eqArgv(c, want)),
        `created ${name} with its description and color as single arguments; calls: ${fmtCalls(calls)}`,
      );
    }
    assert(stdout.includes(`created ${wanted.length}`), `reports the count, got: ${stdout}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('labels already matching are left untouched', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ labels: desiredLabels() });
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    const writes = ghCalls(stub).filter((c) => isCall(c, 'label', 'create') || isCall(c, 'label', 'edit'));
    assertEq(writes.length, 0, `no writes, got: ${fmtCalls(writes)}`);
    assert(stdout.includes(`${desiredLabels().length} already correct`), `reports them correct, got: ${stdout}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('color case difference alone is not drift', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ labels: desiredLabels().map((l) => ({ ...l, color: l.color.toLowerCase() })) });
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    const writes = ghCalls(stub).filter((c) => isCall(c, 'label', 'create') || isCall(c, 'label', 'edit'));
    assertEq(writes.length, 0, `hex case ignored, got: ${fmtCalls(writes)}`);
    // Zero writes is also what a label step that never ran produces, so say the
    // comparison actually happened (review finding, 2026-07-24).
    assert(
      stdout.includes(`${desiredLabels().length} already correct`),
      `every label was compared, got: ${stdout}`,
    );
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a jq that writes CRLF: no phantom issue warning, no carriage return written', () => {
    // The Windows jq is a native program whose stdout is in text mode, so every
    // line it writes ends `\r\n`. Two reads break on that, and they are what
    // this case reproduces. The open-issue check answers a LONE `\r` where a
    // conforming board answers nothing, so every heal warns that issues are
    // missing a status or type label when none are, and exits 1 saying the repo
    // is not standardized. And the last field of each manifest line, the colour,
    // arrives wearing a `\r`, which is handed to `gh` and on to GitHub, which
    // refuses a colour that is not six hex digits: the label is never created,
    // so the heal never finishes and asks again every session.
    //
    // The no-drift half is a GUARD, not the repro: a bare jq puts the same `\r`
    // on both sides of that compare, so the two still match. It is here so a fix
    // that strips one side and not the other cannot pass.
    const jqDir = mkTmp();
    if (!crlfJq(jqDir)) {
      skip('a jq that writes CRLF: no phantom issue warning, no carriage return written',
        'this machine has no jq to wrap in one that writes CRLF');
      return;
    }

    // The guard: every label GitHub holds already matches the manifest.
    const matched = makeRepo();
    const held = makeGhStub({ labels: desiredLabels() });
    const quiet = runScript(matched, { pathPrefix: joinPath(jqDir, held.binDir) });
    const writes = ghCalls(held).filter((c) => isCall(c, 'label', 'create') || isCall(c, 'label', 'edit'));
    assertEq(writes.length, 0, `nothing drifted, got: ${fmtCalls(writes)}`);
    assert(
      quiet.output.includes(`${desiredLabels().length} already correct`),
      `every label was compared and matched, got: ${quiet.output}`,
    );

    // The repro: a repo with no labels and a board that conforms. The heal
    // finishes silently, and each create carries the manifest's own description
    // and colour byte for byte.
    const empty = makeRepo();
    const home = mkTmp();
    const none = makeGhStub({
      labels: [],
      issues: [{ number: 1, labels: [{ name: 'status:specced' }, { name: 'type:bug' }] }],
    });
    const { code, output } = runScript(empty, {
      pathPrefix: joinPath(jqDir, none.binDir), workflowHome: home,
    });
    assert(!output.includes('missing a required status'), `no phantom issue warning, got: ${output}`);
    assertEq(code, 0, `the heal finished, got: ${output}`);
    const creates = ghCalls(none).filter((c) => isCall(c, 'label', 'create'));
    for (const { name, description, color } of desiredLabels()) {
      const want = ['label', 'create', name, '--description', description, '--color', color];
      assert(
        creates.some((c) => eqArgv(c, want)),
        `created ${name} with nothing left on its arguments; calls: ${fmtCalls(creates)}`,
      );
    }

    // And what the heal WROTE: both files are jq's own output, so a text-mode jq
    // rewrites every line of them with a `\r` on it. One of the two is committed,
    // so its shape would flip with whichever machine healed last.
    const settings = readFile(path.join(empty, W, 'settings.json'));
    assert(settings.includes('"version"'), `the version was stamped, got: ${JSON.stringify(settings)}`);
    assert(!settings.includes('\r'), `and the committed file is LF, got: ${JSON.stringify(settings)}`);
    const roster = readFile(path.join(home, '.repos.json'));
    assertEq(rosterOf(home)[gitPath(fs.realpathSync(empty))], 'enabled', 'the roster recorded the repo');
    assert(!roster.includes('\r'), `and the roster is LF, got: ${JSON.stringify(roster)}`);

    cleanup(matched); cleanup(held.dir); cleanup(empty); cleanup(home); cleanup(none.dir); cleanup(jqDir);
  });

  await test('description and color drift is corrected, one edit per label', () => {
    const repo = makeRepo();
    const drifted = desiredLabels().map((l, i) => (
      i === 0 ? { ...l, description: 'stale wording' } : i === 1 ? { ...l, color: 'FFFFFF' } : l
    ));
    const stub = makeGhStub({ labels: drifted });
    runScript(repo, { pathPrefix: stub.binDir });
    const edits = ghCalls(stub).filter((c) => isCall(c, 'label', 'edit'));
    assertEq(edits.length, 2, `exactly the two drifted labels, got: ${fmtCalls(edits)}`);
    const first = desiredLabels()[0];
    const want = ['label', 'edit', first.name, '--description', first.description, '--color', first.color];
    assert(
      edits.some((c) => eqArgv(c, want)),
      `restores the manifest wording as single arguments, got: ${fmtCalls(edits)}`,
    );
    cleanup(repo); cleanup(stub.dir);
  });

  await test('labels the manifest does not know are never deleted', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ labels: [...desiredLabels(), { name: 'area:cli', description: 'repo-local', color: 'CCCCCC' }] });
    runScript(repo, { pathPrefix: stub.binDir });
    const calls = ghCalls(stub);
    // "Never deleted" is vacuously true on an empty log, so prove the label step
    // was reached before proving what it did not do (review finding, 2026-07-24).
    assert(calls.some((c) => isCall(c, 'label', 'list')), `the label step ran, got: ${fmtCalls(calls)}`);
    assert(!calls.some((c) => isCall(c, 'label', 'delete')), `no deletions, got: ${fmtCalls(calls)}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a failed label create marks the run unfinished so it retries', () => {
    // a warning alone let the run exit 0, the hook cached the day, and the
    // missing label stayed missing until tomorrow.
    const repo = makeRepo();
    const stub = makeGhStub({ labels: [], createFails: true });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 1, 'a heal that could not finish exits non-zero');
    assert(output.includes('could not create'), `names the failure, got: ${output}`);
    assert(output.includes('not fully standardized'), `and reports the repo as unfinished, got: ${output}`);
    assertEq(repoVersion(repo), 1, 'the version is not stamped, so the heal is asked again');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a failed label edit marks the run unfinished so it retries', () => {
    const repo = makeRepo();
    const drifted = desiredLabels().map((l, i) => (i === 0 ? { ...l, description: 'stale wording' } : l));
    const stub = makeGhStub({ labels: drifted, editFails: true });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 1, 'exit non-zero');
    assert(output.includes('could not update'), `names the failure, got: ${output}`);
    assertEq(repoVersion(repo), 1, 'not stamped');
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: open-issue label report');

  await test('issues missing a status label or doubling an exclusive group are named', () => {
    const repo = makeRepo();
    const stub = makeGhStub({
      labels: desiredLabels(),
      issues: [
        { number: 3, labels: [{ name: 'type:bug' }] },
        { number: 4, labels: [{ name: 'status:inbox' }, { name: 'status:specced' }, { name: 'type:bug' }] },
        { number: 5, labels: [{ name: 'status:specced' }, { name: 'type:bug' }, { name: 'priority:high' }, { name: 'priority:low' }] },
        { number: 6, labels: [{ name: 'status:specced' }, { name: 'type:enhancement' }] },
        { number: 7, labels: [{ name: 'status:backlog' }, { name: 'type:idea' }, { name: 'priority:low' }] },
        { number: 8, labels: [{ name: 'status:specced' }] },
        { number: 9, labels: [{ name: 'status:specced' }, { name: 'type:bug' }, { name: 'type:idea' }] },
      ],
    });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 1, 'a label violation flags the run: the day is not cached and the heal re-reports next session');
    assert(output.includes('#3'), `an issue without a status is named, got: ${output}`);
    assert(output.includes('#4'), `a double status is named, got: ${output}`);
    assert(output.includes('#5'), `priority:high plus priority:low is named, got: ${output}`);
    assert(!output.includes('#6') && !output.includes('#7'), `a conforming issue is not named: priority absence is normal, got: ${output}`);
    assert(output.includes('#8'), `an issue without a type is named: type is required, got: ${output}`);
    assert(output.includes('#9'), `a double type is named: type is exclusive, got: ${output}`);
    assert(output.includes('workkit:triage'), `names the fix, got: ${output}`);
    // The report's own query is the unscoped one: the label-scoped queries
    // belong to the stale-claim sweep.
    const reportQueries = ghCalls(stub)
      .filter((c) => isCall(c, 'issue', 'list') && !c.includes('--label'));
    assertEq(reportQueries.length, 1, 'one gh call for the whole report');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a conforming issue list stays silent', () => {
    const repo = makeRepo();
    const stub = makeGhStub({
      labels: desiredLabels(),
      issues: [
        { number: 1, labels: [{ name: 'status:specced' }, { name: 'type:bug' }] },
        { number: 2, labels: [{ name: 'status:backlog' }, { name: 'type:idea' }, { name: 'priority:high' }] },
      ],
    });
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(!output.includes('workkit:triage'), `nothing to route, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: the stale-claim sweep');

  // An agent that claimed an issue and then died leaves it locked against every
  // other worker. The claim is the agent:working label (assignee accounts
  // cannot tell an agent from a human: agents run gh as the owner) plus the
  // assignee, and the heal releases both after 24 hours with no activity.
  const CLAIM = 'agent:working';
  const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  const claimStub = (carried, extra = {}) => makeGhStub({
    labels: desiredLabels(), labeled: { [CLAIM]: carried }, ...extra,
  });
  const issueEdits = (stub) => ghCalls(stub).filter((c) => isCall(c, 'issue', 'edit'));
  const hasPair = (call, flag, value) => call.some((a, i) => a === flag && call[i + 1] === value);

  await test('agent:working is a label the manifest creates', () => {
    assert(desiredLabels().some((l) => l.name === CLAIM), 'the sweep queries a label the heal makes');
    assertEq(MANIFEST.groups.agent.exclusive, false, 'the claim marker is not exclusive with agent:ok');
    assert(!Object.keys(MANIFEST.groups.status.values).includes('working'),
      'a claim is not a status: the issue carries status:building while it is worked');
  });

  await test('a claim with recent activity is left exactly as it is', () => {
    const repo = makeRepo();
    const stub = claimStub([{ number: 5, updatedAt: hoursAgo(2), assignees: [{ login: 'someone' }] }]);
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assertEq(issueEdits(stub).length, 0, `a live claim is never released, got: ${fmtCalls(ghCalls(stub))}`);
    assert(!output.includes('claims:'), `and nothing is claimed about it, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a claim idle past 24 hours loses the label, the assignee, and gets a comment', () => {
    const repo = makeRepo();
    const stub = claimStub([{ number: 8, updatedAt: hoursAgo(30), assignees: [{ login: 'someone' }] }]);
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'a release is a heal, not a failure');
    const edits = issueEdits(stub);
    assertEq(edits.length, 1, `one release, got: ${fmtCalls(ghCalls(stub))}`);
    assert(hasPair(edits[0], '--remove-label', CLAIM), `the label comes off, got: ${fmtCalls(edits)}`);
    assert(hasPair(edits[0], '--remove-assignee', 'someone'),
      `and so does the assignee: one left behind still reads as a claim, got: ${fmtCalls(edits)}`);
    const comments = ghCalls(stub).filter((c) => isCall(c, 'issue', 'comment'));
    assertEq(comments.length, 1, `the release is recorded on the issue, got: ${fmtCalls(ghCalls(stub))}`);
    assert(comments[0].some((a) => /stale-claim sweep/.test(a)), `naming the sweep, got: ${fmtCalls(comments)}`);
    assert(output.includes('claims: released 1'), `and the run says so, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  // Releasing a building issue and leaving it building would keep it counted as
  // in flight by every surface reading the pipeline, with nobody working it. The
  // spec is still accepted, so it goes back to specced, in the SAME edit, or
  // there is a window where it is unclaimed and still reads as in flight.
  await test('a stale claim on a building issue goes back to specced in the same edit', () => {
    const repo = makeRepo();
    const stub = claimStub([{
      number: 12,
      updatedAt: hoursAgo(30),
      assignees: [{ login: 'someone' }],
      labels: [{ name: CLAIM }, { name: 'status:building' }, { name: 'type:enhancement' }],
    }]);
    const { code } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'a release is a heal, not a failure');
    const edits = issueEdits(stub);
    assertEq(edits.length, 1, `one edit, never two, got: ${fmtCalls(ghCalls(stub))}`);
    assert(hasPair(edits[0], '--remove-label', CLAIM), `the claim comes off, got: ${fmtCalls(edits)}`);
    assert(hasPair(edits[0], '--remove-assignee', 'someone'), `and the assignee, got: ${fmtCalls(edits)}`);
    assert(hasPair(edits[0], '--remove-label', 'status:building'),
      `building ends, got: ${fmtCalls(edits)}`);
    assert(hasPair(edits[0], '--add-label', 'status:specced'),
      `and specced resumes: the spec is still accepted, got: ${fmtCalls(edits)}`);
    const comments = ghCalls(stub).filter((c) => isCall(c, 'issue', 'comment'));
    assertEq(comments.length, 1, `one comment, got: ${fmtCalls(ghCalls(stub))}`);
    assert(comments[0].some((a) => /status:specced/.test(a)),
      `the trail says where the issue landed, got: ${fmtCalls(comments)}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a stale claim on an issue that is not building touches no status label', () => {
    const repo = makeRepo();
    const stub = claimStub([{
      number: 13,
      updatedAt: hoursAgo(30),
      assignees: [{ login: 'someone' }],
      labels: [{ name: CLAIM }, { name: 'status:blocked' }, { name: 'type:bug' }],
    }]);
    const { code } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    const edits = issueEdits(stub);
    assertEq(edits.length, 1, `one release, got: ${fmtCalls(ghCalls(stub))}`);
    assert(!edits[0].some((a) => /^status:/.test(a)),
      `the sweep releases a claim, it does not re-route a queue, got: ${fmtCalls(edits)}`);
    const comments = ghCalls(stub).filter((c) => isCall(c, 'issue', 'comment'));
    assert(!comments[0].some((a) => /status:specced/.test(a)),
      `and the comment claims no flip, got: ${fmtCalls(comments)}`);
    cleanup(repo); cleanup(stub.dir);
  });

  // `gh issue edit` fails whole when it is handed a label the repo does not
  // have, so a flip added blind would cost the release itself on exactly the
  // repos least able to afford it: the ones whose labels never reached GitHub.
  await test('a missing status:specced costs the flip, never the release', () => {
    const repo = makeRepo();
    const stub = claimStub([{
      number: 14,
      updatedAt: hoursAgo(30),
      assignees: [{ login: 'someone' }],
      labels: [{ name: CLAIM }, { name: 'status:building' }, { name: 'type:enhancement' }],
    }], { labels: desiredLabels().filter((l) => l.name !== 'status:specced') });
    const { code } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    const edits = issueEdits(stub);
    assertEq(edits.length, 1, `the claim is still released, got: ${fmtCalls(ghCalls(stub))}`);
    assert(hasPair(edits[0], '--remove-label', CLAIM), `the claim comes off, got: ${fmtCalls(edits)}`);
    assert(hasPair(edits[0], '--remove-assignee', 'someone'), `and the assignee, got: ${fmtCalls(edits)}`);
    assert(!edits[0].some((a) => /^status:/.test(a)),
      `and no status label is named at all: the edit must not fail on one, got: ${fmtCalls(edits)}`);
    const comments = ghCalls(stub).filter((c) => isCall(c, 'issue', 'comment'));
    assert(!comments[0].some((a) => /status:specced/.test(a)),
      `the comment claims no flip either, got: ${fmtCalls(comments)}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a failed query releases nothing and asks for another session', () => {
    const repo = makeRepo();
    const stub = claimStub([{ number: 8, updatedAt: hoursAgo(30), assignees: [] }], { labelQueryFails: true });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 1, 'an unfinished heal reports itself');
    assertEq(issueEdits(stub).length, 0, 'an unreachable GitHub is not an idle claim');
    assert(output.includes('left in place'), `says what it did not do, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('an issue assigned without the label is never touched: a human claim is not swept', () => {
    const repo = makeRepo();
    const stub = makeGhStub({
      labels: desiredLabels(),
      // Nothing carries agent:working; the human claim is only in the whole-repo
      // report, which the sweep never reads.
      issues: [{
        number: 9,
        labels: [{ name: 'status:specced' }, { name: 'type:bug' }],
        assignees: [{ login: 'alice' }],
      }],
    });
    const { code } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assertEq(issueEdits(stub).length, 0, `a human claim has no expiry, got: ${fmtCalls(ghCalls(stub))}`);
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: the claimed-spec flip');

  // status:specced is the authorization to start and the assignee is the claim,
  // so an issue carrying both has started. The flip is what let the readers drop
  // the claimed-specced tolerance (issue #62): nothing flipped these before, so
  // the transitional branch was permanent by default.
  const SPECCED = 'status:specced';
  const BUILDING = 'status:building';
  const speccedStub = (carried, extra = {}) => makeGhStub({
    labels: desiredLabels(), labeled: { [SPECCED]: carried }, ...extra,
  });

  await test('a specced issue with an assignee moves to building, with a comment', () => {
    const repo = makeRepo();
    const stub = speccedStub([{ number: 21, assignees: [{ login: 'someone' }] }]);
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'a flip is a heal, not a failure');
    const edits = issueEdits(stub);
    assertEq(edits.length, 1, `one flip, got: ${fmtCalls(ghCalls(stub))}`);
    assert(hasPair(edits[0], '--remove-label', SPECCED), `specced ends, got: ${fmtCalls(edits)}`);
    assert(hasPair(edits[0], '--add-label', BUILDING), `and building begins, got: ${fmtCalls(edits)}`);
    const comments = ghCalls(stub).filter((c) => isCall(c, 'issue', 'comment'));
    assertEq(comments.length, 1, `the flip is recorded on the issue, got: ${fmtCalls(ghCalls(stub))}`);
    assert(comments[0].some((a) => /standards sweep/.test(a)), `naming the sweep, got: ${fmtCalls(comments)}`);
    assert(output.includes('claims: flipped 1'), `and the run says so, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a specced issue nobody has claimed is left exactly as it is', () => {
    const repo = makeRepo();
    const stub = speccedStub([{ number: 22, assignees: [] }]);
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assertEq(issueEdits(stub).length, 0, `an unclaimed spec is the ready queue, got: ${fmtCalls(ghCalls(stub))}`);
    assert(!output.includes('claims: flipped'), `and nothing is claimed about it, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a repo without status:building is left alone rather than edited into a failure', () => {
    // `gh issue edit` fails whole when it is handed a label the repo does not
    // have, so a flip attempted blind is an error report on exactly the repos
    // whose labels never reached GitHub.
    const repo = makeRepo();
    const stub = speccedStub([{ number: 23, assignees: [{ login: 'someone' }] }], {
      labels: desiredLabels().filter((l) => l.name !== BUILDING),
    });
    const { code } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assertEq(issueEdits(stub).length, 0, `no flip attempted, got: ${fmtCalls(ghCalls(stub))}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a released claim is not re-promoted by the flip that follows it', () => {
    // The two sweeps run in one session and move issues in opposite directions.
    // The release removes the assignee in the same edit that demotes the issue,
    // so what it hands back carries no claim for the flip to find.
    const repo = makeRepo();
    const stub = makeGhStub({
      labels: desiredLabels(),
      labeled: {
        [CLAIM]: [{
          number: 24,
          updatedAt: hoursAgo(30),
          assignees: [{ login: 'someone' }],
          labels: [{ name: CLAIM }, { name: BUILDING }, { name: 'type:bug' }],
        }],
        // What the release just made: specced again, and unassigned.
        [SPECCED]: [{ number: 24, assignees: [] }],
      },
    });
    const { code } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    const edits = issueEdits(stub);
    assertEq(edits.length, 1, `the release, and nothing after it, got: ${fmtCalls(ghCalls(stub))}`);
    assert(hasPair(edits[0], '--add-label', SPECCED), `the issue stays where the release put it, got: ${fmtCalls(edits)}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a failed specced query flips nothing and asks for another session', () => {
    const repo = makeRepo();
    const stub = speccedStub([{ number: 25, assignees: [{ login: 'someone' }] }], { labelQueryFails: true });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 1, 'an unfinished heal reports itself');
    assertEq(issueEdits(stub).length, 0, 'an unreachable GitHub is not a claimed spec');
    assert(output.includes('nothing was flipped'), `says what it did not do, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: the hook layer self-check');

  // Every hook fails open by design, so a chmod-stripped script, a syntax
  // error, or a missing tool disables a safety layer with nothing watching.
  // This is the once-a-day assertion that the layer is alive.
  const HOOK_NAMES = ['docs:one', 'safety:two'];
  const makeHooksDir = ({ missing = [], notExecutable = [], badSyntax = [] } = {}) => {
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'hooks.json'), `${JSON.stringify({
      hooks: {
        SessionStart: [{
          hooks: HOOK_NAMES.map((n) => ({
            type: 'command',
            command: `"\${CLAUDE_PLUGIN_ROOT}"/hooks/loader.sh ${n}`,
          })),
        }],
      },
    }, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, 'loader.sh'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    for (const name of HOOK_NAMES) {
      if (missing.includes(name)) continue;
      const hookDir = path.join(dir, ...name.split(':'));
      fs.mkdirSync(hookDir, { recursive: true });
      fs.writeFileSync(
        path.join(hookDir, 'run.sh'),
        badSyntax.includes(name) ? '#!/bin/bash\nif [ 1 ; then\n' : '#!/bin/bash\nexit 0\n',
        { mode: notExecutable.includes(name) ? 0o644 : 0o755 },
      );
    }
    return dir;
  };

  await test('a healthy hook layer says nothing at all', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const hooks = makeHooksDir();
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, hooksDir: hooks });
    assertEq(code, 0, 'exit 0');
    assert(!output.includes('⚠'), `a live layer is not news, got: ${output}`);
    cleanup(repo); cleanup(stub.dir); cleanup(hooks);
  });

  await test('the real shipped hook layer passes its own check', () => {
    // The fixtures below prove the check catches things; this proves the kit
    // being shipped is not one of them.
    const repo = makeRepo();
    const stub = makeGhStub();
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assert(!output.includes('⚠'), `every wired hook resolves and parses, got: ${output}`);
    assert(/hooks: \d+ hook scripts resolve/.test(output),
      `and the count is a skip line, which the session never sees, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await strippedBitTest('a chmod-stripped hook script is named, with the chmod that fixes it', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const hooks = makeHooksDir({ notExecutable: ['safety:two'] });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, hooksDir: hooks });
    assertEq(code, 1, 'a dead safety layer is not a standardized repo');
    assert(output.includes('safety:two is not executable'), `names the hook, got: ${output}`);
    assert(output.includes('chmod +x'), `and the fix, got: ${output}`);
    cleanup(repo); cleanup(stub.dir); cleanup(hooks);
  });

  await test('a hook wired with no script behind it is named', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const hooks = makeHooksDir({ missing: ['docs:one'] });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, hooksDir: hooks });
    assertEq(code, 1, 'reported as unfinished');
    assert(output.includes('docs:one is wired in hooks.json'), `names the hook, got: ${output}`);
    assert(output.includes('reinstall'), `and what to do, got: ${output}`);
    cleanup(repo); cleanup(stub.dir); cleanup(hooks);
  });

  await test('a hook script that does not parse is named', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const hooks = makeHooksDir({ badSyntax: ['docs:one'] });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, hooksDir: hooks });
    assertEq(code, 1, 'reported as unfinished');
    assert(output.includes('docs:one has a syntax error'), `names the hook, got: ${output}`);
    cleanup(repo); cleanup(stub.dir); cleanup(hooks);
  });

  await strippedBitTest('the loader itself is checked: nothing runs without it', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const hooks = makeHooksDir();
    fs.chmodSync(path.join(hooks, 'loader.sh'), 0o644);
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, hooksDir: hooks });
    assertEq(code, 1, 'reported as unfinished');
    assert(output.includes('loader.sh is not executable'), `names the router, got: ${output}`);
    cleanup(repo); cleanup(stub.dir); cleanup(hooks);
  });

  await test('a missing tool is named loudly, without holding the repo back', () => {
    // A tool the machine lacks is not the repo's fault, so it warns like
    // everything else here but never flags the run: the version stamp and the
    // drift report must not wait on something no repo can install for it.
    const repo = makeRepo();
    const hooks = makeHooksDir();
    const stub = makeGhStub();
    const binDir = binDirWithout('node');
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), shellPath(repo)], {
      env: {
        PATH: joinPath(stub.binDir, binDir),
        WORKFLOW_HOME: shellPath(path.join(binDir, 'wh')),
        WORKFLOW_CLAUDE_HOME: shellPath(path.join(binDir, 'ch')),
        WORKFLOW_HOOKS_DIR: shellPath(hooks),
      },
      encoding: 'utf8',
      timeout: 20000,
    });
    const out = (res.stdout || '') + (res.stderr || '');
    assertEq(res.status, 0, 'a machine condition never fails the run');
    assert(/hooks: the hook layer needs.*node/.test(out), `names the missing tool, got: ${out}`);
    assert(out.includes('silently do not run'), `and what its absence costs, got: ${out}`);
    cleanup(repo); cleanup(hooks); cleanup(binDir); cleanup(stub.dir);
  });

  await test('a digest tool under either name satisfies the check (workkit #245)', () => {
    // hook_sha1 takes shasum or sha1sum, so the daily heal asks for the pair:
    // a Linux machine with only sha1sum is whole, and a machine with neither
    // is told both names.
    const repo = makeRepo();
    const hooks = makeHooksDir();
    const stub = makeGhStub();
    const binDir = binDirWithout('shasum');
    fs.rmSync(path.join(binDir, 'sha1sum'), { force: true });
    const run = () => {
      const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), shellPath(repo)], {
        env: {
          PATH: joinPath(stub.binDir, binDir),
          WORKFLOW_HOME: shellPath(path.join(binDir, 'wh')),
          WORKFLOW_CLAUDE_HOME: shellPath(path.join(binDir, 'ch')),
          WORKFLOW_HOOKS_DIR: shellPath(hooks),
        },
        encoding: 'utf8',
        timeout: 20000,
      });
      return (res.stdout || '') + (res.stderr || '');
    };
    const neither = run();
    assert(/hooks: the hook layer needs.*shasum or sha1sum/.test(neither), `names both digest tools, got: ${neither}`);
    stubTool(binDir, 'sha1sum', ['#!/bin/sh', 'exit 0']);
    const one = run();
    assert(!/hook layer needs/.test(one), `sha1sum alone satisfies the pair, got: ${one}`);
    cleanup(repo); cleanup(hooks); cleanup(binDir); cleanup(stub.dir);
  });

  await test('an engine installed without a hook layer beside it checks nothing', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const empty = mkTmp();
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, hooksDir: empty });
    assertEq(code, 0, 'exit 0');
    assert(!output.includes('hooks:'), `no hooks.json means no hook layer to judge, got: ${output}`);
    cleanup(repo); cleanup(stub.dir); cleanup(empty);
  });

  group('gh stub: argument boundaries survive recording');

  // The label assertions above are only as strong as the recording underneath
  // them. These two cases prove the recording tells a quoted expansion from an
  // unquoted one: the exact regression a `"$*"` log could not see.
  const callStub = (stub, snippet) => {
    spawnSync(BASH, [...NO_RC, '-c', snippet], {
      env: { ...process.env, PATH: systemPathWith(stub.binDir) },
      encoding: 'utf8',
    });
    return ghCalls(stub);
  };

  await test('a quoted phrase arrives as one argument', () => {
    const stub = makeGhStub();
    const calls = callStub(stub, 'd="two words"; gh label create x --description "$d"');
    assertEq(calls.length, 1, 'one recorded call');
    assert(
      eqArgv(calls[0], ['label', 'create', 'x', '--description', 'two words']),
      `phrase kept whole, got: ${fmtCalls(calls)}`,
    );
    cleanup(stub.dir);
  });

  await test('the same phrase unquoted arrives split, and is not mistaken for the quoted call', () => {
    const stub = makeGhStub();
    const calls = callStub(stub, 'd="two words"; gh label create x --description $d');
    assert(
      !eqArgv(calls[0], ['label', 'create', 'x', '--description', 'two words']),
      `word splitting is visible, got: ${fmtCalls(calls)}`,
    );
    assertEq(calls[0].length, 6, `six arguments, got: ${fmtCalls(calls)}`);
    cleanup(stub.dir);
  });

  await test('an empty argument is recorded, not swallowed', () => {
    const stub = makeGhStub();
    const calls = callStub(stub, 'gh label create "" --color ""');
    assert(
      eqArgv(calls[0], ['label', 'create', '', '--color', '']),
      `empty strings survive, got: ${fmtCalls(calls)}`,
    );
    cleanup(stub.dir);
  });

  await test('a call with no arguments at all is one empty record', () => {
    const stub = makeGhStub();
    const calls = callStub(stub, 'gh');
    assertEq(calls.length, 1, `one call recorded, got: ${fmtCalls(calls)}`);
    assertEq(calls[0].length, 0, `no arguments, got: ${fmtCalls(calls)}`);
    cleanup(stub.dir);
  });

  await test('concurrent calls do not fuse into one record', () => {
    // Each record is a single append, so 50 stubs racing each other still read
    // back as 50 intact calls. Splitting the write in two produced fused records
    // here every run (issue #19).
    const stub = makeGhStub();
    const n = 50;
    const calls = callStub(stub, `for i in $(seq 1 ${n}); do gh label create "name$i" --description "a phrase here $i" & done; wait`);
    assertEq(calls.length, n, `every call recorded, got ${calls.length}`);
    const malformed = calls.filter((c) => c.length !== 5);
    assertEq(malformed.length, 0, `every record holds exactly its own 5 arguments, got: ${fmtCalls(malformed)}`);
    // And the pairs are still each other's, not one call's flag with another's value.
    const mismatched = calls.filter((c) => c[4] !== `a phrase here ${c[2].replace('name', '')}`);
    assertEq(mismatched.length, 0, `each description stayed with its own label, got: ${fmtCalls(mismatched)}`);
    cleanup(stub.dir);
  });

  group('standards.sh: offline and unauthenticated');

  await test('no gh on PATH: clean exit, local heals still applied', () => {
    const repo = makeRepo();
    // Hand-built PATH, like the jq test below: `command -v gh` searches every
    // PATH entry, and a machine that keeps gh in /usr/bin (a CI runner does)
    // would otherwise reach the authentication check instead of this one.
    const binDir = binDirWithout('gh');
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), shellPath(repo)], {
      env: { PATH: binDir, WORKFLOW_HOME: shellPath(path.join(binDir, 'workflow-home')) },
      encoding: 'utf8',
      timeout: 20000,
    });
    const code = res.status;
    const stdout = (res.stdout || '') + (res.stderr || '');
    assertEq(code, 0, 'exit 0');
    assert(!stdout.includes('⚠'), `announces nothing broken, got: ${stdout}`);
    assert(stdout.includes('gh not installed'), `says why the label step was skipped, got: ${stdout}`);
    assert(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'templates still installed');
    assert(IGNORE_GLOB.test(readFile(path.join(repo, '.gitignore'))), 'gitignore still healed');
    cleanup(repo); cleanup(binDir);
  });

  await test('no jq on PATH: only the label step is skipped, local heals run', () => {
    const repo = makeRepo();
    const binDir = binDirWithout('jq');
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), shellPath(repo)], {
      env: { PATH: binDir, WORKFLOW_HOME: shellPath(path.join(binDir, 'workflow-home')) },
      encoding: 'utf8',
      timeout: 20000,
    });
    const stdout = (res.stdout || '') + (res.stderr || '');
    assertEq(res.status, 0, 'exit 0');
    assert(stdout.includes('jq not installed'), `says why the label step was skipped, got: ${stdout}`);
    assert(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'templates still installed');
    assert(fs.existsSync(path.join(repo, W, 'capture.md')), 'the capture file is still created');
    assert(IGNORE_GLOB.test(readFile(path.join(repo, '.gitignore'))), 'gitignore still healed');
    cleanup(repo); cleanup(binDir);
  });

  await test('gh present but unauthenticated: skipped without any label call', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ authed: false });
    const { code, output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assert(!stdout.includes('⚠'), `announces nothing broken, got: ${stdout}`);
    assert(stdout.includes('not authenticated'), `says why, got: ${stdout}`);
    assert(!ghCalls(stub).some((c) => isCall(c, 'label')), 'never reaches the label API');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('no origin remote: labels skipped, exit 0', () => {
    const repo = makeRepo({ remote: false });
    const stub = makeGhStub();
    const { code, output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assert(stdout.includes('no origin remote'), `says why, got: ${stdout}`);
    assert(!ghCalls(stub).some((c) => isCall(c, 'label', 'list')), 'never queries labels');
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: runs from anywhere');

  await test('defaults to the current directory when given no argument', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT)], {
      cwd: repo,
      env: {
        ...process.env, PATH: systemPathWith(stub.binDir),
        // Inherited HOME plus the two user-level seeds would write the real
        // ~/.workkit and repoint the real ~/.claude/workkit.
        WORKFLOW_HOME: shellPath(path.join(mkTmp(), 'wh')), WORKFLOW_CLAUDE_HOME: shellPath(path.join(mkTmp(), 'ch')),
      },
      encoding: 'utf8',
      timeout: 20000,
    });
    assertEq(res.status, 0, 'exit 0');
    assert(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'dump.md')), 'healed the cwd repo');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a subdirectory resolves to the repo root', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const nested = path.join(repo, 'src', 'deep');
    fs.mkdirSync(nested, { recursive: true });
    runScript(nested, { pathPrefix: stub.binDir });
    assert(fs.existsSync(path.join(repo, '.gitignore')), 'root .gitignore healed, not the subdir');
    assert(!fs.existsSync(path.join(nested, '.gitignore')), 'nothing written in the subdirectory');
    cleanup(repo); cleanup(stub.dir);
  });
};

const STANDARD_VERSION = Number(
  /^STANDARD_VERSION=(\d+)/m.exec(fs.readFileSync(SCRIPT, 'utf8'))[1],
);
const repoVersion = (dir) => JSON.parse(readFile(path.join(dir, W, 'settings.json'))).version;

const driftRun = async () => {
  group('standards.sh: the version gate and the drift report');

  await test('a retired file is reported and never touched', () => {
    // Deleting PROGRESS.md deletes work items nobody migrated. The script says
    // what to run; a human (or the migrate skill) does it. The name has to be
    // the skill that actually does this job: workkit:migrate advertises the
    // drift report as its trigger, so pointing elsewhere means it never fires.
    const dir = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(dir, 'PROGRESS.md'), '## Now\n- something nobody migrated\n');
    const { output } = runScript(dir, { pathPrefix: stub.binDir });
    assert(output.includes('PROGRESS.md is retired'), `named, got: ${output}`);
    assert(output.includes('workkit:migrate'), `says what to run, got: ${output}`);
    assert(fs.existsSync(path.join(dir, 'PROGRESS.md')), 'the file is still there');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a retired plans/ directory is reported', () => {
    const dir = makeRepo();
    const stub = makeGhStub();
    fs.mkdirSync(path.join(dir, 'plans'));
    const { output } = runScript(dir, { pathPrefix: stub.binDir });
    assert(output.includes('plans/ is retired'), `named, got: ${output}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a CHANGELOG outside the entry format is reported with a count', () => {
    const dir = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), [
      '# Changelog', '', '## [1.0.0] - 2020-01-01', '', '### Added',
      '- **A big essay entry** that carries no issue link and no separator at all.',
      '- **Another one** just like it.', '',
    ].join('\n'));
    const { output } = runScript(dir, { pathPrefix: joinPath(stub.binDir, NODE_DIR) });
    assert(/CHANGELOG\.md has 2 entries not in the entry format/.test(output), `counted, got: ${output}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a conforming CHANGELOG is not reported', () => {
    const dir = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), [
      '# Changelog', '', '## [1.0.0] - 2020-01-01', '', '### Added',
      '- (no issue) \u2014 A short entry in the format.', '', // \u2014 is the CHANGELOG entry separator (U+2014)
    ].join('\n'));
    const { output } = runScript(dir, { pathPrefix: joinPath(stub.binDir, NODE_DIR) });
    assert(!output.includes('not in the entry format'), `silent, got: ${output}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a clean heal stamps the version forward', () => {
    const dir = makeRepo();
    const stub = makeGhStub();
    assertEq(repoVersion(dir), 1, 'starts at 1');
    runScript(dir, { pathPrefix: stub.binDir });
    assertEq(repoVersion(dir), STANDARD_VERSION, 'stamped');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('no node with a CHANGELOG present: the version is not stamped, and the run says so', () => {
    // The CHANGELOG check is guarded on `command -v node`; stamping anyway
    // ended the one-time drift report for a file nobody checked.
    const dir = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), [
      '# Changelog', '', '## [1.0.0] - 2020-01-01', '', '### Added',
      '- **A big essay entry** that carries no issue link and no separator at all.', '',
    ].join('\n'));
    const binDir = binDirWithout('node');
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), shellPath(dir)], {
      env: {
        PATH: joinPath(stub.binDir, binDir),
        WORKFLOW_HOME: shellPath(path.join(binDir, 'wh')),
        WORKFLOW_CLAUDE_HOME: shellPath(path.join(binDir, 'ch')),
      },
      encoding: 'utf8',
      timeout: 20000,
    });
    const code = res.status;
    const output = (res.stdout || '') + (res.stderr || '');
    assertEq(code, 0, 'a missing tool is a machine condition, not a failure');
    assertEq(repoVersion(dir), 1, 'not stamped past a check that never ran');
    assert(output.includes('version not stamped'), `says so on stderr, got: ${output}`);
    // Once node is available the check runs and the same repo stamps forward.
    runScript(dir, { pathPrefix: joinPath(stub.binDir, NODE_DIR) });
    assertEq(repoVersion(dir), STANDARD_VERSION, 'stamps once the check could run');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('no jq: the version is not stamped and the run says why, instead of re-reporting silently forever', () => {
    const dir = makeRepo();
    // Every tool but jq: a hand-listed set falls behind the script as it grows
    // and then dies of a missing utility while claiming to prove something
    // about the excluded one.
    const binDir = binDirWithout('jq');
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), shellPath(dir)], {
      env: { PATH: binDir, WORKFLOW_HOME: shellPath(path.join(binDir, 'wh')) }, encoding: 'utf8', timeout: 20000,
    });
    const out = (res.stdout || '') + (res.stderr || '');
    assertEq(res.status, 0, 'exit 0');
    assert(out.includes('version not stamped'), `says the stamp was skipped, got: ${out}`);
    assert(out.includes('jq'), `and names the missing tool, got: ${out}`);
    assertEq(repoVersion(dir), 1, 'the version is untouched');
    cleanup(dir); cleanup(binDir);
  });

  await test('a repo already at the current version looks for nothing', () => {
    // The whole point of recording the version: no scan, no output.
    const dir = makeRepo({ settings: `{ "version": ${STANDARD_VERSION}, "enabled": true }\n` });
    const stub = makeGhStub();
    fs.writeFileSync(path.join(dir, 'PROGRESS.md'), '## Now\n- still here\n');
    const { output } = runScript(dir, { pathPrefix: stub.binDir });
    assert(!output.includes('retired'), `no drift scan, got: ${output}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a failed heal leaves the version alone, so the repo is asked again', () => {
    // The directory form hides settings.json and no negation can undo it, so
    // the gitignore heal reports the repo as needing a human.
    const dir = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(dir, '.gitignore'), `${W}/\n`);
    const { code } = runScript(dir, { pathPrefix: stub.binDir });
    assertEq(code, 1, 'partial heal exits non-zero');
    assertEq(repoVersion(dir), 1, 'not stamped');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('--enable on a legacy repo still gets the drift report', () => {
    // The scenario the report exists for: an old repo joining today, carrying
    // a PROGRESS.md the mechanical heals do not touch. Writing the current
    // version into the brand-new settings file would skip it forever.
    const dir = makeRepo({ settings: null });
    const stub = makeGhStub();
    fs.writeFileSync(path.join(dir, 'PROGRESS.md'), '## Now\n- unmigrated\n');
    const { output } = runScript(dir, { pathPrefix: stub.binDir, args: ['--enable'] });
    assert(output.includes('PROGRESS.md is retired'), `reported on the way in, got: ${output}`);
    assertEq(repoVersion(dir), STANDARD_VERSION, 'and stamped forward afterwards');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('the drift report alone does not fail the run', () => {
    // Those findings need a human; exiting non-zero would nag every session.
    const dir = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(dir, 'INBOX.md'), '- unfiled\n');
    const { code } = runScript(dir, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assertEq(repoVersion(dir), STANDARD_VERSION, 'and still stamped');
    cleanup(dir); cleanup(stub.dir);
  });
};

module.exports = async () => {
  await run();
  await driftRun();
  return summary();
};

if (require.main === module) selfRun(module.exports);
