// Tests for workflow/lib/discussions.js, what home needs of GitHub's Discussions in Node: the ready test, the meta read
// and the enable call, each asked in a node of its own under a world's env (test/lib/kit-under.js) against the home
// suites' stand-in gh (test/scripts/home/helpers.js). The category names' twin is test/hooks/twins.test.js's.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, run,
} = require('../lib/harness');
const {
  SYSTEM_PATH, homeEnv, joinPath, jsPath, stubTool, basePathWithout,
} = require('../lib/platform');
const { kitUnder } = require('../lib/kit-under');
const { mkWorld } = require('./home/helpers');

const SLUG = 'owner/workkit';

const DISCUSSIONS = path.join(__dirname, '..', '..', 'workflow', 'lib', 'discussions.js');

/** `<name>(SLUG)` of discussions.js, once, under <env>; `ready` takes no slug. */
const ask = (env, name) => kitUnder(env, 'discussions.js', name, [name === 'ready' ? [] : [SLUG]])[0];

/** `<name>(SLUG)` in a node of its own under <env>, whose stderr is a pipe: what it handed back and what stderr got. */
const askSaying = (env, name) => {
  const script = `Promise.resolve(require(${jsPath(DISCUSSIONS)})[${JSON.stringify(name)}](process.argv[1])).then((a) => process.stdout.write(JSON.stringify(a)));`;
  const res = run(process.execPath, ['-e', script, SLUG], { env });
  expect(res.status, `${name} answered, stderr: ${res.stderr}`).toBe(0);
  return { answer: JSON.parse(res.stdout), stderr: res.stderr };
};

// A machine with no gh anywhere on its PATH, built once: the real one must never answer.
let bare = null;
const noGh = () => {
  bare = bare || basePathWithout(mkTmp('lib-disc-'), 'gh');
  return homeEnv(mkTmp('lib-disc-home-'), { PATH: bare, WORKFLOW_HOME: mkTmp('lib-disc-wf-') });
};

/** A machine whose one gh answers <lines> and exits <code>, jq left off its PATH when <noJq>. */
const ghOnly = (lines, { noJq = false } = {}) => {
  const bin = mkTmp('lib-disc-bin-');
  stubTool(bin, 'gh', ['#!/usr/bin/env bash', ...lines]);
  const rest = noJq ? basePathWithout(mkTmp('lib-disc-'), 'jq') : SYSTEM_PATH;
  return homeEnv(mkTmp('lib-disc-home-'), { PATH: joinPath(bin, rest), WORKFLOW_HOME: mkTmp('lib-disc-wf-') });
};

/** The world's GraphQL calls that hold <text> in an argument. */
const graphql = (world, text) => world.ghCalls().filter((c) => c[0] === 'api' && c[1] === 'graphql' && c.some((a) => a.includes(text)));

describe('discussions.js: ready', () => {
  test('a gh on PATH is ready with no jq beside it; no gh is not', () => {
    expect(ask(ghOnly(['exit 0'], { noJq: true }), 'ready'), 'gh and no jq').toBe(true);
    expect(ask(noGh(), 'ready'), 'no gh').toBe(false);
  });
});

describe('discussions.js: meta', () => {
  test('one GraphQL read of the repo named by the slug, handed back as its node id, the Discussions flag and each category\'s id by name, with no wait line off a terminal', () => {
    const world = mkWorld({ discussionsOn: false });
    const { answer, stderr } = askSaying(world.env, 'meta');
    expect(stderr, 'the shell sent the read\'s stderr away, so no ⏳ line').toBe('');
    expect(answer, 'the parsed answer').toEqual({
      repositoryId: 'R_kdt',
      discussionsEnabled: false,
      categories: {
        Daily: 'DIC_0', Weekly: 'DIC_1', Monthly: 'DIC_2', Brief: 'DIC_3',
      },
    });
    const reads = graphql(world, 'discussionCategories');
    expect(reads.length, `one read, calls: ${JSON.stringify(world.ghCalls())}`).toBe(1);
    expect(reads[0].includes('owner=owner') && reads[0].includes('name=workkit'), `the slug split into owner and name, got: ${JSON.stringify(reads[0])}`).toBe(true);
  });

  test('a second read is served from <user dir>/.cache.json with no second gh call, a refresh reads again, and the write keeps the file\'s other keys', () => {
    const world = mkWorld({ discussionsOn: false });
    const cache = path.join(world.workflowHome, '.cache.json');
    const OTHERS = { kept: { by: 'another writer' }, homeCache: { 'owner/other': { repositoryId: 'R_other' } } };
    fs.writeFileSync(cache, `${JSON.stringify(OTHERS, null, 2)}\n`);
    const meta = (...rest) => kitUnder(world.env, 'discussions.js', 'meta', [[SLUG, ...rest]])[0];
    const reads = () => graphql(world, 'discussionCategories').length;
    expect(meta().repositoryId, 'the first read').toBe('R_kdt');
    expect(reads(), 'one gh read').toBe(1);
    const written = JSON.parse(fs.readFileSync(cache, 'utf8'));
    expect(written.homeCache[SLUG].repositoryId, 'the answer cached under its slug').toBe('R_kdt');
    expect([written.kept, written.homeCache['owner/other']], 'the file\'s other keys kept').toEqual([OTHERS.kept, OTHERS.homeCache['owner/other']]);
    // A mark on the cached answer, so an answer carrying it came from the file.
    written.homeCache[SLUG].repositoryId = 'R_cached';
    fs.writeFileSync(cache, `${JSON.stringify(written, null, 2)}\n`);
    expect(meta().repositoryId, 'the second read, from the file').toBe('R_cached');
    expect(reads(), 'and no second gh read').toBe(1);
    expect(meta({ refresh: true }).repositoryId, 'a refresh, from GitHub').toBe('R_kdt');
    expect(reads(), 'a second gh read').toBe(2);
  });

  test('a gh that fails, or none, is null', () => {
    expect(ask(ghOnly(['exit 1']), 'meta'), 'a refused read').toBe(null);
    expect(ask(noGh(), 'meta'), 'no gh').toBe(null);
  });
});

describe('discussions.js: enable', () => {
  test('Discussions off: the one mutation on the repo\'s node id, and 0, with no wait line off a terminal', () => {
    const world = mkWorld({ discussionsOn: false });
    const { answer, stderr } = askSaying(world.env, 'enable');
    expect(answer, 'turned on').toBe(0);
    expect(stderr, 'the shell sent the calls\' output away, so no ⏳ line').toBe('');
    const writes = graphql(world, 'updateRepository');
    expect(writes.length, `one mutation, calls: ${JSON.stringify(world.ghCalls())}`).toBe(1);
    expect(writes[0].includes('repoId=R_kdt'), `on the node id the read handed back, got: ${JSON.stringify(writes[0])}`).toBe(true);
  });

  test('Discussions already on: 2, and nothing written', () => {
    const world = mkWorld({ discussionsOn: true });
    expect(ask(world.env, 'enable'), 'already on').toBe(2);
    expect(graphql(world, 'updateRepository').length, `no mutation, calls: ${JSON.stringify(world.ghCalls())}`).toBe(0);
  });

  test('no gh: 1', () => {
    expect(ask(noGh(), 'enable'), 'nothing to ask').toBe(1);
  });
});
