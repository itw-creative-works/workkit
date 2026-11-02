// Tests for workflow/ship/deploy.js (`workkit ship deploy`): a real `npm run`
// of the fixture repo's deploy (or release) script from the repo root, then the
// repo's afterDeploy hooks. Each script runs mark.js, which appends its name to
// the order file the hooks append to, so what ran and in which order is read back.

const {
  group, test, assert, assertEq, summary, selfRun,
} = require('../lib/harness');
const {
  enabledWith, mkShipRepo, runShip, lines,
} = require('../lib/ship-world');

// Appends its first argument to the order file, prints that it did, exits its second.
const MARK = [
  "const fs = require('fs');",
  'fs.appendFileSync(process.env.SHIP_ORDER, `${process.argv[2]}\\n`);',
  'console.log(`marked ${process.argv[2]}`);',
  'process.exit(Number(process.argv[3] || 0));',
].join('\n');

/**
 * A repo whose package.json declares `scripts` (name to mark.js arguments) and
 * whose committed settings declare the afterDeploy hooks `hooksOf(g)`, one
 * noting `hook` by default.
 */
const mkDeployRepo = (scripts, hooksOf = (g) => [g.note('hook')]) => {
  const pkg = { name: 'fixture', private: true, scripts: Object.fromEntries(Object.entries(scripts).map(([name, args]) => [name, `node mark.js ${args}`])) };
  const g = mkShipRepo({ 'package.json': `${JSON.stringify(pkg)}\n`, 'mark.js': `${MARK}\n` });
  g.write('.workkit/settings.json', enabledWith({ afterDeploy: hooksOf(g) }));
  g.git('add', '-A');
  g.git('commit', '-q', '-m', 'hooks');
  g.env.SHIP_ORDER = g.orderPath;
  return g;
};

const cases = async () => {
  group('ship deploy: which script');

  await test('scripts.deploy wins over scripts.release: deploy runs, its output passed through, then the hooks; exit 0', () => {
    const g = mkDeployRepo({ deploy: 'deploy', release: 'release' });
    const { code, out, err } = runShip(g, 'deploy');
    assertEq(code, 0, `exit 0, got: ${out}${err}`);
    assert(lines(out).includes('marked deploy'), `the script's stdout reaches stdout, got: ${out}`);
    assertEq(g.order(), 'deploy\nhook\n', 'the deploy script alone, then the afterDeploy hook');
  });

  await test('from a subfolder: the root package.json\'s deploy runs at the root, then the hooks; exit 0', () => {
    const g = mkDeployRepo({ deploy: 'deploy' });
    const { code, out, err } = runShip(g, 'deploy', [], { cwd: g.sub });
    assertEq(code, 0, `exit 0, got: ${out}${err}`);
    assertEq(g.order(), 'deploy\nhook\n', 'the root\'s deploy script, then the afterDeploy hook');
  });

  await test('only scripts.release: release runs, then the hooks; exit 0', () => {
    const g = mkDeployRepo({ release: 'release' });
    const { code, out, err } = runShip(g, 'deploy');
    assertEq(code, 0, `exit 0, got: ${out}${err}`);
    assertEq(g.order(), 'release\nhook\n', 'the release script, then the afterDeploy hook');
  });

  await test('neither script: its line, exit 0, no hook', () => {
    const g = mkDeployRepo({ test: 'test' });
    const { code, out, err } = runShip(g, 'deploy');
    assertEq(code, 0, `exit 0, got: ${out}${err}`);
    assert(lines(err).includes('ship-deploy: no deploy or release script'), `the no-script line, got: ${err}`);
    assertEq(g.order(), null, 'no script and no hook ran');
  });

  group('ship deploy: failures');

  await test('the script failing: its exit line, exit 1, no hook', () => {
    const g = mkDeployRepo({ deploy: 'deploy 3' });
    const { code, out, err } = runShip(g, 'deploy');
    assertEq(code, 1, `exit 1, got: ${out}${err}`);
    assert(lines(err).includes('ship-deploy: npm run deploy exited 3'), `the failure line, got: ${err}`);
    assertEq(g.order(), 'deploy\n', 'the script ran, no hook after it');
  });

  await test('the deploy passing and an afterDeploy hook failing: its line, exit 1, the later hooks never run', () => {
    const g = mkDeployRepo({ deploy: 'deploy' }, (w) => ['exit 4', w.note('later')]);
    const { code, out, err } = runShip(g, 'deploy');
    assertEq(code, 1, `exit 1, got: ${out}${err}`);
    assert(lines(err).includes('ship-deploy: the deploy ran; an afterDeploy hook failed'), `the deployed-but line, got: ${err}`);
    assertEq(g.order(), 'deploy\n', 'the deploy ran, the hook after the failure did not');
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
