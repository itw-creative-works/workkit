//
// Tests for the tower dashboard's api.js: the feed adapter, live versus published,
// the board's drop as a payload, and the three modes. Shared prologue: ./helpers.js.
//

const path = require('path');
const { pathToFileURL } = require('url');
const { describe, before, test, expect } = require('../../lib/harness');
const { loadLibs, libs, mkStorage } = require('./helpers');

let format, api, github;
before(async () => { ({ format, api, github } = await loadLibs()); });

describe('tower/app: api - the feed adapter', () => {
  // The one translation the runtime leans on: the tower's four-key result
  // shape into the framework poller's fetcher contract (resolve with the body,
  // throw carrying `.code`).
  test('a good answer resolves with the body, untouched', () => {
    const data = { rows: [1, 2, 3] };
    expect(api.unwrapFeed({ ok: true, data, status: 200, reason: null }), 'the body passes through by reference').toBe(data);
  });

  test('a failed answer throws the reason with the status as its code', () => {
    let thrown = null;
    try {
      api.unwrapFeed({ ok: false, data: null, status: 502, reason: '/api/board answered 502' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown && thrown.message, 'the reason is the message').toBe('/api/board answered 502');
    expect(thrown && thrown.code, 'and the status rides as .code').toBe(502);
  });

  test('a transport failure keeps its null status', () => {
    let thrown = null;
    try {
      api.unwrapFeed({ ok: false, data: null, status: null, reason: 'did not answer' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown && thrown.code, 'no HTTP status means a null code, not 0 or undefined').toBe(null);
  });

  test('the fetcher composes fetchFeed and the unwrap, both ways', async () => {
    // Node ships its own global fetch and the suites share one process -
    // restore it, never delete it.
    const realFetch = globalThis.fetch;
    let body;
    let thrown = null;
    try {
      globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ rows: [] }) });
      body = await api.feedFetcher('/api/board');

      // A body that reports its own failure (`ok: false`) throws with its reason.
      globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: false, reason: 'gh is not logged in' }) });
      try {
        await api.feedFetcher('/api/board');
      } catch (error) {
        thrown = error;
      }
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(JSON.stringify(body), 'a 200 with JSON resolves with the body').toBe('{"rows":[]}');
    expect(thrown && thrown.message, 'the body\'s own sentence survives the translation').toBe('gh is not logged in');
    expect(thrown && thrown.code, 'with the HTTP status it arrived under').toBe(200);
  });
});

