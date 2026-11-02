#!/usr/bin/env node
// The ship's deploy: the root package.json's `deploy` script, else its
// `release` script, then the repo's afterDeploy hooks (hooks.js). It never asks:
// the owner's yes is the ship skill's. Every line of its own is `ship-deploy:` on stderr.
//
// Run from inside the repo:
//   workkit ship deploy

const fs = require('fs');
const path = require('path');
const { repoRoot } = require('../lib/git');
const { spawnNpm } = require('./plan');
const { runHooks } = require('./hooks');
const { sayAs, endOf } = require('../lib/say');

const say = sayAs('ship-deploy');

/**
 * The script the deploy runs: `deploy` when the root package.json has one,
 * else `release`; null for neither, or no package.json.
 * @throws {SyntaxError} when package.json does not parse
 */
const scriptOf = (root) => {
  const file = path.join(root, 'package.json');
  if (!fs.existsSync(file)) return null;
  const scripts = JSON.parse(fs.readFileSync(file, 'utf8'))?.scripts ?? {};
  if (scripts.deploy !== undefined) return 'deploy';
  if (scripts.release !== undefined) return 'release';
  return null;
};

const main = (argv) => {
  if (argv.length !== 0) {
    say('usage: workkit ship deploy');
    return 2;
  }
  const root = repoRoot(process.cwd());
  if (root === null) {
    say(`${process.cwd()} is not inside a git repo, so nothing was deployed`);
    return 1;
  }

  let name;
  try {
    name = scriptOf(root);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    say('package.json does not parse as JSON, so nothing was deployed');
    return 1;
  }
  if (name === null) {
    say('no deploy or release script');
    return 0;
  }

  const res = spawnNpm(['run', name], { cwd: root, stdio: 'inherit' });
  if (res.status !== 0) {
    say(`npm run ${name} ${endOf(res)}`);
    return 1;
  }

  if (runHooks(root, 'afterDeploy') === 0) return 0;
  say('the deploy ran; an afterDeploy hook failed');
  return 1;
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
