// Tests for the one settings view in hooks/mods/settings.js: the kit defaults, the
// machine file, then the repo file, merged key by key, the more specific winning, and
// `enabled` the repo file's alone. Every file reaches the loader through a case's read
// function; the kit defaults are the real defaults/settings.json unless a case replaces them.

const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const {
  describe, test, expect,
} = require('../lib/harness');
const { mods } = require('../lib/mods-inputs');
const { caught } = require('../lib/caught');

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
const same = (actual, expected, msg) => expect(isDeepStrictEqual(actual, expected), `${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`).toBeTruthy();

describe('settings: a key set in neither file', () => {
  test('reads the kit default: enabled and findings.file false, the hooks lists empty, the unset keys null', async () => {
    const s = await view(world({}));
    expect(s.enabled, 'enabled').toBe(false);
    expect(s.findings.file, 'findings.file').toBe(false);
    same(s.hooks.afterRelease, [], 'hooks.afterRelease');
    same(s.hooks.afterDeploy, [], 'hooks.afterDeploy');
    expect(s.tests.budget, 'tests.budget').toBe(null);
    expect(s.public, 'public').toBe(null);
    expect(s.site.publish, 'site.publish').toBe(null);
  });

  test('reads the manager block of the kit defaults: rewrite, on, and its three tiers', async () => {
    const s = await view(world({ repo: { enabled: true }, user: { version: 1 } }));
    same(s.manager, { mode: 'rewrite', enabled: true, tiers: { frontier: 'fable', workhorse: 'opus', fast: 'sonnet' } }, 'manager');
  });
});

describe('settings: the machine file, then the repo file', () => {
  test('the machine file sets a key the repo file does not: the machine value', async () => {
    const s = await view(world({ repo: { enabled: true }, user: { findings: { file: true } } }));
    expect(s.findings.file, 'the machine file answers').toBe(true);
  });

  test('both set it: the repo value, false included', async () => {
    const off = await view(world({ repo: { enabled: true, findings: { file: false } }, user: { findings: { file: true } } }));
    expect(off.findings.file, 'a repo false beats a machine true').toBe(false);
    const on = await view(world({ repo: { enabled: true, findings: { file: true } }, user: { findings: { file: false } } }));
    expect(on.findings.file, 'a repo true beats a machine false').toBe(true);
  });

  test('key by key: a nested key from each layer and the default beside them', async () => {
    const s = await view(world({ repo: { enabled: true, site: { url: 'acme.dev' } }, user: { site: { repo: 'acme/home' } } }));
    same([s.site.repo, s.site.url, s.site.publish], ['acme/home', 'acme.dev', null], 'site.repo, site.url, site.publish');
  });

  test('outside any repo: the machine file over the defaults', async () => {
    const s = await view(world({ user: { findings: { file: true } } }), null);
    expect(s.findings.file, 'the machine file answers').toBe(true);
  });

  test('a machine or repo file that does not parse adds nothing, and the layers under it still answer', async () => {
    const repoBroken = await view(world({ repo: '{ "findings": ', user: { findings: { file: true } } }));
    expect(repoBroken.findings.file, 'a broken repo file: the machine file answers').toBe(true);
    const userBroken = await view(world({ repo: { enabled: true, tests: { budget: 4 } }, user: '{ "findings": ' }));
    same([userBroken.tests.budget, userBroken.findings.file], [4, false], 'a broken machine file: the repo file and the defaults answer');
  });

  test('WORKFLOW_HOME moves the machine file', async () => {
    const w = world({ user: { findings: { file: true } }, machine: '/w/moved/settings.json' });
    const moved = await mods('settings').rootSettings(ROOT, { HOME, WORKFLOW_HOME: '/w/moved' }, { read: w.read, pluginRoot: KIT });
    expect(moved.findings.file, 'the file under WORKFLOW_HOME answers').toBe(true);
  });
});

