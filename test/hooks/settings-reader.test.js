// Tests for the layered settings read in hooks/mods/settings.js, over plain
// facts: settingsLayers(cwd, env, { top, read }) reads the repo's
// .workkit/settings.json at the folder's git root and the machine's file, and
// settingGet(path, repo, user) answers the repo file's value when it has the key,
// else the machine file's, else nothing; a literal false is a value. Then the two
// findings.file readers built on it, findingsOn and findingsRoute. Ports the cases
// of the shell reader's suite this module replaced.

const {
  group, test, assert, assertEq, selfRun, summary,
} = require('../lib/harness');
const { mods } = require('../lib/mods-inputs');

const settings = () => mods('settings');

const HOME = '/w/home';
const ROOT = '/w/repo';
const CWD = `${ROOT}/src`;

// One world: `repo` and `user` the two files' bodies (a string as written, an
// object as JSON, undefined for no file), `git` false for a folder in no repo.
const world = ({ repo, user, git = true, env = { HOME } }) => {
  const machine = env.WORKFLOW_HOME || `${env.HOME}/.workkit`;
  const files = {};
  const put = (p, body) => { if (body !== undefined) files[p] = typeof body === 'string' ? body : JSON.stringify(body); };
  put(`${machine}/settings.json`, user);
  // Outside a repo the folder's own settings file is still there, for a reader to wrongly take.
  put(git ? `${ROOT}/.workkit/settings.json` : `${CWD}/.workkit/settings.json`, repo);
  const io = {
    top: async (dir) => (git && dir.startsWith(ROOT) ? ROOT : null),
    read: async (p) => files[p] ?? null,
  };
  return { env, io };
};

// The read as a hook takes it: the two layers for CWD, then one key across them.
const ask = async (w, key = 'findings.file') => {
  const { settingsLayers, settingGet } = settings();
  return settingGet(key, ...(await settingsLayers(CWD, w.env, w.io)));
};

const cases = async () => {
  group('settingsLayers and settingGet: the repo file over the machine file');

  await test('ports "no key in either file: prints nothing"', async () => {
    assertEq(await ask(world({ repo: { version: 1, enabled: true }, user: { version: 1 } })), undefined,
      'an absent key is no answer');
  });

  await test('ports "true in the global file and no repo key: prints true"', async () => {
    assertEq(await ask(world({ repo: { version: 1, enabled: true }, user: { findings: { file: true } } })), true,
      'the machine file answers');
  });

  await test('ports "false globally and true in the repo file: prints true"', async () => {
    const w = world({ repo: { version: 1, enabled: true, findings: { file: true } }, user: { findings: { file: false } } });
    assertEq(await ask(w), true, 'the repo file wins');
  });

  await test('ports "true globally and false in the repo file: prints false"', async () => {
    // A literal false is a value, never "absent": falling through to the
    // machine file here would turn the repo's override off.
    const w = world({ repo: { version: 1, enabled: true, findings: { file: false } }, user: { findings: { file: true } } });
    assertEq(await ask(w), false, 'the repo file wins with false');
  });

  await test('ports "outside any git repo: the global file alone"', async () => {
    // The folder carries a settings file of its own, so a reader that took it
    // as the repo layer would answer false.
    const w = world({ repo: { findings: { file: false } }, user: { findings: { file: true } }, git: false });
    assertEq(await ask(w), true, 'a folder that is no repo is no repo layer');
    assertEq((await settings().settingsLayers(CWD, w.env, w.io))[0], null, 'and the repo layer is null');
  });

  await test('the machine file is the one WORKFLOW_HOME names, and a file that does not parse adds nothing', async () => {
    const moved = world({ user: { findings: { file: true } }, env: { HOME, WORKFLOW_HOME: '/w/moved' } });
    assertEq(await ask(moved), true, 'WORKFLOW_HOME moves the machine file');
    const broken = world({ repo: '{ "findings": ', user: { findings: { file: true } } });
    assertEq(await ask(broken), true, 'an unreadable repo file falls through to the machine file');
  });

  group('findingsOn and findingsRoute: the findings.file readers');

  const layers = async (w) => settings().settingsLayers(CWD, w.env, w.io);

  await test('ports "hook_findings_on: true only when the setting reads true"', async () => {
    const { findingsOn } = settings();
    assertEq(findingsOn(...(await layers(world({ user: { findings: { file: true } } })))), true, 'true reads on');
    assertEq(findingsOn(...(await layers(world({ user: { findings: { file: false } } })))), false, 'false reads off');
    assertEq(findingsOn(...(await layers(world({ user: { version: 1 } })))), false, 'an absent key reads off');
  });

  await test('ports "hook_findings_route: off and absent both print the chat route"', async () => {
    const { findingsRoute } = settings();
    for (const user of [{ findings: { file: false } }, { version: 1 }]) {
      const said = findingsRoute(...(await layers(world({ user }))));
      assert(said.includes('chat under 🧭 Findings') && said.includes('file or drop'), `the chat route, got: ${said}`);
      assert(!said.includes('status:inbox'), `files nothing, got: ${said}`);
    }
    const on = findingsRoute(...(await layers(world({ user: { findings: { file: true } } }))));
    assert(on.includes('status:inbox'), `and on files a status:inbox issue, got: ${on}`);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
