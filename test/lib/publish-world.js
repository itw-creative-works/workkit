// The ship's publish fixtures: a package repo built from package.json objects and
// a fake `npm` that records every argv. Consumers: test/scripts/publish-plan.test.js
// (plan.js and publish.js by path) and test/scripts/workkit-cli/verbs.test.js
// (`workkit ship plan` and `workkit ship publish`).

const path = require('path');
const fs = require('fs');
const { mkTmp } = require('./harness');
const { stubTool } = require('./platform');
const { recordArgv, readArgv } = require('./argv-log');

/**
 * A fixture repo: `root` is the root package.json, `members` maps a relative
 * directory to its package.json.
 */
const mkPackages = ({ root, members = {} } = {}) => {
  const dir = mkTmp('pplan-');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(root));
  for (const [rel, pkg] of Object.entries(members)) {
    fs.mkdirSync(path.join(dir, rel), { recursive: true });
    fs.writeFileSync(path.join(dir, rel, 'package.json'), JSON.stringify(pkg));
  }
  return dir;
};

/**
 * A fake `npm`. `view` answers the version for every `name@version` in `taken`
 * and E404 for everything else, or, with `viewBreaks`, fails some other way so
 * the check stands down. `publish` succeeds unless its `--workspace=` names
 * `failPublish`. Every call is recorded.
 */
const makeNpmStub = ({ taken = [], viewBreaks = false, failPublish = null } = {}) => {
  const dir = mkTmp('pplan-');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  stubTool(bin, 'npm', [
    '#!/usr/bin/env bash',
    recordArgv(path.join(dir, 'npm.log')),
    'if [ "$1" = view ]; then',
    ...(viewBreaks ? ['  echo "npm error code ETIMEDOUT" >&2', '  echo "npm error network timeout" >&2', '  exit 1'] : []),
    '  case "${@: -2:1}" in',
    ...taken.map((t) => `    '${t}') echo "${t.slice(t.lastIndexOf('@') + 1)}"; exit 0 ;;`),
    '  esac',
    '  echo "npm error code E404" >&2',
    '  exit 1',
    'fi',
    ...(failPublish ? [`case " $* " in *" --workspace=${failPublish} "*) echo "npm error code E403" >&2; exit 1 ;; esac`] : []),
    'exit 0',
  ]);
  return { binDir: bin, dir, calls: () => readArgv(path.join(dir, 'npm.log')) };
};

/** The registry question the run asks, argv for argv. */
const view = (spec) => ['view', '--no-update-notifier', '--fetch-retries=0', '--fetch-timeout=15000', spec, 'version'];

// A public workspace: explicitly not private, and a `files` publish signal.
const pub = (name, version = '0.5.0', extra = {}) => ({ name, version, private: false, files: ['dist'], ...extra });

// The spec's fixture: a private root, three public workspaces pinned in a chain
// (c needs b, b needs a), one private workspace, one with no publish signal.
const SPEC_FIXTURE = () => mkPackages({
  root: { name: 'family', version: '0.5.0', private: true, workspaces: ['packages/*'] },
  members: {
    'packages/c': pub('@s/c', '0.5.0', { dependencies: { '@s/b': '0.5.0' } }),
    'packages/b': pub('@s/b', '0.5.0', { dependencies: { '@s/a': '0.5.0' } }),
    'packages/a': pub('@s/a'),
    'packages/secret': { name: '@s/secret', version: '0.5.0', private: true, files: ['dist'] },
    'packages/app': { name: '@s/app', version: '0.5.0', private: false },
  },
});

module.exports = {
  mkPackages, makeNpmStub, view, pub, SPEC_FIXTURE,
};
