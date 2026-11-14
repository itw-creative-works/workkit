// The ship commands' world: a committed repo whose `.workkit/settings.json`
// turns workkit on and declares hooks, and `node workflow/ship/<name>.js` run
// under a scratch home with only node and the system tools on PATH. Consumers:
// test/scripts/ship-cut.test.js and test/scripts/ship-deploy.test.js;
// test/scripts/ship-hooks.test.js and publish-plan.test.js its `enabledWith`,
// ship-hooks its `lines`.

const fs = require('fs');
const path = require('path');
const { expect, SPAWN_DEADLINE } = require('./harness');
const {
  NODE_DIR, SYSTEM_PATH, joinPath, shellPath, spawnSync,
} = require('./platform');
const { mkRepo } = require('./git-repo');

const SHIP = path.join(__dirname, '..', '..', 'workflow', 'ship');

/** The settings text turning workkit on, `hooks` mapping an event to its commands. */
const enabledWith = (hooks = {}) => `${JSON.stringify({
  enabled: true,
  hooks: Object.fromEntries(Object.entries(hooks).map(([event, commands]) => [event, commands.map((command) => ({ command }))])),
})}\n`;

/**
 * A committed repo holding `files` (settings included, when given) and an
 * empty-but-tracked `sub/` folder. `orderPath` is a file outside the repo every
 * actor appends its name to; `note(name)` is the bash that appends it, and
 * `order()` reads the file back, null when nothing wrote it.
 */
const mkShipRepo = (files) => {
  const g = mkRepo('ship-world-', { 'sub/.keep': '', ...files });
  const orderFile = path.join(g.dir, 'order.txt');
  return {
    ...g,
    sub: path.join(g.repo, 'sub'),
    orderPath: orderFile,
    note: (name) => `echo ${name} >> "${shellPath(orderFile)}"`,
    order: () => (fs.existsSync(orderFile) ? fs.readFileSync(orderFile, 'utf8') : null),
  };
};

/**
 * `node workflow/ship/<name>.js <args>` from `cwd` under the repo's scratch
 * home, PATH being `binDirs`, node (npm beside it) and the system tools.
 */
const runShip = (g, name, args = [], { cwd = g.repo, binDirs = [] } = {}) => {
  const res = spawnSync(process.execPath, [path.join(SHIP, `${name}.js`), ...args], {
    cwd,
    env: {
      ...g.env,
      PATH: joinPath(...binDirs, NODE_DIR, SYSTEM_PATH),
      NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    },
    input: '',
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  expect(res.status !== null, `ship ${name} finished (no timeout, no signal): ${res.error || ''}`).toBeTruthy();
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

const lines = (text) => text.split('\n').filter(Boolean);

module.exports = {
  enabledWith, mkShipRepo, runShip, lines,
};
