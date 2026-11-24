// Tests for workflow/lib/discussions.js, GitHub's Discussions for the home repo in Node: the ready test, the meta
// read, the enable call, the category with its fallback order, the list and the create, each asked in a node of its
// own under a world's env (test/lib/kit-under.js) against the home suites' stand-in gh (test/scripts/home/helpers.js)
// or one written here.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, run,
} = require('../lib/harness');
const {
  SYSTEM_PATH, homeEnv, joinPath, jsPath, stubToolJs, basePathWithout,
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

/** A machine whose one gh runs <source> as JavaScript, jq left off its PATH when <noJq>. */
const ghOnly = (source, { noJq = false } = {}) => {
  const bin = mkTmp('lib-disc-bin-');
  stubToolJs(bin, 'gh', source);
  const rest = noJq ? basePathWithout(mkTmp('lib-disc-'), 'jq') : SYSTEM_PATH;
  return homeEnv(mkTmp('lib-disc-home-'), { PATH: joinPath(bin, rest), WORKFLOW_HOME: mkTmp('lib-disc-wf-') });
};

// The repo's read as GitHub answers it: Discussions on, one category.
const META_ANSWER = JSON.stringify({
  data: { repository: { id: 'R_kdt', hasDiscussionsEnabled: true, discussionCategories: { nodes: [{ id: 'DIC_0', name: 'Daily' }] } } },
});

/** A machine whose gh answers the repo's read, and runs <onCreate> for any other call. */
const ghPosting = (onCreate) => ghOnly([
  "if (process.argv.slice(2).some((a) => a.includes('discussionCategories'))) {",
  `  process.stdout.write(${JSON.stringify(META_ANSWER)});`,
  '  process.exit(0);',
  '}',
  onCreate,
].join('\n'));

/** The world's GraphQL calls that hold <text> in an argument. */
const graphql = (world, text) => world.ghCalls().filter((c) => c[0] === 'api' && c[1] === 'graphql' && c.some((a) => a.includes(text)));

/** `<name>(...args)` of discussions.js, once, under <env>. */
const askWith = (env, name, ...args) => kitUnder(env, 'discussions.js', name, [args])[0];

describe('discussions.js: ready', () => {
  test('a gh on PATH is ready with no jq beside it; no gh is not', () => {
    expect(ask(ghOnly('process.exit(0);', { noJq: true }), 'ready'), 'gh and no jq').toBe(true);
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
    expect(ask(ghOnly('process.exit(1);'), 'meta'), 'a refused read').toBe(null);
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

describe('discussions.js: resolveCategory', () => {
  /** The world's reads of the repo's categories so far. */
  const reads = (world) => graphql(world, 'discussionCategories').length;

  test('the asked name comes from the cached meta with no read, and a name the cache lacks after one refresh', () => {
    const world = mkWorld({ discussionsOn: true });
    const cached = { repositoryId: 'R_kdt', discussionsEnabled: true, categories: { Daily: 'DIC_0', Weekly: 'DIC_cached' } };
    fs.writeFileSync(path.join(world.workflowHome, '.cache.json'), `${JSON.stringify({ homeCache: { [SLUG]: cached } }, null, 2)}\n`);
    expect(askWith(world.env, 'resolveCategory', SLUG, 'Weekly'), 'the cache\'s id').toEqual({ id: 'DIC_cached', name: 'Weekly', fellBack: false });
    expect(reads(world), 'no read').toBe(0);
    expect(askWith(world.env, 'resolveCategory', SLUG, 'Monthly'), 'the refreshed id').toEqual({ id: 'DIC_2', name: 'Monthly', fellBack: false });
    expect(reads(world), 'one refresh').toBe(1);
  });

  test('a name the repo lacks falls back, after one refresh, to General, then Announcements, then the repo\'s first category', () => {
    const ROWS = [
      [['Announcements', 'General'], { id: 'DIC_1', name: 'General', fellBack: true }],
      [['Ideas', 'Announcements'], { id: 'DIC_1', name: 'Announcements', fellBack: true }],
      [['Polls', 'Ideas'], { id: 'DIC_0', name: 'Polls', fellBack: true }],
    ];
    for (const [categories, wanted] of ROWS) {
      const world = mkWorld({ discussionsOn: true, categories });
      expect(askWith(world.env, 'resolveCategory', SLUG, 'Weekly'), `the repo holding ${categories.join(' and ')}`).toEqual(wanted);
      expect(reads(world), `the read, then one refresh, for ${categories.join(' and ')}`).toBe(2);
    }
  });

  test('a repo with no category at all, a gh that fails, or none, is null', () => {
    expect(askWith(mkWorld({ discussionsOn: true, categories: [] }).env, 'resolveCategory', SLUG, 'Daily'), 'no category').toBe(null);
    expect(askWith(ghOnly('process.exit(1);'), 'resolveCategory', SLUG, 'Daily'), 'a refused read').toBe(null);
    expect(askWith(noGh(), 'resolveCategory', SLUG, 'Daily'), 'no gh').toBe(null);
  });
});

describe('discussions.js: list', () => {
  test('one read of the resolved category, 50 posts unless a limit is given, and a post made at the window\'s opening moment is inside it', () => {
    const world = mkWorld({ discussionsOn: true });
    expect(askWith(world.env, 'list', SLUG, 'Daily', '2026-07-27T09:00:00Z'), 'the post at the window\'s edge')
      .toEqual([{ title: 'daily: 2026-07-27', createdAt: '2026-07-27T09:00:00Z', body: 'yesterday' }]);
    askWith(world.env, 'list', SLUG, 'Daily', '2026-07-27T09:00:00Z', 5);
    const lists = graphql(world, 'discussions(first');
    expect(lists.length, `one read a call, calls: ${JSON.stringify(world.ghCalls())}`).toBe(2);
    for (const [call, limit] of [[lists[0], 'limit=50'], [lists[1], 'limit=5']]) {
      expect(call[call.indexOf(limit) - 1], `${limit}, typed as a number: ${JSON.stringify(call)}`).toBe('-F');
      expect(call.includes('catId=DIC_0') && call.includes('owner=owner') && call.includes('name=workkit'), `on the repo's category: ${JSON.stringify(call)}`).toBe(true);
    }
  });

  test('a gh that fails is null', () => {
    expect(askWith(ghOnly('process.exit(1);'), 'list', SLUG, 'Daily', '2026-07-21T00:00:00Z'), 'a refused read').toBe(null);
  });

  test('an answer past 1 MB, 50 posts of 30,000 characters each, is read whole', () => {
    const env = ghPosting([
      "const nodes = Array.from({ length: 50 }, (_, i) => ({ title: `daily: post ${i}`, createdAt: '2026-07-28T09:00:00Z', body: 'x'.repeat(30000) }));",
      'process.stdout.write(JSON.stringify({ data: { repository: { discussions: { nodes } } } }));',
    ].join('\n'));
    // A digest comes back, not the posts: the harness's own read of a child keeps only 1 MB too.
    const script = `require(${jsPath(DISCUSSIONS)}).list(process.argv[1], 'Daily', '2026-07-21T00:00:00Z').then((posts) => process.stdout.write(JSON.stringify(posts && { count: posts.length, title: posts[0].title, bodyLength: posts[49].body.length })));`;
    const res = run(process.execPath, ['-e', script, SLUG], { env });
    expect(res.status, `list answered, stderr: ${res.stderr}`).toBe(0);
    expect(JSON.parse(res.stdout), 'every post, each body whole').toEqual({ count: 50, title: 'daily: post 0', bodyLength: 30000 });
  });
});

describe('discussions.js: create', () => {
  test('an answer holding no URL is empty, and a refused post is null', () => {
    const body = path.join(mkTmp('lib-disc-body-'), 'summary.md');
    fs.writeFileSync(body, 'A day.\n');
    expect(askWith(ghPosting(`process.stdout.write(${JSON.stringify('{"data":{"createDiscussion":null}}')});`), 'create', SLUG, 'DIC_0', 'daily: 2026-07-28', body), 'no URL').toBe('');
    expect(askWith(ghPosting('process.exit(1);'), 'create', SLUG, 'DIC_0', 'daily: 2026-07-28', body), 'refused').toBe(null);
  });

  test('a body file that is not there, or no category id, is null, and nothing is posted', () => {
    const world = mkWorld({ discussionsOn: true });
    const body = path.join(world.root, 'summary.md');
    fs.writeFileSync(body, 'A day.\n');
    expect(askWith(world.env, 'create', SLUG, 'DIC_0', 'daily: 2026-07-28', path.join(world.root, 'missing.md')), 'no body file').toBe(null);
    expect(askWith(world.env, 'create', SLUG, '', 'daily: 2026-07-28', body), 'no category id').toBe(null);
    expect(graphql(world, 'createDiscussion').length, `no post, calls: ${JSON.stringify(world.ghCalls())}`).toBe(0);
  });
});
