// Tests for workflow/lib/scratch.js: withScratch, the one frame of a scratch folder made for a run and
// removed whatever the run did. The no-folder case runs in a node of its own, whose temp folder is not there.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, run,
} = require('../lib/harness');
const { jsPath, nodeTempEnv } = require('../lib/platform');
const { caught } = require('../lib/caught');
const { withScratch } = require('../../workflow/lib/scratch');

const SCRATCH = path.join(__dirname, '..', '..', 'workflow', 'lib', 'scratch.js');

describe('scratch.js: withScratch', () => {
  test('the run is handed a folder named by the prefix, its answer handed back, and the folder goes after', () => {
    let seen = null;
    const out = withScratch((scratch) => {
      seen = scratch;
      fs.writeFileSync(path.join(scratch, 'note'), 'x');
      return 'the answer';
    }, 'suite-index.');
    expect(out, 'what the run handed back').toBe('the answer');
    expect(path.basename(seen).startsWith('suite-index.'), `the folder carries the prefix: ${seen}`).toBe(true);
    expect(fs.existsSync(seen), 'and is gone once the run is over, its files with it').toBe(false);
    let plain = null;
    withScratch((scratch) => { plain = scratch; });
    expect(path.basename(plain).startsWith('workkit.'), `no prefix given is the kit's own: ${plain}`).toBe(true);
  });

  test('a run that throws still has its folder removed, and the throw reaches the caller', async () => {
    let seen = null;
    const err = await caught(() => withScratch((scratch) => {
      seen = scratch;
      throw new Error('the run broke');
    }));
    expect(err && err.message, 'the run\'s own error').toBe('the run broke');
    expect(fs.existsSync(seen), `the folder went anyway: ${seen}`).toBe(false);
  });

  test('an async run keeps its folder until its promise settles, a rejection included', async () => {
    let seen = null;
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const answer = withScratch(async (scratch) => {
      seen = scratch;
      await held;
      return 'settled';
    });
    expect(fs.existsSync(seen), 'the folder is there while the run waits').toBe(true);
    release();
    expect(await answer, 'what the run resolved with').toBe('settled');
    expect(fs.existsSync(seen), 'and gone once it settled').toBe(false);

    let rejected = null;
    const err = await caught(() => withScratch(async (scratch) => {
      rejected = scratch;
      throw new Error('the async run broke');
    }));
    expect(err && err.message, 'the rejection reaches the caller').toBe('the async run broke');
    expect(fs.existsSync(rejected), `the folder went anyway: ${rejected}`).toBe(false);
  });

  test('no folder can be made: null, and the run is never called', () => {
    const missing = path.join(mkTmp('lib-scratch-'), 'not-there');
    const script = `const a = require(${jsPath(SCRATCH)}).withScratch(() => 'called'); process.stdout.write(JSON.stringify(a));`;
    const res = run(process.execPath, ['-e', script], {
      env: nodeTempEnv(missing, process.env),
    });
    expect(res.status, `the call answered, stderr: ${res.stderr}`).toBe(0);
    expect(JSON.parse(res.stdout), 'null, never what the run would have handed back').toBe(null);
  });
});
