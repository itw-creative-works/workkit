// The ship's publish fixtures: a package repo built from package.json objects,
// loose or committed, and a fake `npm` that records every argv and the folder it
// ran in. Consumers: test/scripts/publish-plan.test.js (plan.js and publish.js by
// path) and test/scripts/workkit-cli/verbs.test.js (`workkit ship plan` and
// `workkit ship publish`).

const path = require('path');
const fs = require('fs');
const { mkTmp } = require('./harness');
const { stubToolJs } = require('./platform');
const { recordArgvJs, readArgv } = require('./argv-log');
const { mkRepo } = require('./git-repo');

/** The files of a package repo: `root` the root package.json, `members` a relative directory to its package.json. */
const packageFiles = ({ root, members = {} }) => ({
  'package.json': JSON.stringify(root),
  ...Object.fromEntries(Object.entries(members).map(([rel, pkg]) => [`${rel}/package.json`, JSON.stringify(pkg)])),
});

/** A fixture package repo in a scratch folder outside any git repo. */
const mkPackages = (spec = {}) => {
  const dir = mkTmp('pplan-');
  for (const [rel, body] of Object.entries(packageFiles(spec))) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
};

/**
 * The same package repo as a real git repo (`mkRepo`): its files and `extra`
 * (root-relative path to text) in one commit, under a scratch home, so a
 * publish's copy lands in that home's proof folder.
 */
const mkPackagesRepo = (spec, extra = {}) => {
  const w = mkRepo('pplan-', { ...packageFiles(spec), ...extra });
  // Git for Windows' system config turns autocrlf on and the scratch home hides CI's global off,
  // so a publish's copy reads back HEAD's \n on every platform.
  w.git('config', 'core.autocrlf', 'false');
  return w;
};

// The stand-in's program: `cfg` is its options as JSON, `log` the argv log.
const NPM_SOURCE = (cfg, log) => `const fs = require('fs');
const path = require('path');
const cfg = ${JSON.stringify(cfg)};
const argv = process.argv.slice(2);
${recordArgvJs(JSON.stringify(log), 'argv')}
const text = {};
for (const rel of cfg.read) {
  const file = path.join(process.cwd(), rel);
  text[rel] = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}
fs.appendFileSync(cfg.runs, JSON.stringify({ argv, cwd: process.cwd(), text }) + '\\n');
const end = (code, out, err) => {
  if (out) fs.writeSync(1, out);
  if (err) fs.writeSync(2, err);
  process.exit(code);
};
if (argv[0] === 'view') {
  if (cfg.viewBreaks) end(1, '', 'npm error code ETIMEDOUT\\nnpm error network timeout\\n');
  const spec = argv[argv.length - 2];
  if (cfg.taken.includes(spec)) end(0, spec.slice(spec.lastIndexOf('@') + 1) + '\\n', '');
  end(1, '', 'npm error code E404\\n');
}
if (cfg.failPublish !== null && argv.includes('--workspace=' + cfg.failPublish)) end(1, '', 'npm error code E403\\n');
end(0, '', '');
`;

/**
 * A fake `npm`, a Node stand-in. `view` answers the version for every
 * `name@version` in `taken` and E404 for everything else, or, with
 * `viewBreaks`, fails some other way so the check stands down. `publish`
 * succeeds unless its `--workspace=` names `failPublish`. Every call is
 * recorded: `calls()` its argv, `runs()` its argv, the folder it ran in and the
 * text of each `read` path there (null when absent).
 */
const makeNpmStub = ({
  taken = [], viewBreaks = false, failPublish = null, read = [],
} = {}) => {
  const dir = mkTmp('pplan-');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const log = path.join(dir, 'npm.log');
  const runs = path.join(dir, 'npm-runs.jsonl');
  stubToolJs(bin, 'npm', NPM_SOURCE({
    taken, viewBreaks, failPublish, read, runs,
  }, log));
  return {
    binDir: bin,
    dir,
    calls: () => readArgv(log),
    runs: () => (fs.existsSync(runs) ? fs.readFileSync(runs, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []),
  };
};

/** The registry question the run asks, argv for argv. */
const view = (spec) => ['view', '--no-update-notifier', '--fetch-retries=0', '--fetch-timeout=15000', spec, 'version'];

// A public workspace: explicitly not private, and a `files` publish signal.
const pub = (name, version = '0.5.0', extra = {}) => ({ name, version, private: false, files: ['dist'], ...extra });

// The spec's fixture: a private root, three public workspaces pinned in a chain
// (c needs b, b needs a), one private workspace, one with no publish signal.
const SPEC = {
  root: { name: 'family', version: '0.5.0', private: true, workspaces: ['packages/*'] },
  members: {
    'packages/c': pub('@s/c', '0.5.0', { dependencies: { '@s/b': '0.5.0' } }),
    'packages/b': pub('@s/b', '0.5.0', { dependencies: { '@s/a': '0.5.0' } }),
    'packages/a': pub('@s/a'),
    'packages/secret': { name: '@s/secret', version: '0.5.0', private: true, files: ['dist'] },
    'packages/app': { name: '@s/app', version: '0.5.0', private: false },
  },
};
const SPEC_FIXTURE = () => mkPackages(SPEC);

module.exports = {
  mkPackages, mkPackagesRepo, makeNpmStub, view, pub, SPEC, SPEC_FIXTURE,
};
