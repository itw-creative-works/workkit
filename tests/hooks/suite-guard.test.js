// Tests for safety:suite-guard's logic, suiteGuardVerdict({ command, cwd,
// root, testScript, memberDirs, suiteRecord, treeId, building }) in
// hooks/mods/suite-guard.js: a repeat root run on a recorded tree bounces, and
// so does a root run while an issue is building; a narrowed run and a mention
// pass. `memberDirs` maps each package folder under the root to its `{ name,
// test }`, `real(path)` (async) its physical spelling or null. Each case ports
// the HEAD case its name quotes. Dropped with the shell: "no jq", "malformed
// JSON". In tests/mods/guards-suite-guard.test.ts: the loader's bounce, the
// tree read for `workkit prove`, "no origin".

const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

const ROOT = '/w/repo';
const TREE = 'a'.repeat(40);
const OTHER_TREE = 'b'.repeat(40);
const MARKER = '/claude-suite-marker/2d98e56dc36b7431b8f668bf4d7715c564698d73';

// gh's answer to `issue list --json number,labels`.
const issue = (number, ...labels) => ({ number, labels: labels.map((name) => ({ name })) });
const BUILDING = [issue(12, 'status:qa', 'type:bug'), issue(7, 'status:building', 'type:feature')];
const WORKING = [issue(9, 'status:qa', 'agent:claimed'), issue(10, 'status:complete', 'agent:claimed')];
const SETTLED = [issue(12, 'status:qa', 'type:bug'), issue(14, 'status:complete', 'type:chore')];

const NARROW = "Run the narrowest test that proves the change (`npm test -- <file>` from the package's folder)";
const PROVED_HEAD = 'suite-guard: this tree is already proved: the full suite ran green on it and ';
const PROVED_TAIL = ` records it. ${NARROW}; the commit gate reads the same record for a commit whose staged tree matches it.`;
const HOLD = (named) => `suite-guard: the full suite runs once, at the commit, after every item in the tree is parked and passed; still building: ${named}. That work has to finish first: its tests green and its Proof: comment posted, then its own park moves it to status:qa. Never relabel an item to get past this guard. ${NARROW}.`;

// The workspaces root: packages/x declares its own test script, packages/y none.
const MEMBERS = {
  'packages/x': { name: 'x', test: 'node --test' },
  'packages/y': { name: 'y', test: null },
};

/**
 * The `real` fact over a fixture: the physical spelling (`toPhys` of the
 * path, normalized) of a folder the fixture holds (the root, the cwd, each
 * package folder and those between), null for one that does not exist.
 */
const realOf = ({ root, cwd, memberDirs }, toPhys = (p) => p) => {
  const known = new Set([root, cwd]);
  for (const dir of Object.keys(memberDirs || {})) {
    const segs = dir.split('/');
    segs.forEach((_, i) => known.add(`${root}/${segs.slice(0, i + 1).join('/')}`));
  }
  return async (p) => {
    const phys = path.posix.normalize(toPhys(p)).replace(/\/$/, '');
    return known.has(phys) ? phys : null;
  };
};

/**
 * One verdict over `command` in the repo root with its own test script, no
 * record and nothing building, `over` replacing any fact; `list` is gh's
 * building answer (null when gh cannot answer). Hands back the verdict, its
 * deny and how often the building list was read.
 */
const judged = async (command, over = {}, list = []) => {
  let asked = 0;
  const building = async () => { asked++; return list === null ? null : JSON.stringify(list); };
  const r = await mods('suite-guard').suiteGuardVerdict({
    command, cwd: ROOT, root: ROOT, testScript: 'node tests/run.js', memberDirs: {}, suiteRecord: null, treeId: TREE, building, ...over, real: over.real || realOf({ root: ROOT, memberDirs: {}, ...over }),
  });
  return { r, asked: () => asked, deny: r && typeof r.deny === 'string' ? r.deny.replace(/\n$/, '') : null };
};
const proved = { suiteRecord: `${TREE}\n` };

