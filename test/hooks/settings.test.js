// Tests for the one settings view in hooks/mods/settings.js: the kit defaults, the
// machine file, then the repo file, merged key by key, the more specific winning, and
// `enabled` the repo file's alone. Every file reaches the loader through a case's read
// function; the kit defaults are the real defaults/settings.json unless a case replaces them.

const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const {
  group, test, assert, assertEq, failureOf, selfRun, summary,
} = require('../lib/harness');
const { mods } = require('../lib/mods-inputs');

const KIT_DEFAULTS = path.join(__dirname, '..', '..', 'defaults', 'settings.json');

const HOME = '/w/home';
const ROOT = '/w/repo';
const KIT = '/w/kit';
const USER = `${HOME}/.workkit/settings.json`;

/**
 * One world's read: `repo` and `user` the two files' bodies (a string as written,
 * an object as JSON, undefined for no file), `defaults` the kit file's text in
 * place of the real one (null for no file), `machine` where the machine file sits.
 */
const world = ({
  repo, user, defaults, machine = USER,
}) => {
  const files = {};
  const put = (p, body) => { if (body !== undefined) files[p] = typeof body === 'string' ? body : JSON.stringify(body); };
  put(machine, user);
  put(`${ROOT}/.workkit/settings.json`, repo);
  const read = (p) => {
    const at = String(p).replace(/\\/g, '/');
    if (at !== `${KIT}/defaults/settings.json`) return files[at] ?? null;
    if (defaults !== undefined) return defaults;
    return fs.existsSync(KIT_DEFAULTS) ? fs.readFileSync(KIT_DEFAULTS, 'utf8') : null;
  };
  return { read };
};

/** The merged view a world gives the repo at ROOT, or no repo at all when `root` is null. */
const view = (w, root = ROOT) => mods('settings').loadSettings(w.read, { kit: KIT, root, user: USER });

/** The faults the same world's merge set aside, over `read` in place of the world's own when given. */
const faults = (w, read = w.read) => mods('settings').settingsFaults(read, { kit: KIT, root: ROOT, user: USER });

// A fault's line names its file as the loader spells it, so a Windows separator is read as `/`.
const slashed = (found) => found.map(({ line }) => line.replace(/\\/g, '/'));

const REPO_FILE = `${ROOT}/.workkit/settings.json`;

