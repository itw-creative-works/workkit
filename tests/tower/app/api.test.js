//
// Tests for the tower dashboard's api.js: the feed adapter, live versus
// published, the board's drop as a payload, and the three modes.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const path = require('path');
const { pathToFileURL } = require('url');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { loadLibs, libs, mkStorage } = require('./helpers');

const run = async () => {
  const { format, api, github } = await loadLibs();

  group('tower/app: api - the feed adapter');

  // The one translation the runtime leans on: the tower's four-key result
  // shape into the framework poller's fetcher contract (resolve with the body,
  // throw carrying `.code`).
  await test('a good answer resolves with the body, untouched', () => {
    const data = { rows: [1, 2, 3] };
    assertEq(api.unwrapFeed({ ok: true, data, status: 200, reason: null }), data, 'the body passes through by reference');
  });

  await test('a failed answer throws the reason with the status as its code', () => {
    let thrown = null;
    try {
      api.unwrapFeed({ ok: false, data: null, status: 502, reason: '/api/board answered 502' });
    } catch (error) {
      thrown = error;
    }
    assertEq(thrown && thrown.message, '/api/board answered 502', 'the reason is the message');
    assertEq(thrown && thrown.code, 502, 'and the status rides as .code');
  });

  await test('a transport failure keeps its null status', () => {
    let thrown = null;
    try {
      api.unwrapFeed({ ok: false, data: null, status: null, reason: 'did not answer' });
    } catch (error) {
      thrown = error;
    }
    assertEq(thrown && thrown.code, null, 'no HTTP status means a null code, not 0 or undefined');
  });

  await test('the fetcher composes fetchFeed and the unwrap, both ways', async () => {
    // Node ships its own global fetch and the suites share one process -
    // restore it, never delete it.
    const realFetch = globalThis.fetch;
    let body;
    let thrown = null;
    try {
      globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ rows: [] }) });
      body = await api.feedFetcher('/api/board');

      // A body that reports its own failure (`ok: false`) throws with ITS reason.
      globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: false, reason: 'gh is not logged in' }) });
      try {
        await api.feedFetcher('/api/board');
      } catch (error) {
        thrown = error;
      }
    } finally {
      globalThis.fetch = realFetch;
    }
    assertEq(JSON.stringify(body), '{"rows":[]}', 'a 200 with JSON resolves with the body');
    assertEq(thrown && thrown.message, 'gh is not logged in', 'the body\'s own sentence survives the translation');
    assertEq(thrown && thrown.code, 200, 'with the HTTP status it arrived under');
  });

  group('tower/app: api - live versus published');

  await test('an origin is taken from the query first, then the console hatch', () => {
    assertEq(api.apiOverride('http://tower.example/board?api=http://box:8693/', {}), 'http://box:8693', 'the query wins, trailing slash trimmed');
    assertEq(api.apiOverride('http://tower.example/board', { TOWER_API: 'http://box:8693' }), 'http://box:8693', 'the console override when there is no query');
    assertEq(api.apiOverride('http://tower.example/board?api=http://a', { TOWER_API: 'http://b' }), 'http://a', 'the query outranks it');
    assertEq(api.apiOverride('http://tower.example/board', {}), '', 'and nothing supplied is no origin, never undefined');
    assertEq(api.apiOverride('http://tower.example/board', { TOWER_API: '' }), '', 'an empty override is no override');
  });

  await test('a production build with no origin supplied is published', () => {
    assertEq(api.decideLive('production', ''), false, 'nothing to read');
  });

  await test('an origin supplied to a production build outranks the build', () => {
    assertEq(api.decideLive('production', 'http://box:8693'), true, '?api= runs it fully live');
  });

  await test('a development build is live whatever else is true', () => {
    assertEq(api.decideLive('development', ''), true, 'the local tower is the default origin');
    assertEq(api.decideLive('development', 'http://box:8693'), true, 'and an override does not change the mode');
  });

  await test('a page with no build snapshot baked into it is published, not live', () => {
    // Anything that is not the word development is published, and a page with
    // no snapshot at all names no environment.
    assertEq(api.decideLive('', ''), false, 'no environment at all');
    assertEq(api.decideLive(undefined, ''), false, 'and no key at all');
    assertEq(api.LIVE, false, 'which is what the module itself decided under the stubs above');
  });

  await test('the environment is read off the build snapshot the framework bakes in (#292)', async () => {
    // Omega bakes ONE snapshot into every page, `window.OMEGA_BUILD_JSON`, and
    // its `config.environment` is the build's verdict. The `window.Configuration`
    // global it once wrote is gone, and a read of it decided published for
    // every dev page. The read happens at import, so each world gets a fresh
    // instance of the module through a cache-busting query.
    const boot = async (world, tag) => {
      globalThis.location = { href: 'http://localhost:4300/board' };
      globalThis.window = world;
      const fresh = await import(`${pathToFileURL(path.join(libs, 'api.js')).href}?env=${tag}`);
      delete globalThis.location;
      delete globalThis.window;
      return fresh;
    };
    const dev = await boot({ OMEGA_BUILD_JSON: { config: { environment: 'development' } } }, 'dev');
    assertEq(dev.LIVE, true, 'a dev page has a tower to read');
    const built = await boot({ OMEGA_BUILD_JSON: { config: { environment: 'production' } } }, 'prod');
    assertEq(built.LIVE, false, 'a production page is a published copy');
    const old = await boot({ Configuration: { environment: 'development' } }, 'old');
    assertEq(old.LIVE, false, 'and the global the framework no longer writes counts for nothing');
  });

  await test('a published page arms no feeds at all - zero doomed requests', () => {
    // The runtime gates on `LIVE`, never on the size of this table: a live page
    // is allowed to declare no feeds, and must not be mistaken for a published
    // one. The table is emptied here as well so that nothing is armed even if a
    // caller reaches it in published mode.
    assertEq(Object.keys(api.pageFeeds(['repos', 'board'], false)).length, 0, 'nothing for the poller to poll');
    assertEq(Object.keys(api.pageFeeds([], true)).length, 0, 'and a live page declaring none is empty too - which is why the mode is read from the flag');
  });

  await test('a live page arms exactly the feeds it asked for, each with its path', () => {
    const feeds = api.pageFeeds(['repos', 'board'], true);
    assertEq(Object.keys(feeds).join(','), 'repos,board', 'those two');
    assertEq(feeds.board.path, '/api/board', 'with the API path written here and nowhere else');
    assertEq(feeds.board.every, 60000, 'and the board\'s slower cadence - a gh sweep is expensive');
  });

  group('tower/app: api - the board’s drop, as a payload');

  const CARD = { repo: 'ITW/workkit', number: 48, status: 'specced' };

  await test('a drop on another column becomes the endpoint’s four fields', () => {
    assertEq(JSON.stringify(api.moveRequest(CARD, 'blocked', true)),
      '{"repo":"ITW/workkit","number":48,"from":"specced","to":"blocked"}',
      'where it came from rides along - the move removes one label and adds the other');
  });

  await test('the seven columns that are a status are the only ones a card moves between', () => {
    assertEq(api.MOVABLE_STATUSES.join(','), 'inbox,specced,building,qa,complete,blocked,backlog', 'the pipeline, from the column list itself');
    assertEq(api.moveRequest(CARD, '', true), null, 'the absence of a label is not a destination - nothing on the board names it');
    assertEq(api.moveRequest({ ...CARD, status: null }, 'inbox', true), null, 'and an issue triage has not reached has no label to remove');
    assertEq(api.moveRequest(CARD, 'shipped', true), null, 'a status the pipeline does not name is not one');
  });

  await test('a drop on the column the card is already in is not a move', () => {
    assertEq(api.moveRequest(CARD, 'specced', true), null, 'nothing to write');
  });

  await test('starting work is a drop like any other - specced to building is a payload', () => {
    assertEq(JSON.stringify(api.moveRequest(CARD, 'building', true)),
      '{"repo":"ITW/workkit","number":48,"from":"specced","to":"building"}',
      'the flip that puts an issue in flight');
    assertEq(JSON.stringify(api.moveRequest({ ...CARD, status: 'building' }, 'blocked', true)),
      '{"repo":"ITW/workkit","number":48,"from":"building","to":"blocked"}',
      'and a card leaves the Building column the same way');
  });

  await test('a LOCKED copy produces no move at all - a write needs the token it has not been given', () => {
    assertEq(api.moveRequest(CARD, 'blocked', false), null, 'the gate is the payload’s, so no page can forget it');
    assertEq(api.moveRequest(CARD, 'blocked'), null, 'and the default is the module’s own mode, which is locked under these stubs');
    assertEq(api.WRITABLE, false, 'which is exactly what WRITABLE says');
    assert(!api.LIVE, 'and it is not the tower question - a published copy with a token writes too');
  });

  await test('a drop carrying no issue is nothing, never a request with holes in it', () => {
    assertEq(api.moveRequest(null, 'blocked', true), null, 'a key the paint no longer knows');
  });

  await test('the move is POSTed to the status endpoint as JSON - the page names no URL', async () => {
    const realFetch = globalThis.fetch;
    let seen = null;
    let answer;
    try {
      globalThis.fetch = async (url, options) => {
        seen = { url, options };
        return { ok: true, status: 200, json: async () => ({ ok: true, status: 'blocked' }) };
      };
      answer = await api.postIssueStatus(api.moveRequest(CARD, 'blocked', true));
    } finally {
      globalThis.fetch = realFetch;
    }
    assertEq(seen.url, `${api.API_BASE}/api/issues/status`, 'the one path, written in api.js and nowhere else');
    assertEq(seen.options.method, 'POST', 'a write');
    assertEq(JSON.parse(seen.options.body).to, 'blocked', 'carrying the move');
    assertEq(answer.ok, true, 'and the answer arrives in the tower’s own result shape');
  });

  const fs = require('fs');

  await test('the intake dialog is inert only where it has nothing to write with', () => {
    // A locked copy off this machine needs a TOKEN, not a tower - telling it
    // "live data needs a local tower" sends the one viewer who can fix it after
    // the wrong thing. An unlocked one files for real, with the same token it
    // reads with. (On localhost the tower IS the answer - the test below.)
    assert(format.LOCKED_NOTICE.includes('token'), 'the locked sentence asks for the token');
    assert(!format.LOCKED_NOTICE.includes('npm run tower'), 'and does not send a viewer to install a tower');
    assert(!/read-only/.test(format.LOCKED_NOTICE), 'and no longer calls the token read-only');
    assertEq(format.READ_ONLY_NOTICE, undefined, 'the read-only sentence is gone - nothing it described is true any more');
    const src = fs.readFileSync(path.join(libs, 'intake.js'), 'utf8');
    assert(/if \(!WRITABLE\)[\s\S]{0,80}disableIntake\(dialog\)/.test(src), 'only a copy that cannot write is disabled');
    assert(/lockedIntakeNotice\(location\.hostname\)/.test(src) && !/readOnlyNotice/.test(src),
      'and the sentence left is the locked one - which host it is said on is token.js’s fork (#89)');
    assert(/submitIntake\(payload\)/.test(src), 'the submit goes through the mode-aware write, never a tower URL');
    assert(/readAnyFeed\('\/api\/repos'\)/.test(src), 'and the roster is read from whichever half is talking');
  });

  await test('the write paths follow the MODE - a tower is POSTed to, a published copy writes GitHub itself', () => {
    const src = fs.readFileSync(path.join(libs, 'api.js'), 'utf8');
    assert(/WRITABLE = MODE !== 'locked'/.test(src), 'everything but a locked copy can write');
    assert(/moveIssueStatus\(move, githubContext\(\)\)[\s\S]{0,120}postJson\('\/api\/issues\/status', move\)/.test(src),
      'the drag reaches GitHub in published mode and the tower on a machine');
    assert(/createIssue\(payload, githubContext\(\)\)[\s\S]{0,80}postJson\('\/api\/intake', payload\)/.test(src),
      'and so does the intake');
  });

  group('tower/app: api - the three modes');

  await test('a tower outranks everything, and the token decides the rest', () => {
    assertEq(api.decideMode('development', '', false), 'tower', 'a dev build reads the machine’s API');
    assertEq(api.decideMode('production', 'http://box:8693', false), 'tower', 'and so does any build pointed at one');
    assertEq(api.decideMode('production', '', true), 'github', 'a published copy with a token reads GitHub itself');
    assertEq(api.decideMode('production', '', false), 'locked', 'and without one it has nothing to show but the prompt');
    assertEq(api.MODE, 'locked', 'which is what the module itself decided under the stubs above');
    assertEq(api.LIVE, false, 'LIVE stays the question of a TOWER - WRITABLE is the flag every write gates on');
  });

  await test('a landing carrying setup’s handover boots as a copy holding a token (#230)', async () => {
    // The one case that has to be read off the MODULE rather than off
    // `decideMode`: the fragment is banked at import, before the storage the
    // mode is decided from is read. A module URL evaluates once per process, so
    // this second import carries a cache-busting query to get a fresh one.
    const storage = mkStorage();
    const rewrites = [];
    const where = { href: 'https://alice.github.io/workkit/settings#token=gho_FAKE', hash: '#token=gho_FAKE', pathname: '/workkit/settings', search: '' };
    globalThis.location = where;
    globalThis.window = { location: where, history: { replaceState: (state, title, url) => rewrites.push(url) }, localStorage: storage };
    const handed = await import(`${pathToFileURL(path.join(libs, 'api.js')).href}?handover=1`);
    delete globalThis.location;
    delete globalThis.window;

    assertEq(storage.held[github.TOKEN_KEY], 'gho_FAKE', 'the fragment was banked while the module loaded');
    assertEq(handed.MODE, 'github', 'so the copy that lands with one boots unlocked rather than locked');
    assertEq(handed.WRITABLE, true, 'and writes with it, exactly as a typed token does');
    assertEq(rewrites.join(','), '/workkit/settings', 'with the fragment stripped off the project-path URL it arrived on');
  });

  await test('a published page arms only the feeds GitHub can answer', () => {
    const feeds = api.githubPageFeeds(['repos', 'board', 'sessions', 'health', 'telemetry']);
    assertEq(Object.keys(feeds).join(','), 'repos,board', 'the machine-bound three are simply absent');
    assertEq(feeds.board.every, 60000, 'and the sweep keeps the board’s cadence - a GraphQL sweep is expensive');
    assertEq(Object.keys(api.githubPageFeeds(['brief'])).join(','), 'brief', 'the brief is one of the three it can');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
