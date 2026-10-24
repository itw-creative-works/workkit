// Tests for `workkit doctor`'s identity lines: the sign-in under This machine
// and the App's installation under This repo. Each run is a scratch kit in a
// scratch repo whose origin is acme/rostered, the user's dir the scratch home's
// ~/.workkit, and the token service a real local stand-in.
// The shared prologue is ../workkit-cli/helpers.js.

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  INSTALL_FIX, writeLogin, useTokenService, startService, attentionCount,
} = require('../../lib/identity');
const { mkOriginRepo } = require('../../lib/git-repo');
const {
  cleanup, mkWorld, runCli, signInEnv, mkRepo, rosterRepo, mkKit,
} = require('../workkit-cli/helpers');

/**
 * A scratch world, kit and opted-in repo whose origin is acme/rostered, enabled
 * on the roster unless `rostered` is false; WORKFLOW_HOME is the home's ~/.workkit,
 * so the roster, the settings and the login file share the one user dir every
 * reading of it agrees on.
 */
const mkScene = ({ rostered = true } = {}) => {
  const world = mkWorld();
  const { kit, script } = mkKit('owner/kit');
  const repo = mkRepo({ optIn: true });
  if (rostered) rosterRepo(world, repo, 'acme/rostered', { script, env: signInEnv(world, { node: false }) });
  else mkOriginRepo(repo, 'https://github.com/acme/rostered.git');
  return { world, kit, script, repo };
};

// The doctor's node is the one running this suite, after the world's stubs.
const doctor = ({ world, script, repo }) => runCli(world, ['doctor'], {
  script,
  cwd: repo,
  env: signInEnv(world),
});

/** The lines under the doctor's section header naming `title`, up to the next header. */
const section = (said, title) => {
  const lines = said.split('\n');
  const start = lines.findIndex((l) => !/^\s/.test(l) && l.includes(title));
  assert(start >= 0, `the doctor prints a ${title} section, got: ${said}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.trim() && !/^\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
};

// The doctor writes a command in backticks; the Contract's code span cannot show them.
const NOT_SIGNED_IN = /not signed in; run `?workkit setup --login`?/;

/** The This repo lines naming acme/rostered's installation. */
const repoLines = (said) => section(said, 'This repo').split('\n')
  .filter((l) => l.includes('acme/rostered') && /installed/.test(l));

const run = async () => {
  group('workkit doctor: identity');

  await test('case 19: This machine says signed in as @<login>, or not signed in; run workkit setup --login as one attention item', async () => {
    const scene = mkScene();
    const service = await startService(200, { token: 'ghs_probe', expires_at: '2099-01-01T00:00:00Z' });
    try {
      useTokenService(scene.world.home, `${service.url}/token`);
      const bare = doctor(scene);
      assert(NOT_SIGNED_IN.test(bare.err), `the warning on stderr says how to sign in, got: ${bare.err}`);
      assert(!bare.said.includes('workkit login'), `and no longer names workkit login, got: ${bare.said}`);
      assert(!bare.said.includes('signed in as @'), `and never names a login, got: ${bare.said}`);

      // The same scene signed in, the App installed: the one difference in the
      // count is the sign-in line.
      writeLogin(scene.world.home, { token: 'ghu_doctoruser', login: 'octocat' });
      const set = doctor(scene);
      assert(section(set.said, 'This machine').includes('signed in as @octocat'), `This machine names the login, got: ${set.said}`);
      assert(!set.said.includes('not signed in'), `and not the opposite, got: ${set.said}`);
      assertEq(attentionCount(bare.said) - attentionCount(set.said), 1, 'not signed in is one attention item');
    } finally {
      await service.close();
      cleanup(scene.world.root); cleanup(scene.kit); cleanup(scene.repo);
    }
  });

  await test('case 19: This repo, signed in with the origin on the roster: a 200 is installed and ok, a 412 a warning carrying the install page', async () => {
    const scene = mkScene();
    writeLogin(scene.world.home, { token: 'ghu_doctoruser', login: 'octocat' });
    const installed = await startService(200, { token: 'ghs_probe', expires_at: '2099-01-01T00:00:00Z' });
    const missing = await startService(412, { error: 'not installed', fix: INSTALL_FIX });
    try {
      useTokenService(scene.world.home, `${installed.url}/token`);
      const ok = doctor(scene);
      const okLines = repoLines(ok.said);
      assert(okLines.length > 0 && okLines.every((l) => !l.includes('not installed')), `it says the App is installed on acme/rostered, got: ${ok.said}`);
      const asked = installed.requests().filter((r) => r.method === 'POST' && r.url === '/token');
      assert(asked.length > 0, `the doctor asked the stand-in, got: ${JSON.stringify(installed.requests())}`);
      assert(asked.every((r) => r.auth === 'Bearer ghu_doctoruser' && JSON.parse(r.body).repo === 'acme/rostered'),
        `with the login's bearer, for acme/rostered, got: ${JSON.stringify(asked)}`);

      useTokenService(scene.world.home, `${missing.url}/token`);
      const warn = doctor(scene);
      assert(repoLines(warn.said).some((l) => l.includes('not installed')), `it says the App is not installed on acme/rostered, got: ${warn.said}`);
      assert(warn.said.includes('https://github.com/apps/workkit-agent'), `and carries the install page, got: ${warn.said}`);
      assertEq(attentionCount(warn.said) - attentionCount(ok.said), 1, 'not installed is one attention item');
    } finally {
      await installed.close();
      await missing.close();
      cleanup(scene.world.root); cleanup(scene.kit); cleanup(scene.repo);
    }
  });

  await test('case 19: This repo keeps the shim\'s rule: an opted-in repo off the roster gets no installation line and no ask', async () => {
    const scene = mkScene({ rostered: false });
    writeLogin(scene.world.home, { token: 'ghu_doctoruser', login: 'octocat' });
    const service = await startService(200, { token: 'ghs_probe', expires_at: '2099-01-01T00:00:00Z' });
    try {
      useTokenService(scene.world.home, `${service.url}/token`);
      const res = doctor(scene);
      assertEq(repoLines(res.said).length, 0, `no installation line for acme/rostered, got: ${res.said}`);
      assertEq(service.requests().length, 0, `the service is never asked, got: ${JSON.stringify(service.requests())}`);
    } finally {
      await service.close();
      cleanup(scene.world.root); cleanup(scene.kit); cleanup(scene.repo);
    }
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
