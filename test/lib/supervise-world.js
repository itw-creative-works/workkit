/**
 * The world the `workkit supervise` and `workkit watch` suites share: a scratch
 * repo that ignores `.workkit/` on a scratch machine, the fake commands beyond
 * ./supervise.js's, and the one command called the way the workkit-cli suites do.
 * Consumers: test/scripts/supervise.test.js and watch.test.js.
 */

const fs = require('fs');
const path = require('path');
const {
  mkTmp, seeded, run, start,
} = require('./harness');
const {
  BASH, NO_RC, NODE_DIR, SYSTEM_PATH, shellPath, joinPath, homeEnv,
} = require('./platform');
const { checkSettings, jsPath, writesPid } = require('./supervise');

const CLI = path.join(__dirname, '..', '..', 'workflow', 'workkit.sh');

// A check far longer than any case, so only the case ends the run.
const LONG_CHECK = 10;

const write = (file, body) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};

// A committed repo per shape, built once: a `.gitignore` that ignores `.workkit/`,
// the opt-in setting the check to <check> minutes, and <files> by relative path.
const seedRepo = seeded((seed, { check, files }) => {
  const repo = path.join(seed, 'repo');
  write(path.join(repo, '.gitignore'), '.workkit/*\n');
  write(path.join(repo, '.workkit', 'settings.json'), checkSettings(check, true));
  for (const [rel, body] of Object.entries(files)) write(path.join(repo, rel), body);
  const env = homeEnv(mkTmp('supervise-git-home-'), { PATH: process.env.PATH });
  for (const args of [['init', '-q'], ['config', 'user.email', 'test@example.com'], ['config', 'user.name', 'Test'],
    ['add', '-A'], ['commit', '-q', '-m', 'seed']]) {
    const res = run('git', args, { cwd: repo, env });
    if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
  }
});

/**
 * A scratch machine (its own home, TMPDIR and workflow home, node on PATH) and a
 * copy of the seeded repo checking every <check> minutes, holding <files>.
 * @returns {{dir: string, repo: string, out: string, workflowHome: string, env: object}}
 */
const mkWorld = ({ check = LONG_CHECK, files = {} } = {}) => {
  const dir = mkTmp('supervise-world-');
  seedRepo(dir, { check, files });
  const home = path.join(dir, 'home');
  const tmp = path.join(dir, 'tmp');
  const out = path.join(dir, 'out');
  for (const d of [home, tmp, out]) fs.mkdirSync(d, { recursive: true });
  const workflowHome = path.join(home, '.workkit');
  return {
    dir,
    repo: path.join(dir, 'repo'),
    out,
    workflowHome,
    env: homeEnv(home, {
      TMPDIR: shellPath(tmp),
      WORKFLOW_HOME: shellPath(workflowHome),
      PATH: joinPath(NODE_DIR, SYSTEM_PATH),
    }),
  };
};

const runLog = (world) => path.join(world.repo, '.workkit', 'run.log');
const suiteLog = (world) => path.join(world.repo, '.workkit', 'suite.log');

/** `workkit <args>` started and not waited on; its own group, so `end` reaches all it started in its session. */
const workkitStart = (args, { cwd, env }) => start(BASH, [...NO_RC, shellPath(CLI), ...args],
  { cwd, env, input: '', detached: true });

/** `workkit <args>` run to its end: its code, and its output in the order it was written. */
const workkit = async (args, opts) => {
  const call = workkitStart(args, opts);
  try {
    const { status } = await call.done;
    return { code: status, output: call.output().replace(/\r/g, '') };
  } finally {
    await call.end('SIGKILL');
  }
};

const linesOf = (text) => text.replace(/\r/g, '').replace(/\n$/, '').split('\n');

// The fake commands beyond ./supervise.js's, each a `node -e` script.
const touches = (file) => `require('fs').writeFileSync(${jsPath(file)}, '');`;
const prints = (code, { out, err }) => `console.log(${JSON.stringify(out)}); console.error(${JSON.stringify(err)}); process.exit(${code});`;

/** Prints <lines>, then once <go> exists prints <after> and exits <code>. */
const waitsFor = (pidFile, go, { lines, after = '', code }) => [
  writesPid(pidFile),
  ...lines.map((line) => `console.log(${JSON.stringify(line)});`),
  `setInterval(() => { if (require('fs').existsSync(${jsPath(go)})) { console.log(${JSON.stringify(after)}); process.exit(${code}); } }, 50);`,
].join('\n');

module.exports = {
  LONG_CHECK, mkWorld, runLog, suiteLog, workkitStart, workkit, linesOf, touches, prints, waitsFor,
};
