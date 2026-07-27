//
// Tests for workflow/ — the label vocabulary manifest (labels.json) and
// the repo standards script (standards.sh).
//
// The script's label step talks to GitHub through `gh`; every test here runs
// against a PATH shim that records its arguments and answers from a fixture, so
// nothing in this suite touches the network or a real repository.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, WORKKIT_DIR: W } = require('../lib/harness');
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

// The name the state directory carried before the rename — read from the
// engine, so this suite migrates whatever the engine still knows how to migrate.
const LEGACY = /^WORKKIT_LEGACY_DIR="([^"]+)"/m.exec(fs.readFileSync(SCRIPT, 'utf8'))[1];
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

// A git repo with an origin remote — the shape the script expects. No commits
// are made and the remote is never contacted (gh is stubbed).
// Participation: the committed .workkit/settings.json is the repo's yes, so
// every fixture carries one unless a test is exercising another state.
const makeRepo = ({ remote = true, settings = '{ "version": 1, "enabled": true }\n' } = {}) => {
  const dir = mkTmp();
  spawnSync('git', ['init', '-q'], { cwd: dir });
  if (remote) {
    spawnSync('git', ['remote', 'add', 'origin', 'https://example.invalid/ian/repo.git'], { cwd: dir });
  }
  if (settings !== null) {
    fs.mkdirSync(path.join(dir, W), { recursive: true });
    fs.writeFileSync(path.join(dir, W, 'settings.json'), settings);
  }
  return dir;
};

// PATH shim: records each `gh` invocation, answers `label list` and
// `issue list` from fixtures. The recording keeps argument boundaries (see
// tests/lib/argv-log.js) — a label description is a phrase with spaces, and
// losing the boundary would make an unquoted expansion in the script
// indistinguishable from a correct call.
const makeGhStub = ({
  labels = [], issues = [], authed = true, createFails = false, editFails = false,
  // The migration step's surface. `labeled` maps a label name to the issues
  // carrying it, so `gh issue list --label <name>` answers per label instead of
  // handing back the whole fixture. The SECOND query for the same label is the
  // heal's re-ask before deleting, and it answers empty by default — the moves
  // it just made worked. `labeledRecheck` overrides that answer, which is how a
  // capped list (issues left over past the limit) is modeled.
  // `issueEditFails`, `labelDeleteFails`, and `labelQueryFails` drive the three
  // ways a migration can stop halfway.
  labeled = {}, labeledRecheck = {},
  issueEditFails = false, labelDeleteFails = false, labelQueryFails = false,
  // Branch-protection knobs. `protection`: 'absent' (404s, PUT accepted),
  // 'present' (GET succeeds), or 'denied' (404s, PUT rejected — the free-plan
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
  for (const [label, numbers] of Object.entries(labeled)) {
    fs.writeFileSync(
      path.join(dir, `issues-${label}.json`),
      JSON.stringify(numbers.map((number) => ({ number }))),
    );
  }
  for (const [label, numbers] of Object.entries(labeledRecheck)) {
    fs.writeFileSync(
      path.join(dir, `recheck-${label}.json`),
      JSON.stringify(numbers.map((number) => ({ number }))),
    );
  }
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'bin', 'gh'), [
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
    // A --label query is the migration asking who carries one retired label;
    // without it this is the whole-repo report, which gets the full fixture.
    '  want=""; prev=""',
    '  for a in "$@"; do [[ "$prev" == "--label" ]] && want="$a"; prev="$a"; done',
    '  if [[ -z "$want" ]]; then',
    `    cat "${issuesFile}"`,
    '    exit 0',
    '  fi',
    ...(labelQueryFails ? ['  exit 1'] : []),
    // Which time this label is being asked about: the first is the migration's
    // list, any later one its re-ask before deleting.
    `  asked=0; counter="${dir}/asked-$want"`,
    '  [[ -f "$counter" ]] && asked=$(cat "$counter")',
    '  asked=$((asked + 1)); printf \'%s\' "$asked" > "$counter"',
    '  if [[ "$asked" -gt 1 ]]; then',
    `    if [[ -f "${dir}/recheck-$want.json" ]]; then cat "${dir}/recheck-$want.json"; else echo "[]"; fi`,
    `  elif [[ -f "${dir}/issues-$want.json" ]]; then`,
    `    cat "${dir}/issues-$want.json"`,
    '  else',
    '    echo "[]"',
    '  fi',
    '  exit 0',
    'fi',
    'if [[ "$1 $2" == "issue edit" ]]; then',
    `  exit ${issueEditFails ? 1 : 0}`,
    'fi',
    'if [[ "$1 $2" == "label create" ]]; then',
    `  exit ${createFails ? 1 : 0}`,
    'fi',
    'if [[ "$1 $2" == "label edit" ]]; then',
    `  exit ${editFails ? 1 : 0}`,
    'fi',
    'if [[ "$1 $2" == "label delete" ]]; then',
    `  exit ${labelDeleteFails ? 1 : 0}`,
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
  ].join('\n'), { mode: 0o755 });
  return { binDir: path.join(dir, 'bin'), logFile, dir };
};

const readFile = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
// One argv array per recorded `gh` invocation.
const ghCalls = (stub) => readArgv(stub.logFile);

// `pathPrefix: null` means run with no gh on PATH at all (the offline machine).
// WORKFLOW_HOME always points at a throwaway directory — the user-level
// settings file this script writes must never be the real ~/.workkit.
// A PATH holding every tool the script needs EXCEPT one. `command -v <tool>`
// searches every PATH entry, so the only way to prove the missing-tool branch
// is to build the PATH by hand — where the tool lives varies by machine (a CI
// runner keeps gh in /usr/bin, Homebrew does not), and a test that assumed a
// layout was testing the host instead of the script.
const binDirWithout = (excluded) => {
  const binDir = mkTmp();
  // Mirror the real PATH rather than a hand-listed set of tools: the script
  // reaches for mv, rm, readlink and more as it grows, and a whitelist that
  // falls behind makes the run die of a missing utility while claiming to
  // prove something about the excluded one.
  const dirs = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  for (const tool of ['jq', 'gh', 'git', 'node']) {
    const real = spawnSync('command', ['-v', tool], { shell: '/bin/bash', encoding: 'utf8' }).stdout.trim();
    if (real) dirs.push(path.dirname(real));
  }
  const seen = new Set();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      // First directory wins, so the earlier system paths keep precedence.
      if (name === excluded || seen.has(name)) continue;
      seen.add(name);
      try {
        fs.symlinkSync(path.join(dir, name), path.join(binDir, name));
      } catch {
        // A name that cannot be linked (a broken entry, a race) is simply
        // absent, which is what the caller is testing for anyway.
      }
    }
  }
  const found = spawnSync('command', ['-v', excluded], {
    shell: '/bin/bash', encoding: 'utf8', env: { PATH: binDir },
  }).stdout.trim();
  assert(!found, `${excluded} must be unreachable, found it at ${found}`);
  return binDir;
};

