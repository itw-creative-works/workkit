// Tests for workflow/lib/proof-dir.js, the Node home of a proof run's folder: proofDir makes a
// new folder under proof/ in the kit's cache folder, first removing each run folder there last
// changed over a day ago, save one that holds `live` (a --live run's only copy of the live files).
// proofBase names proof/ itself. In process, under a scratch HOME set before the module loads.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp,
} = require('../lib/harness');
const { homeEnv, samePath } = require('../lib/platform');
const { proofBase, plantRun } = require('../lib/workflow-home');

// A scratch HOME, and a machine folder outside it, for this process, set before
// proof-dir.js loads, so no run folder lands in the machine's own cache.
const HOME = mkTmp('proof-dir-home-');
const WORKFLOW_HOME = mkTmp('proof-dir-kit-');
Object.assign(process.env, homeEnv(HOME, { WORKFLOW_HOME }));

const kit = require('../../workflow/lib/proof-dir');

describe('proofDir', () => {
  test('two calls each make their own new folder under <HOME>/.cache/workkit/proof, which proofBase names; none under WORKFLOW_HOME', async () => {
    const base = proofBase(HOME);
    expect(samePath(await kit.proofBase(), base, process.platform), `proofBase names ${base}`).toBe(true);
    const [a, b] = [await kit.proofDir(), await kit.proofDir()];
    for (const made of [a, b]) {
      expect(samePath(path.dirname(made), base, process.platform), `${made} sits directly under ${base}`).toBe(true);
      expect(fs.statSync(made).isDirectory(), `${made} was made`).toBe(true);
    }
    expect(samePath(a, b, process.platform), `two folders: ${a} and ${b}`).toBe(false);
    expect(fs.readdirSync(WORKFLOW_HOME).join(','), 'nothing made in the WORKFLOW_HOME folder').toBe('');
  });

  test('a run folder changed over a day ago is removed first; one changed within the day and an old one holding live/ stay', async () => {
    plantRun(HOME, 'stale1', 2);
    plantRun(HOME, 'fresh1', 1 / 24);
    plantRun(HOME, 'kept1', 2, 'live/x');
    const made = await kit.proofDir();
    const base = proofBase(HOME);
    expect(fs.existsSync(path.join(base, 'stale1')), 'the stale run folder is gone').toBe(false);
    expect(fs.readFileSync(path.join(base, 'fresh1', 'copy', 'left.js'), 'utf8'), 'the fresh run folder is whole').toBe('');
    expect(fs.readFileSync(path.join(base, 'kept1', 'live', 'x'), 'utf8'), 'the old folder holding live/ is whole').toBe('');
    expect(samePath(path.dirname(made), base, process.platform), `the new folder ${made} sits under ${base}`).toBe(true);
  });
});