describe('settings: null and arrays', () => {
  test('a null in a higher layer leaves the lower layer\'s value', async () => {
    const s = await view(world({
      repo: { enabled: true, tests: { budget: null }, site: null },
      user: { tests: { budget: 5 }, site: { repo: 'acme/home' }, hooks: { afterRelease: null } },
    }));
    expect(s.tests.budget, 'a repo null leaves the machine budget').toBe(5);
    expect(s.site.repo, 'a repo null object leaves the machine one').toBe('acme/home');
    same(s.hooks.afterRelease, [], 'a machine null leaves the default list');
  });

  test('a higher-layer value whose type differs from an object default is skipped like a null', async () => {
    const s = await view(world({ repo: { enabled: true, identity: 'x' }, user: { manager: 'off' } }));
    same(s.manager, { mode: 'rewrite', enabled: true, tiers: { frontier: 'fable', workhorse: 'opus', fast: 'sonnet' } },
      'a string manager keeps the default block');
    expect(s.identity.tokenUrl, 'a string identity keeps the default tokenUrl').toBe('https://workkit.itwcreativeworks.com/token');
  });

  test('an array in a higher layer replaces the lower one, never appends to it', async () => {
    const s = await view(world({
      repo: { enabled: true, proof: { rootOnly: ['c'] }, hooks: { afterRelease: [{ command: 'two' }] } },
      user: { proof: { rootOnly: ['a', 'b'] }, hooks: { afterRelease: [{ command: 'one' }] } },
    }));
    same(s.proof.rootOnly, ['c'], 'proof.rootOnly');
    same(s.hooks.afterRelease, [{ command: 'two' }], 'hooks.afterRelease');
  });
});

describe('settings: enabled is the repo file\'s alone', () => {
  test('a machine "enabled": true turns no repo on: no repo file, one with no key, and no repo at all read false', async () => {
    const user = { enabled: true };
    expect((await view(world({ user }))).enabled, 'no repo file').toBe(false);
    expect((await view(world({ user, repo: {} }))).enabled, 'a repo file with no enabled key').toBe(false);
    expect((await view(world({ user, repo: { version: 1 } }))).enabled, 'a repo file with only a version').toBe(false);
    expect((await view(world({ user }), null)).enabled, 'no repo').toBe(false);
  });

  test('the repo file\'s own value wins over a machine value either way', async () => {
    expect((await view(world({ repo: { enabled: true }, user: { enabled: false } }))).enabled, 'a repo true').toBe(true);
    expect((await view(world({ repo: { enabled: false }, user: { enabled: true } }))).enabled, 'a repo false').toBe(false);
  });
});

describe('settings: the kit defaults file is required', () => {
  test('a missing or unparsable defaults file is an error naming the file, never a silent fallback', async () => {
    for (const [what, defaults] of [['missing', null], ['unparsable', '{ "enabled": ']]) {
      const err = await caught(() => view(world({ defaults, user: { findings: { file: true } }, repo: { enabled: true } })));
      expect(err instanceof Error, `${what}: the read throws`).toBeTruthy();
      expect(/defaults[\\/]settings\.json/.test(err.message), `${what}: the error names the file, got: ${err.message}`).toBeTruthy();
    }
  });
});