const runScript = (repoDir, { pathPrefix, args = [], workflowHome, claudeHome } = {}) => {
  const basePath = '/usr/bin:/bin:/usr/sbin:/sbin';
  const res = spawnSync('bash', [SCRIPT, ...args, repoDir], {
    env: {
      ...process.env,
      PATH: pathPrefix ? `${pathPrefix}:${basePath}` : basePath,
      WORKFLOW_HOME: workflowHome || path.join(mkTmp(), 'workflow-home'),
      // Same rule as WORKFLOW_HOME for the engine's address symlink: the step
      // that maintains ~/.claude/workkit must never reach the real ~/.claude.
      WORKFLOW_CLAUDE_HOME: claudeHome || path.join(mkTmp(), 'claude-home'),
    },
    encoding: 'utf8',
    timeout: 20000,
  });
  // The engine keeps stdout for machine-readable answers (--state, --announce)
  // and sends every diagnostic to stderr. `output` is what a human sees in a
  // terminal — assert human-facing lines against it, and stdout only when the
  // test cares that something IS machine-readable.
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  return { code: res.status, stdout, stderr, output: stdout + stderr };
};

const run = async () => {
  group('labels.json: manifest shape');

  await test('all four groups present', () => {
    const groups = Object.keys(MANIFEST.groups).sort();
    assertEq(groups.join(','), 'agent,priority,status,type', 'the day-one groups');
  });

  await test('exact values per group', () => {
    const values = (g) => Object.keys(MANIFEST.groups[g].values).sort().join(',');
    assertEq(values('status'), 'blocked,inbox,parked,specced', 'status values');
    assertEq(values('type'), 'bug,enhancement,idea', 'type values');
    assertEq(values('priority'), 'high,low', 'priority values');
    assertEq(values('agent'), 'ok', 'agent values');
  });

  await test('values are single lowercase words — no hyphens', () => {
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

  await test('status is exclusive and every status description says so', () => {
    assertEq(MANIFEST.groups.status.exclusive, true, 'status.exclusive');
    for (const [value, body] of Object.entries(MANIFEST.groups.status.values)) {
      assert(/exactly one status:/i.test(body.description), `status:${value} must state the one-per-issue rule`);
    }
  });

  await test('priority is exclusive — high plus low on one issue is a contradiction', () => {
    assertEq(MANIFEST.groups.priority.exclusive, true, 'priority.exclusive');
  });

  await test('status and type are the required groups — priority absence means normal', () => {
    for (const [name, body] of Object.entries(MANIFEST.groups)) {
      assertEq(body.required === true, name === 'status' || name === 'type', `${name}.required`);
    }
  });

  await test('type is exclusive — an issue is one kind of thing', () => {
    assertEq(MANIFEST.groups.type.exclusive, true, 'type.exclusive');
  });

  await test('inbox description names triage as the drain', () => {
    assert(/triage/i.test(MANIFEST.groups.status.values.inbox.description), 'status:inbox points at triage');
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

  group('labels.json: the migration map');

  // A vocabulary change strands every already-labeled issue outside the queue
  // queries unless the heal carries them across, so the map is part of the SSOT.
  await test('every migration names a retired label and a live replacement', () => {
    const live = new Set(desiredLabels().map((l) => l.name));
    const migrations = MANIFEST.migrations || {};
    assert(Object.keys(migrations).length > 0, 'the map exists');
    for (const [from, to] of Object.entries(migrations)) {
      assert(/^[a-z]+:[a-z]+$/.test(from), `${from} is a group:value label`);
      assert(!live.has(from), `${from} must be retired — a label the manifest still asks for cannot be migrated away`);
      assert(live.has(to), `${to} must be a label the manifest creates, got a target nothing makes`);
    }
  });

  await test('the v4 rename is the map in force today', () => {
    assertEq(MANIFEST.migrations['status:spec'], 'status:inbox', 'spec meant "no spec yet" — that is inbox now');
    assertEq(MANIFEST.migrations['status:queued'], 'status:specced', 'queued meant "spec ready and blessed"');
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

  group('standards.sh: the one-time .workflow/ → .workkit/ move');

  // A repo healed before the rename, exactly as it was left: the committed
  // settings.json and the gitignored working files in the old directory, and a
  // .gitignore naming it.
  const makeLegacyRepo = ({ settings = '{ "version": 1, "enabled": true }\n' } = {}) => {
    const repo = makeRepo({ settings: null });
    fs.mkdirSync(path.join(repo, LEGACY), { recursive: true });
    if (settings !== null) {
      fs.writeFileSync(path.join(repo, LEGACY, 'settings.json'), settings);
    }
    fs.writeFileSync(path.join(repo, LEGACY, 'inbox.md'), '- a note nobody filed yet\n');
    fs.writeFileSync(path.join(repo, '.gitignore'), `node_modules\n${LEGACY}/*\n!${LEGACY}/settings.json\n`);
    return repo;
  };

  await test('moves the directory, contents and all, and says so', () => {
    const repo = makeLegacyRepo();
    const stub = makeGhStub();
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(!fs.existsSync(path.join(repo, LEGACY)), `${LEGACY}/ is gone`);
    assertEq(
      readFile(path.join(repo, W, 'inbox.md')), '- a note nobody filed yet\n',
      'the gitignored working file rode along',
    );
    assert(readFile(path.join(repo, W, 'settings.json')).length > 0, 'and so did the committed answer');
    assert(output.includes(`migrate: ${LEGACY}/ → ${W}/`), `reports the move, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('rewrites the .gitignore lines that named the old directory', () => {
    const repo = makeLegacyRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    const ignore = readFile(path.join(repo, '.gitignore'));
    assert(!ignore.includes(`${LEGACY}/`), `no ${LEGACY}/ line left, got: ${ignore}`);
    assert(IGNORE_GLOB.test(ignore), `${W}/* line, got: ${ignore}`);
    assert(IGNORE_NEGATION.test(ignore), `settings.json still re-included, got: ${ignore}`);
    assertEq((ignore.match(IGNORE_GLOB_ALL) || []).length, 1, 'and no duplicate from the gitignore heal');
    const ignored = (rel) => spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: repo }).status === 0;
    assert(!ignored(`${W}/settings.json`), 'the opt-in file stays committable');
    assert(ignored(`${W}/inbox.md`), 'session state stays untracked');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('the repo reads as enabled, not as one that never answered', () => {
    // The answer moves with the directory, so a --state query must migrate
    // first — reporting `undecided` here would offer to enable a repo that
    // said yes long ago, and the heal that does the move would never run.
    const repo = makeLegacyRepo();
    const stub = makeGhStub();
    const { stdout } = runScript(repo, { pathPrefix: stub.binDir, args: ['--state'] });
    assertEq(stdout.trim(), 'enabled', 'state answered from the moved file');
    assert(fs.existsSync(path.join(repo, W, 'settings.json')), 'and the move happened');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a second run has nothing to move and says nothing about it', () => {
    const repo = makeLegacyRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    const inbox = readFile(path.join(repo, W, 'inbox.md'));
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assert(!output.includes('migrate:'), `silent the second time, got: ${output}`);
    assertEq(readFile(path.join(repo, W, 'inbox.md')), inbox, 'and the working file is untouched');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a repo that never opted in keeps its old directory untouched', () => {
    // No committed settings.json means no yes, and nothing is ever written
    // into a repo that has not given one — a move included.
    const repo = makeLegacyRepo({ settings: null });
    const stub = makeGhStub();
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(fs.existsSync(path.join(repo, LEGACY, 'inbox.md')), `${LEGACY}/ left alone`);
    assert(!fs.existsSync(path.join(repo, W)), `and no ${W}/ created`);
    assert(!output.includes('migrate:'), `nothing claimed, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('both directories present — warns, moves nothing, asks for a human', () => {
    const repo = makeLegacyRepo();
    fs.mkdirSync(path.join(repo, W), { recursive: true });
    fs.writeFileSync(path.join(repo, W, 'settings.json'), '{ "version": 1, "enabled": true }\n');
    fs.writeFileSync(path.join(repo, W, 'inbox.md'), '- the newer note\n');
    const stub = makeGhStub();
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 1, 'the run reports itself unfinished');
    assert(output.includes('both exist'), `names the conflict, got: ${output}`);
    assertEq(readFile(path.join(repo, LEGACY, 'inbox.md')), '- a note nobody filed yet\n', 'old file kept');
    assertEq(readFile(path.join(repo, W, 'inbox.md')), '- the newer note\n', 'new file kept');
    cleanup(repo); cleanup(stub.dir);
  });

  group('the state directory name is one string per layer');

  // Three layers hold the name — the engine, the hooks, and this harness — and
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

  await test('git honors the pattern — settings.json tracked, the rest ignored', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    fs.mkdirSync(path.join(repo, W), { recursive: true });
    fs.writeFileSync(path.join(repo, W, 'settings.json'), '{ "version": 1 }\n');
    fs.writeFileSync(path.join(repo, W, 'inbox.md'), '- a note\n');
    const ignored = (rel) => spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: repo }).status === 0;
    assert(!ignored(`${W}/settings.json`), 'settings.json is committable');
    assert(ignored(`${W}/inbox.md`), 'the local inbox stays untracked');
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
  // own block — the two cases below both passed a string check while leaving
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
    assert(ignored(`${W}/inbox.md`), 'session state still ignored');
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
    assert(ignored, 'git cannot descend into an excluded directory — still ignored');
    assert(stdout.includes('STILL ignored'), `the run says so plainly, got: ${stdout}`);
    assert(stdout.includes(`.gitignore:1:${W}/`), `and names the offending line, got: ${stdout}`);
    assert(stdout.includes('not fully standardized'), `the run reports the repo as needing attention, got: ${stdout}`);
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

  await test('no file and no record — offers to enable, writes nothing', () => {
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

  await test('the user settings file exists from the first run, before any decision', () => {
    // It used to appear only on the first decline, so someone running the
    // workflow system found no ~/.workkit at all and read that as broken
    // (Ian 2026-07-25). An empty repos map is the honest starting state.
    const repo = makeRepo({ settings: null });
    const home = path.join(mkTmp(), 'never-touched');
    runScript(repo, { args: ['--state'], workflowHome: home });
    const file = path.join(home, 'settings.json');
    assert(fs.existsSync(file), 'created without any decline');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assertEq(parsed.version, 1, 'seeded with a version');
    assertEq(Object.keys(parsed.repos).length, 0, 'no repos declined yet');
    cleanup(repo);
  });

  await test('an existing user settings file is never overwritten by the ensure', () => {
    const repo = makeRepo({ settings: null });
    const home = mkTmp();
    const file = path.join(home, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, repos: { '/somewhere': 'declined' } }));
    runScript(repo, { args: ['--state'], workflowHome: home });
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assertEq(parsed.repos['/somewhere'], 'declined', 'the recorded decline survives');
    cleanup(repo); cleanup(home);
  });

  await test('--decline records the repo under repos in the user settings', () => {
    const repo = makeRepo({ settings: null });
    const home = mkTmp();
    const { code, output: stdout } = runScript(repo, { args: ['--decline'], workflowHome: home });
    assertEq(code, 0, 'exit 0');
    assert(stdout.includes('recorded'), `reports the record, got: ${stdout}`);
    const file = path.join(home, 'settings.json');
    assert(fs.existsSync(file), 'the user settings file exists');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assertEq(parsed.version, 1, 'seeded with a version');
    const root = fs.realpathSync(repo);
    assertEq(parsed.repos[root], 'declined', 'keyed by the absolute repo root');
    cleanup(repo); cleanup(home);
  });

  await test('--decline writes only the repos key — every other key survives', () => {
    const repo = makeRepo({ settings: null });
    const home = mkTmp();
    const seeded = {
      version: 1,
      editor: 'code',
      nested: { keep: ['me', 1] },
      repos: { '/some/other/repo': 'declined' },
    };
    fs.writeFileSync(path.join(home, 'settings.json'), `${JSON.stringify(seeded, null, 2)}\n`);
    runScript(repo, { args: ['--decline'], workflowHome: home });
    const parsed = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
    assertEq(parsed.editor, 'code', 'unrelated key survives with its value');
    assertEq(JSON.stringify(parsed.nested), JSON.stringify({ keep: ['me', 1] }), 'nested value survives');
    assertEq(parsed.repos['/some/other/repo'], 'declined', 'other repo decisions survive');
    assertEq(parsed.repos[fs.realpathSync(repo)], 'declined', 'and the new one is added');
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
    // A repo opting in today is born at the current standard — there is no
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

  group('standards.sh: it fails loudly, never silently');

  // Every case here was a reproduced defect before 3.1.0 — the suite proved the
  // happy path across all four states and nothing about what happens when the
  // ground shifts (review findings, 2026-07-24).

  // The engine runs under `set -e` on whatever bash the machine has. A bare
  // `(( x++ ))` yields the value BEFORE the increment, so a counter starting at
  // 0 makes the command exit non-zero on its first pass; bash 4.1 and later end
  // the run there. Stock macOS bash is 3.2 and does not, so the shape has to be
  // banned by inspection — no Darwin test run would ever fail on it.
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
    for (const f of onDisk) assert(listed.includes(f), `${f} is on disk but untracked — a fresh clone would half-heal`);
  });

  await test('a missing template warns, keeps healing, and exits non-zero', () => {
    const engine = mkTmp();
    spawnSync('cp', ['-R', `${WORKFLOW_DIR}/.`, engine]);
    fs.rmSync(path.join(engine, 'templates', 'session.md'));
    const repo = makeRepo();
    const stub = makeGhStub();
    const res = spawnSync('bash', [path.join(engine, 'standards.sh'), repo], {
      env: {
        ...process.env, PATH: `${stub.binDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
        WORKFLOW_HOME: path.join(mkTmp(), 'wh'), WORKFLOW_CLAUDE_HOME: path.join(mkTmp(), 'ch'),
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
    // answered --state with exit 1 — which the hook read as nogit and went
    // silent forever.
    const engine = mkTmp();
    spawnSync('cp', ['-R', `${WORKFLOW_DIR}/.`, engine]);
    fs.rmSync(path.join(engine, 'labels.json'));
    const repo = makeRepo();
    const env = {
      ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      WORKFLOW_HOME: path.join(mkTmp(), 'wh'), WORKFLOW_CLAUDE_HOME: path.join(mkTmp(), 'ch'),
    };
    const state = spawnSync('bash', [path.join(engine, 'standards.sh'), '--state', repo], { env, encoding: 'utf8', timeout: 20000 });
    assertEq(state.status, 0, '--state answers without the manifest');
    assertEq((state.stdout || '').trim(), 'enabled', 'and answers correctly');
    const announce = spawnSync('bash', [path.join(engine, 'standards.sh'), '--announce', repo], { env, encoding: 'utf8', timeout: 20000 });
    assertEq(announce.status, 0, '--announce answers without the manifest');
    assert((announce.stdout || '').includes('--enable'), 'and still offers');
    const heal = spawnSync('bash', [path.join(engine, 'standards.sh'), repo], { env, encoding: 'utf8', timeout: 20000 });
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
    fs.mkdirSync(path.join(home, 'settings.json.lock'), { recursive: true });
    const { output } = runScript(repo, { args: ['--decline'], workflowHome: home });
    assert(output.includes('without the lock'), `says it proceeded unlocked, got: ${output}`);
    assert(fs.existsSync(path.join(home, 'settings.json.lock')), 'the mutex it never held survives');
    const parsed = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
    assertEq(parsed.repos[fs.realpathSync(repo)], 'declined', 'the decline is still recorded');
    // And a decline that did acquire the lock removes its own on exit.
    const home2 = mkTmp();
    runScript(repo, { args: ['--decline'], workflowHome: home2 });
    assert(!fs.existsSync(path.join(home2, 'settings.json.lock')), 'a held lock is released');
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

  await test('malformed user settings — declines cleanly, records nothing, leaves no litter', () => {
    const home = mkTmp();
    fs.writeFileSync(path.join(home, 'settings.json'), '{ this is not json\n');
    const repo = makeRepo({ settings: null });
    const { output } = runScript(repo, { args: ['--decline'], workflowHome: home });
    assert(output.includes('not valid JSON'), `says what is wrong, got: ${output}`);
    assertEq(fs.readdirSync(home).filter((f) => f.includes('.tmp.')).length, 0, 'and leaves no temp file behind');
    cleanup(repo); cleanup(home);
  });

  await test('a symlinked user settings file is updated in place, not replaced', () => {
    // This repo's whole model is symlinking config out of ~, so writing over the
    // link would replace it with a regular file and orphan the real one.
    const home = mkTmp();
    const realDir = mkTmp();
    const realFile = path.join(realDir, 'settings.json');
    fs.writeFileSync(realFile, '{\n  "version": 1,\n  "repos": {},\n  "digest": { "hour": 9 }\n}\n');
    fs.symlinkSync(realFile, path.join(home, 'settings.json'));
    const repo = makeRepo({ settings: null });
    runScript(repo, { args: ['--decline'], workflowHome: home });
    assert(fs.lstatSync(path.join(home, 'settings.json')).isSymbolicLink(), 'still a symlink');
    const written = JSON.parse(fs.readFileSync(realFile, 'utf8'));
    assertEq(written.repos[fs.realpathSync(repo)] || written.repos[repo], 'declined', 'the real target got the decline');
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

  await test('no jq — a committed enabled:false is still honored, not healed over', () => {
    // The grep fallback exists for exactly this; the only jq-free test used an
    // enabled repo, so the branch that matters had no coverage.
    const repo = makeRepo({ settings: '{ "version": 1, "enabled": false }\n' });
    const binDir = mkTmp();
    for (const tool of ['git', 'grep', 'tail', 'head', 'cp', 'mkdir', 'tr', 'cat', 'dirname', 'basename']) {
      const real = spawnSync('command', ['-v', tool], { shell: '/bin/bash', encoding: 'utf8' }).stdout.trim();
      fs.symlinkSync(real, path.join(binDir, tool));
    }
    const res = spawnSync('/bin/bash', [SCRIPT, '--state', repo], {
      env: { PATH: binDir, WORKFLOW_HOME: path.join(binDir, 'wh') }, encoding: 'utf8', timeout: 20000,
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

  // ~/.claude/workkit → the engine. The step runs on EVERY invocation, so the
  // cheapest one (--state, no gh, no heal) is what these drive it with.
  const ENGINE = path.resolve(WORKFLOW_DIR);
  const claudeHomeWith = () => {
    const home = mkTmp();
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    return { home, claude: path.join(home, '.claude') };
  };

  await test('links ~/.claude/workkit at the engine it is running from', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const { output } = runScript(repo, { args: ['--state'], claudeHome: claude });
    const link = path.join(claude, 'workkit');
    assertEq(fs.realpathSync(link), fs.realpathSync(ENGINE), 'the address points at this engine');
    assert(fs.lstatSync(link).isSymbolicLink(), 'and it is a symlink, not a copy');
    assert(output.includes('engine: linked'), `says so once, got: ${output}`);
    cleanup(repo); cleanup(claude);
  });

  await test('an address already correct is silent — the step is idempotent', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    runScript(repo, { args: ['--state'], claudeHome: claude });
    const { output } = runScript(repo, { args: ['--state'], claudeHome: claude });
    assert(!output.includes('engine:'), `a correct address says nothing, got: ${output}`);
    assertEq(fs.realpathSync(path.join(claude, 'workkit')), fs.realpathSync(ENGINE), 'and stays put');
    cleanup(repo); cleanup(claude);
  });

  await test('an address pointing somewhere else is repaired', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const stale = mkTmp();
    fs.symlinkSync(stale, path.join(claude, 'workkit'));
    const { output } = runScript(repo, { args: ['--state'], claudeHome: claude });
    assertEq(fs.realpathSync(path.join(claude, 'workkit')), fs.realpathSync(ENGINE), 'repointed at this engine');
    assert(output.includes('engine: repointed'), `and says so, got: ${output}`);
    cleanup(repo); cleanup(claude); cleanup(stale);
  });

  await test('a REAL directory at the address is never replaced', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const real = path.join(claude, 'workkit');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, 'keep.txt'), 'mine\n');
    const { output } = runScript(repo, { args: ['--state'], claudeHome: claude });
    assert(fs.statSync(real).isDirectory() && !fs.lstatSync(real).isSymbolicLink(), 'the directory survives');
    assertEq(fs.readFileSync(path.join(real, 'keep.txt'), 'utf8'), 'mine\n', 'with its contents');
    assert(output.includes('is a real file or directory'), `and the human is told, got: ${output}`);
    cleanup(repo); cleanup(claude);
  });

  await test('no ~/.claude on the machine — nothing is created', () => {
    const repo = makeRepo();
    const home = mkTmp();
    const claude = path.join(home, '.claude');
    const { output } = runScript(repo, { args: ['--state'], claudeHome: claude });
    assert(!fs.existsSync(claude), 'the engine creates no agent directory of its own');
    assert(!output.includes('engine:'), `and says nothing about it, got: ${output}`);
    cleanup(repo); cleanup(home);
  });

  await test('the retired address is removed when it links to a workflow engine', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const legacy = path.join(claude, 'workflow');
    fs.symlinkSync(ENGINE, legacy);
    const { output } = runScript(repo, { args: ['--state'], claudeHome: claude });
    assert(!fs.existsSync(legacy) && !fs.lstatSync(legacy, { throwIfNoEntry: false }), 'the old link is gone');
    assert(output.includes('removed the retired'), `and the removal is announced, got: ${output}`);
    assertEq(fs.realpathSync(path.join(claude, 'workkit')), fs.realpathSync(ENGINE), 'the new address took over');
    cleanup(repo); cleanup(claude);
  });

  await test('a foreign link at the old name is left alone', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const someoneElses = mkTmp();
    fs.writeFileSync(path.join(someoneElses, 'notes.md'), 'not an engine\n');
    const legacy = path.join(claude, 'workflow');
    fs.symlinkSync(someoneElses, legacy);
    runScript(repo, { args: ['--state'], claudeHome: claude });
    assert(fs.lstatSync(legacy).isSymbolicLink(), 'a link to something that is not an engine survives');
    assertEq(fs.realpathSync(legacy), fs.realpathSync(someoneElses), 'still pointing where it did');
    cleanup(repo); cleanup(claude); cleanup(someoneElses);
  });

  await test('a real directory at the old name is never removed', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const legacy = path.join(claude, 'workflow');
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, 'standards.sh'), '# not a link\n');
    runScript(repo, { args: ['--state'], claudeHome: claude });
    assert(fs.statSync(legacy).isDirectory() && !fs.lstatSync(legacy).isSymbolicLink(), 'the directory survives');
    assert(fs.existsSync(path.join(legacy, 'standards.sh')), 'with its contents');
    cleanup(repo); cleanup(claude);
  });

  group('standards.sh: local working files');

  await test('creates .workkit/inbox.md with the capture header', () => {
    const repo = makeRepo();
    runScript(repo);
    const inbox = path.join(repo, W, 'inbox.md');
    assert(fs.existsSync(inbox), 'inbox created');
    const text = fs.readFileSync(inbox, 'utf8');
    assert(text.includes('Triage drains every entry'), 'header explains the drain');
    cleanup(repo);
  });

  await test('never overwrites an inbox that has entries', () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, W, 'inbox.md'), 'my precious note\n');
    const { output: stdout } = runScript(repo);
    assertEq(fs.readFileSync(path.join(repo, W, 'inbox.md'), 'utf8'), 'my precious note\n', 'existing content untouched');
    assert(stdout.includes('already exists'), 'reported as a skip');
    cleanup(repo);
  });

  await test('creates .workkit/session.md with its three fixed sections', () => {
    const repo = makeRepo();
    runScript(repo);
    const text = readFile(path.join(repo, W, 'session.md'));
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

  await test('never overwrites a session file that has content', () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, W, 'session.md'), '# Session\n\n## Active\n#42 — mid-flight\n');
    const { output: stdout } = runScript(repo);
    assert(
      readFile(path.join(repo, W, 'session.md')).includes('#42 — mid-flight'),
      'the session in progress is never clobbered',
    );
    assert(stdout.includes(`session: ${W}/session.md already exists`), `reported as a skip, got: ${stdout}`);
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
        afterFrontmatter.includes('None needed — small item.'),
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
      'requires exactly the test check — the job id checks.yml defines');
    assertEq(body.enforce_admins, false, 'admins stay exempt, so the direct path keeps working');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a GET that fails for any reason but 404 writes nothing', () => {
    // "protected but unreadable" (rate limit, outage) must not be answered by
    // PUTting the minimal payload over whatever configuration exists.
    const repo = makeRepo();
    const stub = makeGhStub({ repoView: true, protection: 'absent' });
    fs.writeFileSync(path.join(stub.binDir, 'gh'),
      readFile(path.join(stub.binDir, 'gh')).replace('Branch not protected (HTTP 404)', 'API rate limit exceeded'),
      { mode: 0o755 });
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
    assert(!ghCalls(stub).some((c) => c.includes('PUT')), 'no PUT — never overwrites a configured protection');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a rejected protection is a quiet skip, never a failed heal', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ repoView: true, protection: 'denied' });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0 — advisory by design');
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
    // log_warn alone let the run exit 0, the hook cached the day, and the
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

  group('standards.sh: retired labels migrate');

  // The manifest's migrations map, exercised against the labels actually in it
  // rather than hard-coded names — a later rename inherits this coverage.
  const MIGRATIONS = Object.entries(MANIFEST.migrations || {});
  const [OLD_LABEL, NEW_LABEL] = MIGRATIONS[0];
  const retiredLabel = (name) => ({ name, description: 'from the previous vocabulary', color: 'CCCCCC' });

  await test('every issue carrying a retired label moves to its replacement', () => {
    const repo = makeRepo();
    const stub = makeGhStub({
      labels: [...desiredLabels(), retiredLabel(OLD_LABEL)],
      labeled: { [OLD_LABEL]: [11, 12] },
    });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    const edits = ghCalls(stub).filter((c) => isCall(c, 'issue', 'edit'));
    assertEq(edits.length, 2, `one edit per issue, got: ${fmtCalls(edits)}`);
    for (const n of ['11', '12']) {
      assert(
        edits.some((c) => eqArgv(c, ['issue', 'edit', n, '--add-label', NEW_LABEL, '--remove-label', OLD_LABEL])),
        `#${n} gains ${NEW_LABEL} and loses ${OLD_LABEL} in ONE command, so it is never without a status; got: ${fmtCalls(edits)}`,
      );
    }
    assert(output.includes(`moved 2 issues from ${OLD_LABEL} to ${NEW_LABEL}`), `reports the move, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('the query covers closed issues too — a label is part of the record', () => {
    const repo = makeRepo();
    const stub = makeGhStub({
      labels: [...desiredLabels(), retiredLabel(OLD_LABEL)],
      labeled: { [OLD_LABEL]: [7] },
    });
    runScript(repo, { pathPrefix: stub.binDir });
    const query = ghCalls(stub).find((c) => isCall(c, 'issue', 'list') && c.includes(OLD_LABEL));
    assert(query, `the migration asked for the retired label's issues, got: ${fmtCalls(ghCalls(stub))}`);
    assert(query.includes('--state') && query.includes('all'), `open AND closed, got: ${query.join(' ')}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('the retired label itself is deleted once its issues are moved', () => {
    const repo = makeRepo();
    const stub = makeGhStub({
      labels: [...desiredLabels(), retiredLabel(OLD_LABEL)],
      labeled: { [OLD_LABEL]: [3] },
    });
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    const deletes = ghCalls(stub).filter((c) => isCall(c, 'label', 'delete'));
    assertEq(deletes.length, 1, `exactly the retired label, got: ${fmtCalls(deletes)}`);
    assert(eqArgv(deletes[0], ['label', 'delete', OLD_LABEL, '--yes']), `deleted ${OLD_LABEL}, got: ${fmtCalls(deletes)}`);
    assert(output.includes(`removed the retired ${OLD_LABEL}`), `says so, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a repo carrying every retired label migrates all of them', () => {
    const repo = makeRepo();
    const labeled = {};
    MIGRATIONS.forEach(([from], i) => { labeled[from] = [100 + i]; });
    const stub = makeGhStub({
      labels: [...desiredLabels(), ...MIGRATIONS.map(([from]) => retiredLabel(from))],
      labeled,
    });
    runScript(repo, { pathPrefix: stub.binDir });
    const deletes = ghCalls(stub).filter((c) => isCall(c, 'label', 'delete'));
    assertEq(deletes.length, MIGRATIONS.length, `one delete per retired label, got: ${fmtCalls(deletes)}`);
    for (const [from, to] of MIGRATIONS) {
      assert(
        ghCalls(stub).some((c) => isCall(c, 'issue', 'edit') && c.includes('--add-label') && c.includes(to) && c.includes(from)),
        `${from} → ${to} happened, got: ${fmtCalls(ghCalls(stub))}`,
      );
    }
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a repo with none of the retired labels does nothing at all', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ labels: desiredLabels() });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    const calls = ghCalls(stub);
    assert(calls.some((c) => isCall(c, 'label', 'list')), `the label step ran, got: ${fmtCalls(calls)}`);
    assert(!calls.some((c) => isCall(c, 'issue', 'edit')), `no relabeling, got: ${fmtCalls(calls)}`);
    assert(!calls.some((c) => isCall(c, 'label', 'delete')), `no deletion, got: ${fmtCalls(calls)}`);
    assert(!output.includes('retired'), `and nothing announced, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('the migration is idempotent — the second run has nothing left to find', () => {
    // The old label is gone from GitHub after the first pass, which is exactly
    // what the step turns on, so a rerun is silent without any extra bookkeeping.
    const repo = makeRepo();
    const first = makeGhStub({
      labels: [...desiredLabels(), retiredLabel(OLD_LABEL)],
      labeled: { [OLD_LABEL]: [5] },
    });
    runScript(repo, { pathPrefix: first.binDir });
    const second = makeGhStub({ labels: desiredLabels() });
    const { code, output } = runScript(repo, { pathPrefix: second.binDir });
    assertEq(code, 0, 'exit 0');
    assert(!ghCalls(second).some((c) => isCall(c, 'issue', 'edit')), 'nothing relabeled twice');
    assert(!output.includes('moved'), `and nothing claimed, got: ${output}`);
    cleanup(repo); cleanup(first.dir); cleanup(second.dir);
  });

  await test('an issue that could not be moved keeps the retired label alive for the retry', () => {
    // Deleting the label after a failed move would leave that issue with no
    // status at all — the one outcome worse than a half-finished rename.
    const repo = makeRepo();
    const stub = makeGhStub({
      labels: [...desiredLabels(), retiredLabel(OLD_LABEL)],
      labeled: { [OLD_LABEL]: [9] },
      issueEditFails: true,
    });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 1, 'the run reports itself unfinished');
    assert(output.includes(`could not move #9 from ${OLD_LABEL}`), `names the issue, got: ${output}`);
    assert(!ghCalls(stub).some((c) => isCall(c, 'label', 'delete')), 'and the label survives for the next run');
    assertEq(repoVersion(repo), 1, 'the version is not stamped, so the heal is asked again');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a failed issue query keeps the label — it is not read as "nobody carries it"', () => {
    // An unreachable GitHub and an empty label both produce no issue numbers.
    // Reading the first as the second deletes the label out from under every
    // issue still wearing it, and those issues lose their only status.
    const repo = makeRepo();
    const stub = makeGhStub({
      labels: [...desiredLabels(), retiredLabel(OLD_LABEL)],
      labeled: { [OLD_LABEL]: [21] },
      labelQueryFails: true,
    });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 1, 'a query it could not run leaves the run unfinished');
    assert(output.includes(`could not list the issues carrying ${OLD_LABEL}`), `says what failed, got: ${output}`);
    assert(!ghCalls(stub).some((c) => isCall(c, 'label', 'delete')), 'and the label survives for the next run');
    assert(!ghCalls(stub).some((c) => isCall(c, 'issue', 'edit')), 'nothing was relabeled on a guess');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('issues left over past the query limit keep the label alive', () => {
    // The list is capped. A repo above the cap moves the page it can see; the
    // overflow is still out there, so the repo is ASKED AGAIN and only an
    // answer of none licenses the delete.
    const repo = makeRepo();
    const page = Array.from({ length: 500 }, (_, i) => 1000 + i);
    const stub = makeGhStub({
      labels: [...desiredLabels(), retiredLabel(OLD_LABEL)],
      labeled: { [OLD_LABEL]: page },
      labeledRecheck: { [OLD_LABEL]: [2000, 2001] },
    });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 1, 'the run reports itself unfinished');
    assertEq(ghCalls(stub).filter((c) => isCall(c, 'issue', 'edit')).length, 500, 'the visible page still moved');
    assert(output.includes(`${OLD_LABEL} still carries issues`), `says why the label stayed, got: ${output}`);
    assert(!ghCalls(stub).some((c) => isCall(c, 'label', 'delete')), 'and nothing was deleted over the overflow');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a re-ask that fails is not read as an empty label either', () => {
    const repo = makeRepo();
    const stub = makeGhStub({
      labels: [...desiredLabels(), retiredLabel(OLD_LABEL)],
      labeled: { [OLD_LABEL]: [31] },
    });
    // The first query answers; the re-ask before the delete does not.
    fs.writeFileSync(path.join(stub.binDir, 'gh'),
      readFile(path.join(stub.binDir, 'gh')).replace(
        '  if [[ "$asked" -gt 1 ]]; then',
        '  if [[ "$asked" -gt 1 ]]; then\n    exit 1',
      ), { mode: 0o755 });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 1, 'exit non-zero');
    assert(output.includes(`could not confirm ${OLD_LABEL} is empty`), `says so, got: ${output}`);
    assert(!ghCalls(stub).some((c) => isCall(c, 'label', 'delete')), 'the label is kept');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a label delete that fails is named and marks the run unfinished', () => {
    const repo = makeRepo();
    const stub = makeGhStub({
      labels: [...desiredLabels(), retiredLabel(OLD_LABEL)],
      labeled: { [OLD_LABEL]: [4] },
      labelDeleteFails: true,
    });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 1, 'exit non-zero');
    assert(output.includes(`could not delete the retired ${OLD_LABEL}`), `says which, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a retired label with no issues on it is simply deleted', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ labels: [...desiredLabels(), retiredLabel(OLD_LABEL)] });
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(!ghCalls(stub).some((c) => isCall(c, 'issue', 'edit')), 'nothing to relabel');
    assert(
      ghCalls(stub).some((c) => eqArgv(c, ['label', 'delete', OLD_LABEL, '--yes'])),
      `the empty label still goes, got: ${fmtCalls(ghCalls(stub))}`,
    );
    assert(!output.includes('moved 0 issues'), `and no empty claim is printed, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('offline — the migration touches nothing without the label list', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ authed: false });
    const { code } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    const calls = ghCalls(stub);
    assert(!calls.some((c) => isCall(c, 'issue', 'edit')), 'no relabeling');
    assert(!calls.some((c) => isCall(c, 'label', 'delete')), 'no deletion on a machine that never saw the labels');
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
        { number: 7, labels: [{ name: 'status:parked' }, { name: 'type:idea' }, { name: 'priority:low' }] },
        { number: 8, labels: [{ name: 'status:specced' }] },
        { number: 9, labels: [{ name: 'status:specced' }, { name: 'type:bug' }, { name: 'type:idea' }] },
      ],
    });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'report-only — never fails the run');
    assert(output.includes('#3'), `an issue without a status is named, got: ${output}`);
    assert(output.includes('#4'), `a double status is named, got: ${output}`);
    assert(output.includes('#5'), `priority:high plus priority:low is named, got: ${output}`);
    assert(!output.includes('#6') && !output.includes('#7'), `a conforming issue is not named — priority absence is normal, got: ${output}`);
    assert(output.includes('#8'), `an issue without a type is named — type is required, got: ${output}`);
    assert(output.includes('#9'), `a double type is named — type is exclusive, got: ${output}`);
    assert(output.includes('workkit:triage'), `names the fix, got: ${output}`);
    assertEq(ghCalls(stub).filter((c) => isCall(c, 'issue', 'list')).length, 1, 'one gh call for the whole report');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a conforming issue list stays silent', () => {
    const repo = makeRepo();
    const stub = makeGhStub({
      labels: desiredLabels(),
      issues: [
        { number: 1, labels: [{ name: 'status:specced' }, { name: 'type:bug' }] },
        { number: 2, labels: [{ name: 'status:parked' }, { name: 'type:idea' }, { name: 'priority:high' }] },
      ],
    });
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(!output.includes('workkit:triage'), `nothing to route, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  group('gh stub: argument boundaries survive recording');

  // The label assertions above are only as strong as the recording underneath
  // them. These two cases prove the recording tells a quoted expansion from an
  // unquoted one — the exact regression a `"$*"` log could not see.
  const callStub = (stub, snippet) => {
    spawnSync('bash', ['-c', snippet], {
      env: { ...process.env, PATH: `${stub.binDir}:/usr/bin:/bin` },
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

  await test('the same phrase unquoted arrives split — and is not mistaken for the quoted call', () => {
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
    // And the pairs are still each other's — not one call's flag with another's value.
    const mismatched = calls.filter((c) => c[4] !== `a phrase here ${c[2].replace('name', '')}`);
    assertEq(mismatched.length, 0, `each description stayed with its own label, got: ${fmtCalls(mismatched)}`);
    cleanup(stub.dir);
  });

  group('standards.sh: offline and unauthenticated');

  await test('no gh on PATH — clean exit, local heals still applied', () => {
    const repo = makeRepo();
    // Hand-built PATH, like the jq test below: `command -v gh` searches every
    // PATH entry, and a machine that keeps gh in /usr/bin (a CI runner does)
    // would otherwise reach the authentication check instead of this one.
    const binDir = binDirWithout('gh');
    const res = spawnSync('/bin/bash', [SCRIPT, repo], {
      env: { PATH: binDir, WORKFLOW_HOME: path.join(binDir, 'workflow-home') },
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

  await test('no jq on PATH — only the label step is skipped, local heals run', () => {
    const repo = makeRepo();
    const binDir = binDirWithout('jq');
    const res = spawnSync('/bin/bash', [SCRIPT, repo], {
      env: { PATH: binDir, WORKFLOW_HOME: path.join(binDir, 'workflow-home') },
      encoding: 'utf8',
      timeout: 20000,
    });
    const stdout = (res.stdout || '') + (res.stderr || '');
    assertEq(res.status, 0, 'exit 0');
    assert(stdout.includes('jq not installed'), `says why the label step was skipped, got: ${stdout}`);
    assert(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'templates still installed');
    assert(fs.existsSync(path.join(repo, W, 'inbox.md')), 'inbox still created');
    assert(IGNORE_GLOB.test(readFile(path.join(repo, '.gitignore'))), 'gitignore still healed');
    cleanup(repo); cleanup(binDir);
  });

  await test('gh present but unauthenticated — skipped without any label call', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ authed: false });
    const { code, output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assert(!stdout.includes('⚠'), `announces nothing broken, got: ${stdout}`);
    assert(stdout.includes('not authenticated'), `says why, got: ${stdout}`);
    assert(!ghCalls(stub).some((c) => isCall(c, 'label')), 'never reaches the label API');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('no origin remote — labels skipped, exit 0', () => {
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
    const res = spawnSync('bash', [SCRIPT], {
      cwd: repo,
      env: {
        ...process.env, PATH: `${stub.binDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
        // Inherited HOME plus the two user-level seeds would write the real
        // ~/.workkit and repoint the real ~/.claude/workkit.
        WORKFLOW_HOME: path.join(mkTmp(), 'wh'), WORKFLOW_CLAUDE_HOME: path.join(mkTmp(), 'ch'),
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
const NODE_DIR = path.dirname(process.execPath);
const repoVersion = (dir) => JSON.parse(readFile(path.join(dir, W, 'settings.json'))).version;

const driftRun = async () => {
  group('standards.sh: the version gate and the drift report');

  await test('a retired file is reported and never touched', () => {
    // Deleting PROGRESS.md deletes work items nobody migrated. The script says
    // what to run; a human (or the migrate skill) does it. The name has to be
    // the skill that actually does this job — workkit:migrate advertises the
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
    const { output } = runScript(dir, { pathPrefix: `${stub.binDir}:${NODE_DIR}` });
    assert(/CHANGELOG\.md has 2 entries not in the entry format/.test(output), `counted, got: ${output}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a conforming CHANGELOG is not reported', () => {
    const dir = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), [
      '# Changelog', '', '## [1.0.0] - 2020-01-01', '', '### Added',
      '- (no issue) — A short entry in the format.', '',
    ].join('\n'));
    const { output } = runScript(dir, { pathPrefix: `${stub.binDir}:${NODE_DIR}` });
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

  await test('no node with a CHANGELOG present — the version is not stamped, and the run says so', () => {
    // The CHANGELOG check is guarded on `command -v node`; stamping anyway
    // ended the one-time drift report for a file nobody checked.
    const dir = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), [
      '# Changelog', '', '## [1.0.0] - 2020-01-01', '', '### Added',
      '- **A big essay entry** that carries no issue link and no separator at all.', '',
    ].join('\n'));
    const { code, output } = runScript(dir, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'a missing tool is a machine condition, not a failure');
    assertEq(repoVersion(dir), 1, 'not stamped past a check that never ran');
    assert(output.includes('version not stamped'), `says so on stderr, got: ${output}`);
    // Once node is available the check runs and the same repo stamps forward.
    runScript(dir, { pathPrefix: `${stub.binDir}:${NODE_DIR}` });
    assertEq(repoVersion(dir), STANDARD_VERSION, 'stamps once the check could run');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('no jq — the version is not stamped and the run says why, instead of re-reporting silently forever', () => {
    const dir = makeRepo();
    const binDir = mkTmp();
    for (const tool of ['git', 'grep', 'tail', 'head', 'cp', 'mkdir', 'tr', 'cat', 'dirname', 'basename']) {
      const real = spawnSync('command', ['-v', tool], { shell: '/bin/bash', encoding: 'utf8' }).stdout.trim();
      fs.symlinkSync(real, path.join(binDir, tool));
    }
    const res = spawnSync('/bin/bash', [SCRIPT, dir], {
      env: { PATH: binDir, WORKFLOW_HOME: path.join(binDir, 'wh') }, encoding: 'utf8', timeout: 20000,
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

if (require.main === module) {
  module.exports().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