// The harness compares with `===`, so a value is compared in its JSON form.
const same = (actual, expected, msg) => assert(isDeepStrictEqual(actual, expected), `${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const cases = async () => {
  group('settings: a key set in neither file');

  await test('reads the kit default: enabled and findings.file false, the hooks lists empty, the unset keys null', async () => {
    const s = await view(world({}));
    assertEq(s.enabled, false, 'enabled');
    assertEq(s.findings.file, false, 'findings.file');
    same(s.hooks.afterRelease, [], 'hooks.afterRelease');
    same(s.hooks.afterDeploy, [], 'hooks.afterDeploy');
    assertEq(s.tests.budget, null, 'tests.budget');
    assertEq(s.public, null, 'public');
    assertEq(s.site.publish, null, 'site.publish');
  });

  await test('reads the manager block of the kit defaults: rewrite, on, and its three tiers', async () => {
    const s = await view(world({ repo: { enabled: true }, user: { version: 1 } }));
    same(s.manager, { mode: 'rewrite', enabled: true, tiers: { frontier: 'fable', workhorse: 'opus', fast: 'sonnet' } }, 'manager');
  });

  group('settings: the machine file, then the repo file');

  await test('the machine file sets a key the repo file does not: the machine value', async () => {
    const s = await view(world({ repo: { enabled: true }, user: { findings: { file: true } } }));
    assertEq(s.findings.file, true, 'the machine file answers');
  });

  await test('both set it: the repo value, false included', async () => {
    const off = await view(world({ repo: { enabled: true, findings: { file: false } }, user: { findings: { file: true } } }));
    assertEq(off.findings.file, false, 'a repo false beats a machine true');
    const on = await view(world({ repo: { enabled: true, findings: { file: true } }, user: { findings: { file: false } } }));
    assertEq(on.findings.file, true, 'a repo true beats a machine false');
  });

  await test('key by key: a nested key from each layer and the default beside them', async () => {
    const s = await view(world({ repo: { enabled: true, site: { url: 'acme.dev' } }, user: { site: { repo: 'acme/home' } } }));
    same([s.site.repo, s.site.url, s.site.publish], ['acme/home', 'acme.dev', null], 'site.repo, site.url, site.publish');
  });

  await test('outside any repo: the machine file over the defaults', async () => {
    const s = await view(world({ user: { findings: { file: true } } }), null);
    assertEq(s.findings.file, true, 'the machine file answers');
  });

  await test('a machine or repo file that does not parse adds nothing, and the layers under it still answer', async () => {
    const repoBroken = await view(world({ repo: '{ "findings": ', user: { findings: { file: true } } }));
    assertEq(repoBroken.findings.file, true, 'a broken repo file: the machine file answers');
    const userBroken = await view(world({ repo: { enabled: true, tests: { budget: 4 } }, user: '{ "findings": ' }));
    same([userBroken.tests.budget, userBroken.findings.file], [4, false], 'a broken machine file: the repo file and the defaults answer');
  });

  await test('WORKFLOW_HOME moves the machine file', async () => {
    const w = world({ user: { findings: { file: true } }, machine: '/w/moved/settings.json' });
    const moved = await mods('settings').rootSettings(ROOT, { HOME, WORKFLOW_HOME: '/w/moved' }, { read: w.read, pluginRoot: KIT });
    assertEq(moved.findings.file, true, 'the file under WORKFLOW_HOME answers');
  });

  group('settings: null and arrays');

  await test('a null in a higher layer leaves the lower layer\'s value', async () => {
    const s = await view(world({
      repo: { enabled: true, tests: { budget: null }, site: null },
      user: { tests: { budget: 5 }, site: { repo: 'acme/home' }, hooks: { afterRelease: null } },
    }));
    assertEq(s.tests.budget, 5, 'a repo null leaves the machine budget');
    assertEq(s.site.repo, 'acme/home', 'a repo null object leaves the machine one');
    same(s.hooks.afterRelease, [], 'a machine null leaves the default list');
  });

  await test('a higher-layer value whose type differs from an object default is skipped like a null', async () => {
    const s = await view(world({ repo: { enabled: true, identity: 'x' }, user: { manager: 'off' } }));
    same(s.manager, { mode: 'rewrite', enabled: true, tiers: { frontier: 'fable', workhorse: 'opus', fast: 'sonnet' } },
      'a string manager keeps the default block');
    assertEq(s.identity.tokenUrl, 'https://workkit.itwcreativeworks.com/token', 'a string identity keeps the default tokenUrl');
  });

  await test('an array in a higher layer replaces the lower one, never appends to it', async () => {
    const s = await view(world({
      repo: { enabled: true, proof: { rootOnly: ['c'] }, hooks: { afterRelease: [{ command: 'two' }] } },
      user: { proof: { rootOnly: ['a', 'b'] }, hooks: { afterRelease: [{ command: 'one' }] } },
    }));
    same(s.proof.rootOnly, ['c'], 'proof.rootOnly');
    same(s.hooks.afterRelease, [{ command: 'two' }], 'hooks.afterRelease');
  });

  group('settings: enabled is the repo file\'s alone');

  await test('a machine "enabled": true turns no repo on: no repo file, one with no key, and no repo at all read false', async () => {
    const user = { enabled: true };
    assertEq((await view(world({ user }))).enabled, false, 'no repo file');
    assertEq((await view(world({ user, repo: {} }))).enabled, false, 'a repo file with no enabled key');
    assertEq((await view(world({ user, repo: { version: 1 } }))).enabled, false, 'a repo file with only a version');
    assertEq((await view(world({ user }), null)).enabled, false, 'no repo');
  });

  await test('the repo file\'s own value wins over a machine value either way', async () => {
    assertEq((await view(world({ repo: { enabled: true }, user: { enabled: false } }))).enabled, true, 'a repo true');
    assertEq((await view(world({ repo: { enabled: false }, user: { enabled: true } }))).enabled, false, 'a repo false');
  });

  group('settings: the kit defaults file is required');

  await test('a missing or unparsable defaults file is an error naming the file, never a silent fallback', async () => {
    for (const [what, defaults] of [['missing', null], ['unparsable', '{ "enabled": ']]) {
      const err = await failureOf(() => view(world({ defaults, user: { findings: { file: true } }, repo: { enabled: true } })));
      assert(err instanceof Error, `${what}: the read throws`);
      assert(/defaults[\\/]settings\.json/.test(err.message), `${what}: the error names the file, got: ${err.message}`);
    }
  });

  group('settings: settingsFaults names each value the merge set aside');

  await test('case 1: a clean machine file and repo file: no fault', () => {
    same(faults(world({ repo: { enabled: true, site: { url: 'acme.dev' } }, user: { findings: { file: true } } })), [], 'no line');
  });

  await test('case 2: a repo proof that is an array: one line naming the repo file and proof', () => {
    same(slashed(faults(world({ repo: { enabled: true, proof: ['backend'] } }))),
      [`${REPO_FILE}: proof is not an object, so the value below it stands`], 'the proof line');
  });

  await test('case 3: a repo file that does not parse: one line, the file adds nothing', () => {
    same(slashed(faults(world({ repo: '{ not json' }))), [`${REPO_FILE} is not a JSON object, so it adds nothing`], 'the parse line');
  });

  await test('case 4: a machine file that parses to an array is a fault; an empty or blank one is none', () => {
    same(slashed(faults(world({ repo: { enabled: true }, user: '[]' }))),
      [`${USER} is not a JSON object, so it adds nothing`], 'an array');
    for (const user of ['', '  \n']) {
      same(faults(world({ repo: { enabled: true }, user })), [], `the text ${JSON.stringify(user)}`);
    }
  });

  await test('case 5: a machine manager that is a string, or a tiers that is, is a fault naming the dotted key; an object or a null is none', () => {
    const line = (key) => `${USER}: ${key} is not an object, so the value below it stands`;
    same(slashed(faults(world({ repo: { enabled: true }, user: { manager: 'off' } }))), [line('manager')], 'a string manager');
    same(slashed(faults(world({ repo: { enabled: true }, user: { manager: { tiers: 'x' } } }))), [line('manager.tiers')], 'a string tiers');
    same(faults(world({ repo: { enabled: true }, user: { manager: { enabled: true }, site: null } })), [], 'an object manager and a null site');
  });

  await test('case 6: an async read answers a promise of the same lines', async () => {
    const w = world({ repo: { enabled: true, proof: ['backend'] } });
    const answer = faults(w, async (p) => w.read(p));
    assert(typeof answer.then === 'function', `a promise, got: ${answer}`);
    same(slashed(await answer), [`${REPO_FILE}: proof is not an object, so the value below it stands`], 'the proof line');
  });

  await test('case 7: each fault is its file, its dotted key (null for a whole file) and its line', () => {
    same(faults(world({ repo: '{ not json', user: { manager: { tiers: 'x' } } })), [
      { file: USER, key: 'manager.tiers', line: `${USER}: manager.tiers is not an object, so the value below it stands` },
      { file: REPO_FILE, key: null, line: `${REPO_FILE} is not a JSON object, so it adds nothing` },
    ], 'the two faults in walk order');
  });

  await test('case 8: faultsUnder answers the faults whose key is the prefix or under it, in order', () => {
    const at = (key) => ({ file: USER, key, line: `${key}` });
    const found = [at('proof'), at(null), at('proofing'), at('hooks.afterRelease'), at('proof.rootOnly')];
    same(mods('settings').faultsUnder(found, 'proof'), [at('proof'), at('proof.rootOnly')], 'proof and proof.rootOnly alone');
    same(mods('settings').faultsUnder(found, 'identity'), [], 'none under identity');
  });

  await test('case 9: a missing or unparsable defaults file throws the error loadSettings throws', async () => {
    for (const [what, defaults] of [['missing', null], ['unparsable', '{ "enabled": ']]) {
      const w = world({ defaults, repo: { enabled: true } });
      const err = await failureOf(() => faults(w));
      assert(err instanceof Error, `${what}: settingsFaults throws`);
      assertEq(err.message, (await failureOf(() => view(w))).message, `${what}: the same error`);
    }
  });

  group('settings: the wiring suites\' copy of the defaults');

  await test('mod-fixtures.mjs DEFAULTS is defaults/settings.json, value for value', () => {
    const { DEFAULTS } = require('../lib/mod-fixtures.mjs');
    assert(isDeepStrictEqual(DEFAULTS, JSON.parse(fs.readFileSync(KIT_DEFAULTS, 'utf8'))), 'the copy the mod world serves');
  });

  group('settings: findingsOn and findingsRoute over the merged view');

  await test('findingsOn: true only when findings.file reads true, absent reading the default off', async () => {
    const { findingsOn } = mods('settings');
    assertEq(findingsOn(await view(world({ user: { findings: { file: true } } }))), true, 'true reads on');
    assertEq(findingsOn(await view(world({ user: { findings: { file: false } } }))), false, 'false reads off');
    assertEq(findingsOn(await view(world({ user: { version: 1 } }))), false, 'an absent key reads off');
  });

  await test('findingsRoute: off and absent both name the chat route, on files a status:inbox issue', async () => {
    const { findingsRoute } = mods('settings');
    for (const user of [{ findings: { file: false } }, { version: 1 }]) {
      const said = findingsRoute(await view(world({ user })));
      assert(said.includes('chat under 🧭 Findings') && said.includes('file or drop'), `the chat route, got: ${said}`);
      assert(!said.includes('status:inbox'), `files nothing, got: ${said}`);
    }
    const on = findingsRoute(await view(world({ user: { findings: { file: true } } })));
    assert(on.includes('status:inbox'), `and on files a status:inbox issue, got: ${on}`);
  });

  group('settings: attributionOff over the merged view');

  await test('attributionOff: an absent commit.attribution, or a true one, reads false', async () => {
    const { attributionOff } = mods('settings');
    assertEq(attributionOff(await view(world({ repo: { enabled: true } }))), false, 'absent');
    assertEq(attributionOff(await view(world({ repo: { enabled: true, commit: { attribution: true } } }))), false, 'true');
  });

  await test('attributionOff: false in the repo file or the machine file reads true, a repo true winning over a machine false', async () => {
    const { attributionOff } = mods('settings');
    const off = { commit: { attribution: false } };
    assertEq(attributionOff(await view(world({ repo: { enabled: true, ...off } }))), true, 'the repo file says false');
    assertEq(attributionOff(await view(world({ repo: { enabled: true }, user: off }))), true, 'the machine file says false');
    assertEq(attributionOff(await view(world({ repo: { enabled: true, commit: { attribution: true } }, user: off }))), false,
      'the repo true wins');
  });

  group('settings: bulletsOn and shapePaths over the merged view');

  await test('bulletsOn: the machine file true and no repo value turns the check on, a repo false keeps it off', async () => {
    const { bulletsOn } = mods('settings');
    const user = { docs: { bullets: true } };
    assertEq(bulletsOn(await view(world({ user, repo: { enabled: true } }))), true, 'the machine value answers');
    assertEq(bulletsOn(await view(world({ user, repo: { enabled: true, docs: { bullets: false } } }))), false, 'the repo false wins');
  });

  await test('shapePaths: the kit default is AGENTS.md, README.md and docs/', async () => {
    same(mods('settings').shapePaths(await view(world({ repo: { enabled: true } }))), ['AGENTS.md', 'README.md', 'docs/'], 'the default set');
  });

  await test('shapePaths: the machine file sets the set for a repo that sets none, and a repo value wins over it', async () => {
    const { shapePaths } = mods('settings');
    const user = { docs: { paths: ['handbook/'] } };
    same(shapePaths(await view(world({ user, repo: { enabled: true } }))), ['handbook/'], 'the machine set');
    same(shapePaths(await view(world({ user, repo: { enabled: true, docs: { paths: ['./'] } } }))), ['./'], 'the repo set');
  });

  await test('shapePaths: a value that is not an array of strings answers null', () => {
    const { shapePaths } = mods('settings');
    for (const paths of ['docs/', ['docs/', 7], { docs: true }]) {
      assertEq(shapePaths({ docs: { bullets: true, paths } }), null, `${JSON.stringify(paths)} answers null`);
    }
  });

  await test('shapePaths: an entry that can match nothing answers null, and an empty array stands', () => {
    const { shapePaths } = mods('settings');
    for (const paths of [['docs'], ['.'], ['/docs/'], ['docs\\a.md']]) {
      assertEq(shapePaths({ docs: { bullets: true, paths } }), null, `${JSON.stringify(paths)} answers null`);
    }
    same(shapePaths({ docs: { bullets: true, paths: [] } }), [], 'an empty set is valid');
  });

  group('settings: checkMinutes over the merged view');

  await test('checkMinutes: the kit default is 5', async () => {
    assertEq(mods('settings').checkMinutes(await view(world({ repo: { enabled: true } }))), 5, 'the default check');
  });

  await test('checkMinutes: the machine file sets it for a repo that sets none, and a repo value wins over it, a fraction included', async () => {
    const { checkMinutes } = mods('settings');
    const user = { tests: { check: 2 } };
    assertEq(checkMinutes(await view(world({ user, repo: { enabled: true } }))), 2, 'the machine value');
    assertEq(checkMinutes(await view(world({ user, repo: { enabled: true, tests: { check: 0.5 } } }))), 0.5, 'the repo value');
  });

  await test('checkMinutes: 0, a negative number or a word throws the line naming the key and the value', async () => {
    const { checkMinutes } = mods('settings');
    for (const check of [0, -1, 'five']) {
      const err = await failureOf(() => checkMinutes({ tests: { check } }));
      assert(err instanceof Error, `${JSON.stringify(check)}: an Error`);
      assertEq(err.message, `tests.check must be a number of minutes above 0 (got ${JSON.stringify(check)})`, `${JSON.stringify(check)}: the line`);
    }
  });

  await test('checkMinutes: 1e999 in the repo file, an infinite number, throws the line naming the key and the value as Infinity', async () => {
    const { checkMinutes } = mods('settings');
    const s = await view(world({ repo: '{ "enabled": true, "tests": { "check": 1e999 } }\n' }));
    const err = await failureOf(() => checkMinutes(s));
    assert(err instanceof Error, 'an Error');
    assertEq(err.message, 'tests.check must be a number of minutes above 0 (got Infinity)', 'the line');
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