describe('tower/app: api - live versus published', () => {
  test('an origin is taken from the query first, then the console hatch', () => {
    expect(api.apiOverride('http://tower.example/board?api=http://box:8693/', {}), 'the query wins, trailing slash trimmed').toBe('http://box:8693');
    expect(api.apiOverride('http://tower.example/board', { TOWER_API: 'http://box:8693' }), 'the console override when there is no query').toBe('http://box:8693');
    expect(api.apiOverride('http://tower.example/board?api=http://a', { TOWER_API: 'http://b' }), 'the query outranks it').toBe('http://a');
    expect(api.apiOverride('http://tower.example/board', {}), 'and nothing supplied is no origin, never undefined').toBe('');
    expect(api.apiOverride('http://tower.example/board', { TOWER_API: '' }), 'an empty override is no override').toBe('');
  });

  test('a production build with no origin supplied is published', () => {
    expect(api.decideLive('production', ''), 'nothing to read').toBe(false);
  });

  test('an origin supplied to a production build outranks the build', () => {
    expect(api.decideLive('production', 'http://box:8693'), '?api= runs it fully live').toBe(true);
  });

  test('a development build is live whatever else is true', () => {
    expect(api.decideLive('development', ''), 'the local tower is the default origin').toBe(true);
    expect(api.decideLive('development', 'http://box:8693'), 'and an override does not change the mode').toBe(true);
  });

  test('a page with no build snapshot baked into it is published, not live', () => {
    // Anything that is not the word development is published, and a page with
    // no snapshot at all names no environment.
    expect(api.decideLive('', ''), 'no environment at all').toBe(false);
    expect(api.decideLive(undefined, ''), 'and no key at all').toBe(false);
    expect(api.LIVE, 'which is what the module itself decided under the stubs above').toBe(false);
  });

  test('the environment is read off the build snapshot the framework bakes in (#292)', async () => {
    // Omega bakes one snapshot into every page, `window.OMEGA_BUILD_JSON`, and its
    // `config.environment` is the build's verdict. The read happens at import, so
    // each world gets a fresh module instance through a cache-busting query.
    const boot = async (world, tag) => {
      globalThis.location = { href: 'http://localhost:4300/board' };
      globalThis.window = world;
      const fresh = await import(`${pathToFileURL(path.join(libs, 'api.js')).href}?env=${tag}`);
      delete globalThis.location;
      delete globalThis.window;
      return fresh;
    };
    const dev = await boot({ OMEGA_BUILD_JSON: { config: { environment: 'development' } } }, 'dev');
    expect(dev.LIVE, 'a dev page has a tower to read').toBe(true);
    const built = await boot({ OMEGA_BUILD_JSON: { config: { environment: 'production' } } }, 'prod');
    expect(built.LIVE, 'a production page is a published copy').toBe(false);
    const old = await boot({ Configuration: { environment: 'development' } }, 'old');
    expect(old.LIVE, 'and the global the framework no longer writes counts for nothing').toBe(false);
  });

  test('a published page arms no feeds at all - zero doomed requests', () => {
    // The runtime gates on `LIVE`, never on the size of this table: a live page
    // is allowed to declare no feeds, and must not be mistaken for a published
    // one. The table is emptied here as well so that nothing is armed even if a
    // caller reaches it in published mode.
    expect(Object.keys(api.pageFeeds(['repos', 'board'], false)).length, 'nothing for the poller to poll').toBe(0);
    expect(Object.keys(api.pageFeeds([], true)).length, 'and a live page declaring none is empty too - which is why the mode is read from the flag').toBe(0);
  });

  test('a live page arms exactly the feeds it asked for, each with its path', () => {
    const feeds = api.pageFeeds(['repos', 'board'], true);
    expect(Object.keys(feeds).join(','), 'those two').toBe('repos,board');
    expect(feeds.board.path, 'with the API path written here and nowhere else').toBe('/api/board');
    expect(feeds.board.every, 'and the board\'s slower cadence - a gh sweep is expensive').toBe(60000);
  });
});

describe('tower/app: api - the board’s drop, as a payload', () => {
  const CARD = { repo: 'ITW/workkit', number: 48, status: 'specced' };

  test('a drop on another column becomes the endpoint’s four fields', () => {
    expect(JSON.stringify(api.moveRequest(CARD, 'blocked', true)), 'where it came from rides along - the move removes one label and adds the other').toBe('{"repo":"ITW/workkit","number":48,"from":"specced","to":"blocked"}');
  });

  test('the seven columns that are a status are the only ones a card moves between', () => {
    expect(api.MOVABLE_STATUSES.join(','), 'the pipeline, from the column list itself').toBe('inbox,specced,building,qa,complete,blocked,backlog');
    expect(api.moveRequest(CARD, '', true), 'the absence of a label is not a destination - nothing on the board names it').toBe(null);
    expect(api.moveRequest({ ...CARD, status: null }, 'inbox', true), 'and an issue triage has not reached has no label to remove').toBe(null);
    expect(api.moveRequest(CARD, 'shipped', true), 'a status the pipeline does not name is not one').toBe(null);
  });

  test('a drop on the column the card is already in is not a move', () => {
    expect(api.moveRequest(CARD, 'specced', true), 'nothing to write').toBe(null);
  });

  test('starting work is a drop like any other - specced to building is a payload', () => {
    expect(JSON.stringify(api.moveRequest(CARD, 'building', true)), 'the flip that puts an issue in flight').toBe('{"repo":"ITW/workkit","number":48,"from":"specced","to":"building"}');
    expect(JSON.stringify(api.moveRequest({ ...CARD, status: 'building' }, 'blocked', true)), 'and a card leaves the Building column the same way').toBe('{"repo":"ITW/workkit","number":48,"from":"building","to":"blocked"}');
  });

  test('a LOCKED copy produces no move at all - a write needs the token it has not been given', () => {
    expect(api.moveRequest(CARD, 'blocked', false), 'the gate is the payload’s, so no page can forget it').toBe(null);
    expect(api.moveRequest(CARD, 'blocked'), 'and the default is the module’s own mode, which is locked under these stubs').toBe(null);
    expect(api.WRITABLE, 'which is exactly what WRITABLE says').toBe(false);
    expect(!api.LIVE, 'and it is not the tower question - a published copy with a token writes too').toBeTruthy();
  });

  test('a drop carrying no issue is nothing, never a request with holes in it', () => {
    expect(api.moveRequest(null, 'blocked', true), 'a key the paint no longer knows').toBe(null);
  });

  test('the move is POSTed to the status endpoint as JSON - the page names no URL', async () => {
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
    expect(seen.url, 'the one path, written in api.js and nowhere else').toBe(`${api.API_BASE}/api/issues/status`);
    expect(seen.options.method, 'a write').toBe('POST');
    expect(JSON.parse(seen.options.body).to, 'carrying the move').toBe('blocked');
    expect(answer.ok, 'and the answer arrives in the tower’s own result shape').toBe(true);
  });

  test('the intake dialog is inert only where it has nothing to write with', () => {
    // A locked copy off this machine needs a token, not a tower, so the notice
    // sends the one viewer who can fix it to the right thing. An unlocked copy
    // files with the token it reads with; on localhost the tower is the answer.
    expect(format.LOCKED_NOTICE.includes('token'), 'the locked sentence asks for the token').toBeTruthy();
    expect(!format.LOCKED_NOTICE.includes('npm run tower'), 'and does not send a viewer to install a tower').toBeTruthy();
  });
});

