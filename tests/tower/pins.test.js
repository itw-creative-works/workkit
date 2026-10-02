//
// Tests for the tower app's two framework pins: each names an exact npm version,
// so `npm install` resolves on a machine with no omega checkout beside this one.
// A local-era tree (`omega i local`) fails here until `omega i live` restores them.
//

const fs = require('fs');
const path = require('path');
const { group, test, assert, summary, selfRun } = require('../lib/harness');

const app = path.join(__dirname, '..', '..', 'tower', 'app');
const EXACT = /^\d+\.\d+\.\d+$/;

// Each package and the manifest that declares it, as the app is laid out.
const PINS = [
  { name: '@omega.js/manager', manifest: path.join(app, 'package.json') },
  { name: '@omega.js/web', manifest: path.join(app, 'targets', 'web', 'package.json') },
];

const specOf = (manifest, name) => {
  const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  return { ...pkg.dependencies, ...pkg.devDependencies }[name];
};

const run = async () => {
  group('tower/pins: the framework packages come from npm');

  for (const { name, manifest } of PINS) {
    const rel = path.relative(path.join(app, '..', '..'), manifest);
    await test(`${name} in ${rel} pins an exact registry version`, () => {
      const spec = specOf(manifest, name);
      assert(spec !== undefined, `${rel} declares ${name}`);
      assert(
        EXACT.test(spec),
        `${name} in ${rel} is "${spec}", not an exact npm version; run \`omega i live\` at tower/app before committing`,
      );
    });
  }

  await test('both packages pin the same version: the omega family ships in lockstep', () => {
    const [manager, web] = PINS.map(({ name, manifest }) => specOf(manifest, name));
    assert(manager === web, `@omega.js/manager is "${manager}" and @omega.js/web is "${web}"; run \`omega i live\` at tower/app`);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
