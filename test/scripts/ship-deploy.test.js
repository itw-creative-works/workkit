// Tests for workflow/ship/deploy.js (`workkit ship deploy`): a real `npm run`
// of the fixture repo's deploy (or release) script from the repo root, then the
// repo's afterDeploy hooks. Each script runs mark.js, which appends its name to
// the order file the hooks append to, so what ran and in which order is read back.

const {
  describe, test, expect,
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

describe('ship deploy: which script', () => {
  test('scripts.deploy wins over scripts.release: deploy runs, its output passed through, then the hooks; exit 0', () => {
    const g = mkDeployRepo({ deploy: 'deploy', release: 'release' });
    const { code, out, err } = runShip(g, 'deploy');
    expect(code, `exit 0, got: ${out}${err}`).toBe(0);
    expect(lines(out).includes('marked deploy'), `the script's stdout reaches stdout, got: ${out}`).toBeTruthy();
    expect(g.order(), 'the deploy script alone, then the afterDeploy hook').toBe('deploy\nhook\n');
  });

  test('from a subfolder: the root package.json\'s deploy runs at the root, then the hooks; exit 0', () => {
    const g = mkDeployRepo({ deploy: 'deploy' });
    const { code, out, err } = runShip(g, 'deploy', [], { cwd: g.sub });
    expect(code, `exit 0, got: ${out}${err}`).toBe(0);
    expect(g.order(), 'the root\'s deploy script, then the afterDeploy hook').toBe('deploy\nhook\n');
  });

  test('only scripts.release: release runs, then the hooks; exit 0', () => {
    const g = mkDeployRepo({ release: 'release' });
    const { code, out, err } = runShip(g, 'deploy');
    expect(code, `exit 0, got: ${out}${err}`).toBe(0);
    expect(g.order(), 'the release script, then the afterDeploy hook').toBe('release\nhook\n');
  });

  test('neither script: its line, exit 0, no hook', () => {
    const g = mkDeployRepo({ test: 'test' });
    const { code, out, err } = runShip(g, 'deploy');
    expect(code, `exit 0, got: ${out}${err}`).toBe(0);
    expect(lines(err).includes('ship-deploy: no deploy or release script'), `the no-script line, got: ${err}`).toBeTruthy();
    expect(g.order(), 'no script and no hook ran').toBe(null);
  });
});

describe('ship deploy: failures', () => {
  test('the script failing: its exit line, exit 1, no hook', () => {
    const g = mkDeployRepo({ deploy: 'deploy 3' });
    const { code, out, err } = runShip(g, 'deploy');
    expect(code, `exit 1, got: ${out}${err}`).toBe(1);
    expect(lines(err).includes('ship-deploy: npm run deploy exited 3'), `the failure line, got: ${err}`).toBeTruthy();
    expect(g.order(), 'the script ran, no hook after it').toBe('deploy\n');
  });

  test('the deploy passing and an afterDeploy hook failing: its line, exit 1, the later hooks never run', () => {
    const g = mkDeployRepo({ deploy: 'deploy' }, (w) => ['exit 4', w.note('later')]);
    const { code, out, err } = runShip(g, 'deploy');
    expect(code, `exit 1, got: ${out}${err}`).toBe(1);
    expect(lines(err).includes('ship-deploy: the deploy ran; an afterDeploy hook failed'), `the deployed-but line, got: ${err}`).toBeTruthy();
    expect(g.order(), 'the deploy ran, the hook after the failure did not').toBe('deploy\n');
  });
});