describe('tower/app: api - the three modes', () => {
  test('a tower outranks everything, and the token decides the rest', () => {
    expect(api.decideMode('development', '', false), 'a dev build reads the machine’s API').toBe('tower');
    expect(api.decideMode('production', 'http://box:8693', false), 'and so does any build pointed at one').toBe('tower');
    expect(api.decideMode('production', '', true), 'a published copy with a token reads GitHub itself').toBe('github');
    expect(api.decideMode('production', '', false), 'and without one it has nothing to show but the prompt').toBe('locked');
    expect(api.MODE, 'which is what the module itself decided under the stubs above').toBe('locked');
    expect(api.LIVE, 'LIVE stays the question of a TOWER - WRITABLE is the flag every write gates on').toBe(false);
  });

  test('a landing carrying setup’s handover boots as a copy holding a token (#230)', async () => {
    // Read off the module rather than `decideMode`: the fragment is banked at
    // import, before the storage the mode reads. A module URL evaluates once per
    // process, so this import carries a cache-busting query.
    const storage = mkStorage();
    const rewrites = [];
    const where = { href: 'https://alice.github.io/workkit/settings#token=gho_FAKE', hash: '#token=gho_FAKE', pathname: '/workkit/settings', search: '' };
    globalThis.location = where;
    globalThis.window = { location: where, history: { replaceState: (state, title, url) => rewrites.push(url) }, localStorage: storage };
    const handed = await import(`${pathToFileURL(path.join(libs, 'api.js')).href}?handover=1`);
    delete globalThis.location;
    delete globalThis.window;

    expect(storage.held[github.TOKEN_KEY], 'the fragment was banked while the module loaded').toBe('gho_FAKE');
    expect(handed.MODE, 'so the copy that lands with one boots unlocked rather than locked').toBe('github');
    expect(handed.WRITABLE, 'and writes with it, exactly as a typed token does').toBe(true);
    expect(rewrites.join(','), 'with the fragment stripped off the project-path URL it arrived on').toBe('/workkit/settings');
  });

  test('a published page arms only the feeds GitHub can answer', () => {
    const feeds = api.githubPageFeeds(['repos', 'board', 'sessions', 'health', 'telemetry']);
    expect(Object.keys(feeds).join(','), 'the machine-bound three are simply absent').toBe('repos,board');
    expect(feeds.board.every, 'and the sweep keeps the board’s cadence - a GraphQL sweep is expensive').toBe(60000);
    expect(Object.keys(api.githubPageFeeds(['brief'])).join(','), 'the brief is one of the three it can').toBe('brief');
  });
});
