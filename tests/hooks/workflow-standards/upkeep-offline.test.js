//
// Tests for hooks/workflow:standards: the machine-side upkeep, the schedule it
// keeps current (launchd only), and the offline heal.
// The shared prologue (the repo factory, the decline, the hook runner and its gh-less PATH, the constants) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const {
  group, test, assert, assertEq, summary, selfRun, hasLaunchd,
} = require('../../lib/harness');
const { stubTool } = require('../../lib/platform');
const {
  mkTmp, cleanup, makeRepo, runHook, dropPathWithoutGh,
} = require('./helpers');

const run = async () => {
  group('workflow:standards: machine-side upkeep');

  // The plist a machine carries, rendered for some OTHER checkout: the drift
  // `workkit update --auto` exists to correct. Written straight to disk rather
  // than through the installer: what matters here is that the hook noticed.
  const seedStalePlist = (home) => {
    const dir = path.join(home, 'Library', 'LaunchAgents');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'com.workkit.claude-daily.plist');
    fs.writeFileSync(file, '<!-- rendered by an older checkout -->\n');
    return file;
  };

  // A launchctl that records nothing and answers "not loaded": the real one is
  // never reached from a test.
  const launchctlShim = () => {
    const dir = mkTmp();
    stubTool(dir, 'launchctl', ['#!/usr/bin/env bash', "if [[ \"$1\" == 'print' ]]; then exit 1; fi", 'exit 0']);
    return dir;
  };

  await test('a machine with no schedule installed never gets one', () => {
    // The whole cron boundary: the hook UPDATES what a human installed and
    // installs nothing fresh.
    const repo = makeRepo();
    const home = mkTmp();
    const shim = launchctlShim();
    const { code, cacheDir } = runHook(repo, { home, pathPrefix: shim });
    assertEq(code, 0, 'exit 0');
    assert(!fs.existsSync(path.join(home, 'Library', 'LaunchAgents')), 'nothing was installed behind anyone’s back');
    cleanup(repo); cleanup(cacheDir); cleanup(home); cleanup(shim);
  });

  await test('an all-current machine stays silent', () => {
    const repo = makeRepo();
    const home = mkTmp();
    const first = runHook(repo, { home });
    assert(first.stdout.length > 0, 'the first run reported the heals');
    const second = runHook(repo, { home });
    assertEq(second.stdout, '', `upkeep with nothing to do adds no noise, got: ${second.stdout}`);
    cleanup(repo); cleanup(home); cleanup(first.cacheDir); cleanup(second.cacheDir);
  });

  // The plist itself is launchd's, and the engine re-renders one only where
  // launchd is (`schedule: launchd is macOS; nothing to keep current here`).
  // Off that machine there is no schedule to correct, so the case is named as a
  // skip rather than asserted against a capability that is not there (#114).
  if (hasLaunchd()) {
    group('workflow:standards: the schedule it keeps current');

    await test('a repo’s daily run corrects a schedule left by another checkout', () => {
      const repo = makeRepo();
      const home = mkTmp();
      const shim = launchctlShim();
      const plist = seedStalePlist(home);
      const { code, stdout, cacheDir } = runHook(repo, { home, pathPrefix: shim });
      assertEq(code, 0, 'exit 0');
      const body = fs.readFileSync(plist, 'utf8');
      assert(!body.includes('older checkout'), 'the plist is re-rendered for this checkout');
      assert(body.includes('com.workkit.claude-daily'), 'and it is the real one');
      const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext;
      assert(ctx.includes('schedule:'), `the session hears what was corrected, got: ${ctx}`);
      // In the SAME shape the heal's own lines arrive in (issue #237): the
      // upkeep speaks under a title, so its lines are indented and glyphed at
      // the source, and this relay takes both off rather than injecting one
      // shape beside another.
      const relayed = ctx.split('\n').find((line) => line.includes('schedule:'));
      assert(/^schedule: /.test(relayed || ''),
        `with no indent and no glyph left on it, got: ${JSON.stringify(relayed)}`);
      cleanup(repo); cleanup(cacheDir); cleanup(home); cleanup(shim);
    });
  } else {
    group('workflow:standards: the schedule it keeps current: skipped, launchd is macOS (#114)');
  }

  group('workflow:standards: offline');

  await test('no gh on PATH: local heals still reported, no failure', () => {
    const repo = makeRepo();
    const { code, stdout, cacheDir } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assert(!stdout.includes('gh not installed'), 'a skip line never reaches the session');
    assert(stdout.includes('issue forms'), 'the local heals do');
    cleanup(repo); cleanup(cacheDir);
  });

  dropPathWithoutGh();
  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