describe('settings: settingsFaults names each value the merge set aside', () => {
  test('case 1: a clean machine file and repo file: no fault', () => {
    same(faults(world({ repo: { enabled: true, site: { url: 'acme.dev' } }, user: { findings: { file: true } } })), [], 'no line');
  });

  test('case 2: a repo proof that is an array: one line naming the repo file and proof', () => {
    same(slashed(faults(world({ repo: { enabled: true, proof: ['backend'] } }))),
      [`${REPO_FILE}: proof is not an object, so the value below it stands`], 'the proof line');
  });

  test('case 3: a repo file that does not parse: one line, the file adds nothing', () => {
    same(slashed(faults(world({ repo: '{ not json' }))), [`${REPO_FILE} is not a JSON object, so it adds nothing`], 'the parse line');
  });

  test('case 4: a machine file that parses to an array is a fault; an empty or blank one is none', () => {
    same(slashed(faults(world({ repo: { enabled: true }, user: '[]' }))),
      [`${USER} is not a JSON object, so it adds nothing`], 'an array');
    for (const user of ['', '  \n']) {
      same(faults(world({ repo: { enabled: true }, user })), [], `the text ${JSON.stringify(user)}`);
    }
  });

  test('case 5: a machine manager that is a string, or a tiers that is, is a fault naming the dotted key; an object or a null is none', () => {
    const line = (key) => `${USER}: ${key} is not an object, so the value below it stands`;
    same(slashed(faults(world({ repo: { enabled: true }, user: { manager: 'off' } }))), [line('manager')], 'a string manager');
    same(slashed(faults(world({ repo: { enabled: true }, user: { manager: { tiers: 'x' } } }))), [line('manager.tiers')], 'a string tiers');
    same(faults(world({ repo: { enabled: true }, user: { manager: { enabled: true }, site: null } })), [], 'an object manager and a null site');
  });

  test('case 6: an async read answers a promise of the same lines', async () => {
    const w = world({ repo: { enabled: true, proof: ['backend'] } });
    const answer = faults(w, async (p) => w.read(p));
    expect(typeof answer.then === 'function', `a promise, got: ${answer}`).toBeTruthy();
    same(slashed(await answer), [`${REPO_FILE}: proof is not an object, so the value below it stands`], 'the proof line');
  });

  test('case 7: each fault is its file, its dotted key (null for a whole file) and its line', () => {
    same(faults(world({ repo: '{ not json', user: { manager: { tiers: 'x' } } })), [
      { file: USER, key: 'manager.tiers', line: `${USER}: manager.tiers is not an object, so the value below it stands` },
      { file: REPO_FILE, key: null, line: `${REPO_FILE} is not a JSON object, so it adds nothing` },
    ], 'the two faults in walk order');
  });

  test('case 8: faultsUnder answers the faults whose key is the prefix or under it, in order', () => {
    const at = (key) => ({ file: USER, key, line: `${key}` });
    const found = [at('proof'), at(null), at('proofing'), at('hooks.afterRelease'), at('proof.rootOnly')];
    same(mods('settings').faultsUnder(found, 'proof'), [at('proof'), at('proof.rootOnly')], 'proof and proof.rootOnly alone');
    same(mods('settings').faultsUnder(found, 'identity'), [], 'none under identity');
  });

  test('case 9: a missing or unparsable defaults file throws the error loadSettings throws', async () => {
    for (const [what, defaults] of [['missing', null], ['unparsable', '{ "enabled": ']]) {
      const w = world({ defaults, repo: { enabled: true } });
      const err = await caught(() => faults(w));
      const viewErr = await caught(() => view(w));
      expect(err instanceof Error, `${what}: settingsFaults throws`).toBeTruthy();
      expect(err.message, `${what}: the same error`).toBe(viewErr.message);
    }
  });
});

describe('settings: the wiring suites\' copy of the defaults', () => {
  test('mod-fixtures.mjs DEFAULTS is defaults/settings.json, value for value', () => {
    const { DEFAULTS } = require('../lib/mod-fixtures.mjs');
    expect(isDeepStrictEqual(DEFAULTS, JSON.parse(fs.readFileSync(KIT_DEFAULTS, 'utf8'))), 'the copy the mod world serves').toBeTruthy();
  });
});

describe('settings: findingsOn and findingsRoute over the merged view', () => {
  test('findingsOn: true only when findings.file reads true, absent reading the default off', async () => {
    const { findingsOn } = mods('settings');
    expect(findingsOn(await view(world({ user: { findings: { file: true } } }))), 'true reads on').toBe(true);
    expect(findingsOn(await view(world({ user: { findings: { file: false } } }))), 'false reads off').toBe(false);
    expect(findingsOn(await view(world({ user: { version: 1 } }))), 'an absent key reads off').toBe(false);
  });

  test('findingsRoute: off and absent both name the chat route, on files a status:inbox issue', async () => {
    const { findingsRoute } = mods('settings');
    for (const user of [{ findings: { file: false } }, { version: 1 }]) {
      const said = findingsRoute(await view(world({ user })));
      expect(said.includes('chat under 🧭 Findings') && said.includes('file or drop'), `the chat route, got: ${said}`).toBeTruthy();
      expect(!said.includes('status:inbox'), `files nothing, got: ${said}`).toBeTruthy();
    }
    const on = findingsRoute(await view(world({ user: { findings: { file: true } } })));
    expect(on.includes('status:inbox'), `and on files a status:inbox issue, got: ${on}`).toBeTruthy();
  });
});

describe('settings: attributionOff over the merged view', () => {
  test('attributionOff: an absent commit.attribution, or a true one, reads false', async () => {
    const { attributionOff } = mods('settings');
    expect(attributionOff(await view(world({ repo: { enabled: true } }))), 'absent').toBe(false);
    expect(attributionOff(await view(world({ repo: { enabled: true, commit: { attribution: true } } }))), 'true').toBe(false);
  });

  test('attributionOff: false in the repo file or the machine file reads true, a repo true winning over a machine false', async () => {
    const { attributionOff } = mods('settings');
    const off = { commit: { attribution: false } };
    expect(attributionOff(await view(world({ repo: { enabled: true, ...off } }))), 'the repo file says false').toBe(true);
    expect(attributionOff(await view(world({ repo: { enabled: true }, user: off }))), 'the machine file says false').toBe(true);
    expect(attributionOff(await view(world({ repo: { enabled: true, commit: { attribution: true } }, user: off }))),
      'the repo true wins').toBe(false);
  });
});