const assertProved = (deny, what) => {
  assert(typeof deny === 'string' && deny.startsWith(PROVED_HEAD) && deny.endsWith(PROVED_TAIL) && deny.includes(MARKER),
    `the proved-tree bounce naming the marker: ${what}, got: ${deny}`);
};
const blocks = async (command, over = proved) => assertProved((await judged(command, over)).deny, command);
const silent = async (command, over = proved, list = []) => {
  const { r, deny } = await judged(command, over, list);
  assertEq(deny, null, `must pass: ${command}`);
  assertEq(textOf(r), '', `and say nothing: ${command}`);
};

const run = async () => {
  group('suite-guard: a repeat on a proved tree');

  await test('ports "a first full run passes: no marker records the tree"', async () => {
    await silent('npm test', {});
  });

  await test('ports "a repeat on a proved tree bounces, naming the marker and the narrow run"', async () => {
    const { deny } = await judged('npm test', proved);
    assertProved(deny, 'npm test');
    assert(!deny.includes('WORKKIT_SUITE'), `names no flag, got: ${deny}`);
    await blocks('WORKKIT_SUITE=1 npm test');
  });

  await test('ports "a tree change passes the same command again"', async () => {
    await silent('npm test', { suiteRecord: `${TREE}\n`, treeId: OTHER_TREE });
  });

  await test('ports "a stale marker, holding another tree, passes"', async () => {
    await silent('npm test', { suiteRecord: `${'0'.repeat(40)}\n` });
  });

  group('suite-guard: what a full run is, on a proved tree');

  await test('ports "npm run test bounces, the same run spelled out"', async () => {
    await blocks('npm run test');
  });

  await test('ports "the repo\'s own test script run directly bounces"', async () => {
    await blocks('node tests/run.js');
  });

  await test('ports "another repo, another script, the same bounce"', async () => {
    const over = { ...proved, testScript: 'jest --runInBand' };
    await blocks('jest --runInBand', over);
    await silent('ls node_modules/.bin/jest --runInBand', over);
  });

  await test('ports "a full run inside a compound bounces too"', async () => {
    for (const c of ['git status && npm test', 'npm test 2>&1 | tail -20', 'npm test>out.log',
      'node tests/run.js 2>&1 | tail -20', 'node tests/run.js > out.txt']) {
      await blocks(c);
    }
    await silent('echo xnode tests/run.js');
  });

  await test('ports "npm\'s own spellings of the same run bounce"', async () => {
    await blocks('npm t');
    await blocks('npm --silent test');
  });

  await test('ports "EVERY occurrence is judged, not the first"', async () => {
    await blocks('npm test -- tests/hooks/suite-guard.test.js && npm test');
  });

  group('suite-guard: the narrow run passes, proved tree or not');

  await test('ports "every narrowed spelling passes"', async () => {
    for (const c of [
      'npm test -- tests/hooks/suite-guard.test.js',
      'node --test tests/hooks/suite-guard.test.js',
      'node tests/hooks/suite-guard.test.js',
      'npx omega test unit',
      'node tests/run.js hooks',
    ]) {
      await silent(c);
    }
  });

  await test('ports "a script whose name only starts with test is another script"', async () => {
    await silent('npm run test:unit');
  });

  group('suite-guard: a mention is not a run');

  await test('ports "the suite named inside a quoted string passes"', async () => {
    for (const c of [
      'git commit -m "test: cover npm test wiring"',
      'gh issue comment 243 --body "Proof: unit: npm test ran green at the gate"',
      'echo "reminder: npm test belongs to the commit gate"',
    ]) {
      await silent(c);
    }
  });

  await test('ports "the suite named inside a heredoc body passes"', async () => {
    await silent('cat <<EOF > notes.md\nnpm test\nEOF');
  });

  await test('ports "ordinary commands pass, silently": and never read the building list', async () => {
    for (const c of ['git status', 'ls -la', 'gh issue list --label status:qa', 'cat package.json']) {
      const out = await judged(c, proved, BUILDING);
      assertEq(out.deny, null, `must pass: ${c}`);
      assertEq(textOf(out.r), '', `and say nothing: ${c}`);
      assertEq(out.asked(), 0, `no root run, no gh read: ${c}`);
    }
  });

  group('suite-guard: nested packages');

  const SUB = { sub: { name: 'sub', test: 'node --test' } };

  await test('ports "a nested package\'s own npm test passes from inside it, even on a proved root"', async () => {
    await silent('npm test', { ...proved, cwd: `${ROOT}/sub`, memberDirs: SUB });
  });

  await test('ports "the root\'s script run from inside a nested package is judged by the marker"', async () => {
    const inSub = { cwd: `${ROOT}/sub`, memberDirs: SUB };
    await silent('cd .. && node tests/run.js', inSub);
    await blocks('cd .. && node tests/run.js', { ...inSub, ...proved });
    await silent('node --test tests/a.test.js', { ...inSub, ...proved });
  });

  await test('ports "a nested package with no test script never hides the root suite"', async () => {
    await blocks('npm test', { ...proved, cwd: `${ROOT}/sub`, memberDirs: { sub: { name: 'sub', test: null } } });
  });

  group('suite-guard: the folder a run really uses, from the root');

  const MEMBER_RUNS = [
    'cd packages/x && npm test',
    'npm test --prefix packages/x',
    'npm test -w x',
    'npm test --workspace=x',
    'npm test -ws',
    '(cd packages/x; npm test)',
  ];

  await test('ports "a run whose folder is a member with its own test script passes on a proved root"', async () => {
    for (const c of MEMBER_RUNS) await silent(c, { ...proved, memberDirs: MEMBERS });
  });

  await test('ports "a run whose folder is a member with its own test script passes while an issue is building"', async () => {
    for (const c of MEMBER_RUNS) await silent(c, { memberDirs: MEMBERS }, BUILDING);
  });

  await test('ports "a run that reaches the root\'s script is full, and bounces on a proved root"', async () => {
    for (const c of [
      'cd . && npm test',
      `cd ${ROOT} && npm test`,
      'cd packages/y && npm test',
      'cd packages/nope && npm test',
      'npm test -ws --include-workspace-root',
      'cd packages/x && cd ../.. && npm test',
    ]) {
      await blocks(c, { ...proved, memberDirs: MEMBERS });
    }
  });

  await test('ports "a cd back to the root in another spelling, or the root added back by flag or env, is full"', async () => {
    for (const c of [
      'cd packages/x && builtin cd ../.. && npm test',
      'cd packages/x && command cd ../.. && npm test',
      'cd packages/x && \\cd ../.. && npm test',
      'cd packages/x && { cd ../..; npm test; }',
      'cd packages/x && if cd ../..; then npm test; fi',
      'cd packages/x && CDPATH= cd ../.. && npm test',
      'npm test -ws --include-workspace',
      'npm test -w x --include-workspace',
      'npm_config_include_workspace_root=true npm test -ws',
    ]) {
      await blocks(c, { ...proved, memberDirs: MEMBERS });
    }
  });

  group('suite-guard: a folder spelled through a link');

  // /tmp links to /private/tmp, as on a Mac: git names the root physically,
  // the command and the cwd may spell it through the link; `real` resolves.
  // The package's name is not its folder's, so `-w pkg` must find the folder.
  const PHYS = '/private/tmp/fx';
  const LINK = '/tmp/fx';
  const linked = {
    root: PHYS,
    cwd: PHYS,
    memberDirs: { pkg: { name: '@fx/pkg', test: 'node --test' } },
  };
  linked.real = realOf(linked, (p) => (p === '/tmp' || p.startsWith('/tmp/') ? `/private${p}` : p));

  for (const [label, command, cwd] of [
    ['npm test in the linked package cwd', 'npm test', `${LINK}/pkg`],
    ['npm -w pkg test from the linked root', 'npm -w pkg test', LINK],
    ['cd <linked pkg> && npm test', `cd ${LINK}/pkg && npm test`, PHYS],
    ['npm --prefix <linked pkg> test', `npm --prefix ${LINK}/pkg test`, PHYS],
  ]) {
    await test(`a package's own npm test spelled through a link passes while an issue is building: ${label}`, async () => {
      await silent(command, { ...linked, cwd }, BUILDING);
    });
  }

  group('suite-guard: workkit prove is a full run');

  await test('ports "workkit prove on an unproved tree with nothing building passes: the deliberate run"', async () => {
    await silent('workkit prove', {});
  });

  await test('ports "workkit prove with the index tree proved bounces": treeId is the index tree prove proves', async () => {
    await blocks('workkit prove', { suiteRecord: `${OTHER_TREE}\n`, treeId: OTHER_TREE });
  });

  await test('ports "workkit prove with only the working tree proved, the index another, passes"', async () => {
    await blocks('npm test', { suiteRecord: `${TREE}\n`, treeId: TREE });
    await silent('workkit prove', { suiteRecord: `${TREE}\n`, treeId: OTHER_TREE });
  });

  await test('ports "workkit prove while an issue is building bounces, naming it"', async () => {
    assertEq((await judged('workkit prove', {}, BUILDING)).deny, HOLD('#7 (status:building)'), 'opens with the rule, names #7');
  });

  await test('ports "workkit prove named inside a quoted string passes on a proved tree"', async () => {
    await silent('git commit -m "feat: add workkit prove"');
  });

  group('suite-guard: a root run while an item is still building');

  await test('ports "a root run with an open issue at status:building bounces, naming it"', async () => {
    const out = await judged('npm test', {}, BUILDING);
    assertEq(out.deny, HOLD('#7 (status:building)'), 'names #7 and its label, never #12');
    assertEq(out.asked(), 1, 'one building read');
  });

  await test('ports "an open issue carrying agent:claimed past the park passes, silently"', async () => {
    const out = await judged('npm test', {}, WORKING);
    assertEq(out.deny, null, 'only status:building holds the run');
    assertEq(textOf(out.r), '', 'and says nothing');
    assertEq(out.asked(), 1, 'asked for the open issues');
  });

  await test('ports "no issue building and no record: the root run passes, silently"', async () => {
    await silent('npm test', {}, SETTLED);
  });

  await test('ports "gh absent" and "gh failing": the root run passes', async () => {
    assertEq((await judged('npm test', {}, null)).deny, null, 'a gh that cannot answer fails open');
  });

  await test('ports "a narrowed run passes while an issue is building"', async () => {
    for (const c of ['npm test -- tests/hooks/suite-guard.test.js', 'node tests/hooks/suite-guard.test.js']) {
      const out = await judged(c, {}, BUILDING);
      assertEq(out.deny, null, `the narrow run is the one to make mid-build: ${c}`);
      assertEq(textOf(out.r), '', `and says nothing: ${c}`);
      assertEq(out.asked(), 0, `no gh read: ${c}`);
    }
  });

  group('suite-guard: wiring and fail-open');

  await test('ports "hooks.json registers the guard under PreToolUse Bash, after proof-guard": BASH_GUARDS holds the order', async () => {
    const hooks = mods('guards').BASH_GUARDS.map((g) => g.hook);
    const proof = hooks.indexOf('safety:proof-guard');
    const suite = hooks.indexOf('safety:suite-guard');
    assert(proof >= 0 && suite > proof, `suite-guard runs after proof-guard, got: ${hooks.join(', ')}`);
  });

  await test('ports "a repo declaring no test script passes" and "a repo with no package.json at its root passes"', async () => {
    await silent('npm test', { ...proved, testScript: null }, BUILDING);
  });

  await test('ports "a directory inside no git repository passes"', async () => {
    await silent('npm test', { ...proved, root: null, cwd: '/w/plain' }, BUILDING);
  });

  await test('ports "missing command, exit 0"', async () => {
    await silent('', proved, BUILDING);
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
