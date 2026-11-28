// Tests for the central dashboard's deploy (.github/workflows/pages.yml): built
// from tower/app by workflow/publish/build.js and deployed to this repo's own
// Pages. The shape is read off the lines, since the kit has no YAML dependency;
// the build steps' run: lines are also run, against a scratch checkout.

const path = require('path');
const fs = require('fs');
const {
  describe, test, expect, mkTmp,
} = require('../lib/harness');
const {
  SYSTEM_PATH, NODE_DIR, NO_RC, shellPath, homeEnv, joinPath, samePath, spawnBash, stubToolJs,
} = require('../lib/platform');
const {
  indentOf, isComment, isContent, childrenOf, runLines,
} = require('../lib/workflow-yaml');
const {
  recordArgvJs, readArgv, eqArgv, fmtCalls,
} = require('../lib/argv-log');
const { copyEngine } = require('./publish/helpers');

const ROOT = path.join(__dirname, '..', '..');
const PAGES = path.join(ROOT, '.github', 'workflows', 'pages.yml');

const text = () => fs.readFileSync(PAGES, 'utf8');
const lines = () => text().split('\n');

// The direct children of a block, as `key: value` with the indent dropped.
const entriesOf = (block) => {
  const real = block.filter(isContent);
  if (!real.length) return [];
  const depth = indentOf(real[0]);
  return real.filter((l) => indentOf(l) === depth).map((l) => l.trim());
};

const topLevel = (all, key) => all.indexOf(`${key}:`);

// Every line a step's shell runs, as its text.
const shellLines = () => runLines(text()).map((run) => run.text);

describe('pages.yml: when it runs and what it may touch', () => {
  test('it runs on a published release and on a manual dispatch, nothing else, with no tabs', () => {
    expect(fs.existsSync(PAGES), '.github/workflows/pages.yml exists').toBeTruthy();
    const all = lines();
    expect(!all.some((l) => l.includes('\t')), 'no tab characters, which YAML rejects').toBeTruthy();
    const on = topLevel(all, 'on');
    expect(on !== -1, 'a top-level on: key').toBeTruthy();
    const triggers = entriesOf(childrenOf(all, on)).map((e) => e.replace(/:.*$/, ''));
    expect(triggers.sort().join(','), 'the two triggers').toBe('release,workflow_dispatch');
    const release = all.findIndex((l, i) => i > on && /^\s+release:\s*$/.test(l));
    expect(entriesOf(childrenOf(all, release)).join(','), 'a release only once it is published').toBe('types: [published]');
  });

  test('its permissions are contents read, pages write and id-token write', () => {
    const all = lines();
    const blocks = all.map((l, i) => (/^\s*permissions:\s*$/.test(l) ? i : -1)).filter((i) => i !== -1);
    expect(blocks.length, 'one permissions: block').toBe(1);
    expect(entriesOf(childrenOf(all, blocks[0])).sort().join(','), 'exactly the three a Pages deploy needs').toBe('contents: read,id-token: write,pages: write');
  });

  test('one concurrency group, which never cancels a deploy in flight', () => {
    const all = lines();
    const at = all.map((l, i) => (/^\s*concurrency:/.test(l) && !isComment(l) ? i : -1)).filter((i) => i !== -1);
    expect(at.length, 'one concurrency: key').toBe(1);
    // A bare `concurrency: <group>` cancels nothing; a block says so itself.
    if (/^\s*concurrency:\s*\S/.test(all[at[0]])) return;
    const block = entriesOf(childrenOf(all, at[0]));
    expect(block.some((e) => /^group: \S/.test(e)), `the key names a group, got: ${block.join(', ')}`).toBeTruthy();
    const cancel = block.filter((e) => /^cancel-in-progress:/.test(e));
    expect(cancel.every((e) => e === 'cancel-in-progress: false'), `a run in flight is never cancelled, got: ${cancel}`).toBeTruthy();
  });
});

