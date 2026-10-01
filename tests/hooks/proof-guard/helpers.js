// The shared prologue of the hooks/safety/proof-guard suites beside this one:
// the hook runner and the fixtures. The `gh` stub and the world with no `gh`
// are tests/lib/gh-stub.js, which spec-guard's suite shares.

const path = require('path');
const {
  cleanup, makeGhStub, ghCalls, pathWithoutGh, dropPathWithoutGh, hookRunner,
} = require('../../lib/gh-stub');

const HOOK = path.join(__dirname, '..', '..', '..', 'hooks', 'safety', 'proof-guard', 'run.sh');
const runHook = hookRunner(HOOK);

/** The `comments` value gh answers with, one comment per body. */
const comments = (...bodies) => bodies.map((body) => ({ body }));

// One issue with a proof, one without, in every world.
const WORLD = {
  field: 'comments',
  issues: { 7: comments('Proof: unit: node tests/hooks/x.test.js'), 9: comments('looks good to me') },
};

module.exports = {
  HOOK, cleanup, makeGhStub, ghCalls, pathWithoutGh, dropPathWithoutGh, runHook, WORLD, comments,
};