describe('settings: bulletsOn and shapePaths over the merged view', () => {
  test('bulletsOn: the machine file true and no repo value turns the check on, a repo false keeps it off', async () => {
    const { bulletsOn } = mods('settings');
    const user = { docs: { bullets: true } };
    expect(bulletsOn(await view(world({ user, repo: { enabled: true } }))), 'the machine value answers').toBe(true);
    expect(bulletsOn(await view(world({ user, repo: { enabled: true, docs: { bullets: false } } }))), 'the repo false wins').toBe(false);
  });

  test('shapePaths: the kit default is AGENTS.md, README.md and docs/', async () => {
    same(mods('settings').shapePaths(await view(world({ repo: { enabled: true } }))), ['AGENTS.md', 'README.md', 'docs/'], 'the default set');
  });

  test('shapePaths: the machine file sets the set for a repo that sets none, and a repo value wins over it', async () => {
    const { shapePaths } = mods('settings');
    const user = { docs: { paths: ['handbook/'] } };
    same(shapePaths(await view(world({ user, repo: { enabled: true } }))), ['handbook/'], 'the machine set');
    same(shapePaths(await view(world({ user, repo: { enabled: true, docs: { paths: ['./'] } } }))), ['./'], 'the repo set');
  });

  test('shapePaths: a value that is not an array of strings answers null', () => {
    const { shapePaths } = mods('settings');
    for (const paths of ['docs/', ['docs/', 7], { docs: true }]) {
      expect(shapePaths({ docs: { bullets: true, paths } }), `${JSON.stringify(paths)} answers null`).toBe(null);
    }
  });

  test('shapePaths: an entry that can match nothing answers null, and an empty array stands', () => {
    const { shapePaths } = mods('settings');
    for (const paths of [['docs'], ['.'], ['/docs/'], ['docs\\a.md']]) {
      expect(shapePaths({ docs: { bullets: true, paths } }), `${JSON.stringify(paths)} answers null`).toBe(null);
    }
    same(shapePaths({ docs: { bullets: true, paths: [] } }), [], 'an empty set is valid');
  });
});

describe('settings: checkMinutes over the merged view', () => {
  test('checkMinutes: the kit default is 5', async () => {
    expect(mods('settings').checkMinutes(await view(world({ repo: { enabled: true } }))), 'the default check').toBe(5);
  });

  test('checkMinutes: the machine file sets it for a repo that sets none, and a repo value wins over it, a fraction included', async () => {
    const { checkMinutes } = mods('settings');
    const user = { tests: { check: 2 } };
    expect(checkMinutes(await view(world({ user, repo: { enabled: true } }))), 'the machine value').toBe(2);
    expect(checkMinutes(await view(world({ user, repo: { enabled: true, tests: { check: 0.5 } } }))), 'the repo value').toBe(0.5);
  });

  test('checkMinutes: 0, a negative number or a word throws the line naming the key and the value', async () => {
    const { checkMinutes } = mods('settings');
    for (const check of [0, -1, 'five']) {
      const err = await caught(() => checkMinutes({ tests: { check } }));
      expect(err instanceof Error, `${JSON.stringify(check)}: an Error`).toBeTruthy();
      expect(err.message, `${JSON.stringify(check)}: the line`).toBe(`tests.check must be a number of minutes above 0 (got ${JSON.stringify(check)})`);
    }
  });

  test('checkMinutes: 1e999 in the repo file, an infinite number, throws the line naming the key and the value as Infinity', async () => {
    const { checkMinutes } = mods('settings');
    const s = await view(world({ repo: '{ "enabled": true, "tests": { "check": 1e999 } }\n' }));
    const err = await caught(() => checkMinutes(s));
    expect(err instanceof Error, 'an Error').toBeTruthy();
    expect(err.message, 'the line').toBe('tests.check must be a number of minutes above 0 (got Infinity)');
  });
});
