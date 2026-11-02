// Tests for the one settings view in hooks/mods/settings.js: the kit defaults, the
// machine file, then the repo file, merged key by key, the more specific winning, and
// `enabled` the repo file's alone. Every file reaches the loader through a case's read
// function; the kit defaults are the real defaults/settings.json unless a case replaces them.

const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const {
  group, test, assert, assertEq, selfRun, summary,
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

// The harness compares with `===`, so a value is compared in its JSON form.
const same = (actual, expected, msg) => assert(isDeepStrictEqual(actual, expected), `${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

/** The error a call threw or rejected with, null when it answered. */
const failure = async (fn) => {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  return null;
};

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
      const err = await failure(() => view(world({ defaults, user: { findings: { file: true } }, repo: { enabled: true } })));
      assert(err instanceof Error, `${what}: the read throws`);
      assert(/defaults[\\/]settings\.json/.test(err.message), `${what}: the error names the file, got: ${err.message}`);
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

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