describe('pages.yml: the build steps', () => {
  test('each of its three run: lines reaches the stand-in with the arguments the build gives it', () => {
    // A scratch checkout: the engine copied as the publish suites copy it, and a
    // project at tower/app whose omega stub records its calls, as npm's does.
    const root = mkTmp('workkit-pages-');
    const checkout = path.join(root, 'checkout');
    const app = path.join(checkout, 'tower', 'app');
    copyEngine(checkout);
    fs.mkdirSync(path.join(app, 'targets', 'web'), { recursive: true });
    // Each call records the tool, its working folder and OMEGA_PATH_PREFIX, then its arguments.
    const log = path.join(root, 'calls.log');
    const record = (who) => [
      "const fs = require('fs');",
      "const path = require('path');",
      'const argv = process.argv.slice(2);',
      recordArgvJs(JSON.stringify(log), `[${JSON.stringify(who)}, process.cwd(), process.env.OMEGA_PATH_PREFIX || 'unset', ...argv]`),
    ];
    const bin = path.join(root, 'bin');
    const appBin = path.join(app, 'node_modules', '.bin');
    for (const dir of [bin, appBin]) fs.mkdirSync(dir, { recursive: true });
    stubToolJs(bin, 'npm', [...record('npm'),
      "if (argv[0] === '--prefix') fs.mkdirSync(path.resolve(argv[1], 'dist'), { recursive: true });"].join('\n'));
    stubToolJs(appBin, 'omega', [...record('omega'),
      "fs.mkdirSync(path.join(process.cwd(), '.omega', 'assets', 'logo'), { recursive: true });"].join('\n'));
    // pages.yml runs on Linux, where `/workkit/` reaches node as written; Git Bash
    // would rewrite that argument as a path for the native node, so none is rewritten.
    const env = homeEnv(path.join(root, 'home'), {
      PATH: joinPath(bin, SYSTEM_PATH, NODE_DIR),
      WORKFLOW_HOME: shellPath(path.join(root, 'home', '.workkit')),
      MSYS2_ARG_CONV_EXCL: '*',
    });

    const commands = shellLines();
    expect(commands.length, `three run: lines, got: ${commands.join(' | ')}`).toBe(3);
    for (const command of commands) {
      const res = spawnBash([...NO_RC, '-c', command], { cwd: checkout, env, encoding: 'utf8' });
      expect(res.status, `${command} exits 0: ${res.stdout}${res.stderr}`).toBe(0);
    }

    const calls = readArgv(log);
    expect(calls.length, `three calls: ${fmtCalls(calls)}`).toBe(3);
    const [install, mint, built] = calls;
    const toolAndArgs = ([who, , , ...args]) => [who, ...args];
    expect(toolAndArgs(install), 'the install is npm install').toEqual(['npm', 'install']);
    expect(toolAndArgs(mint), 'the mint is the project\'s omega').toEqual(['omega', 'manage', '--service=assets']);
    expect([install, mint].every(([, cwd]) => samePath(cwd, app, process.platform)), `both run in tower/app: ${fmtCalls(calls)}`).toBeTruthy();
    const [who, , prefix, ...words] = built;
    expect(who === 'npm' && words.length === 4 && words[0] === '--prefix' && eqArgv(words.slice(2), ['run', 'build']),
      `the build is the web target's build script: ${fmtCalls([built])}`).toBeTruthy();
    const target = path.isAbsolute(words[1]) ? words[1] : path.join(checkout, words[1]);
    expect(samePath(target, path.join(app, 'targets', 'web'), process.platform), `in tower/app's web target: ${fmtCalls([built])}`).toBeTruthy();
    expect(prefix, 'told the prefix the central copy serves at').toBe('/workkit/');
  });
});

describe('pages.yml: the deploy', () => {
  test('no run: line writes a home.json, a repos.json or a CNAME', () => {
    const named = shellLines().filter((l) => /home\.json|repos\.json|CNAME/.test(l));
    expect(named.join('\n'), 'the central copy carries no home pointer, no repo list and no domain').toBe('');
  });
});
