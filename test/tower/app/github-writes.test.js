//
// Tests for the tower dashboard's github.js: the two writes (the drag's relabel
// and the intake's filing). Shared prologue: ./helpers.js.
//

const { describe, before, test, expect } = require('../../lib/harness');
const { loadLibs, mkFetch, jsonResponse, isRoster, mkSiteFetch } = require('./helpers');
const {
  WITH_CONTRACT, WITHOUT_CONTRACT, SMALL_ITEM, SMALL_ITEM_PADDED, NO_SPEC, contractReason, noSpecReason,
} = require('../spec-bodies');

describe('tower/app: github - the two writes', () => {
  let github;
  before(async () => { ({ github } = await loadLibs()); });

  test('the browser writes the endpoint’s own move - the old status off, the new one on, nothing else touched', () => {
    expect(github.nextLabels([{ name: 'status:specced' }, { name: 'type:enhancement' }, { name: 'priority:high' }], 'specced', 'building').join(','), 'every label that is not the status survives the move').toBe('type:enhancement,priority:high,status:building');
    expect(github.nextLabels(['status:building'], 'building', 'blocked').join(','), 'the one status is replaced, never doubled').toBe('status:blocked');
    expect(github.nextLabels(['type:bug', 'status:blocked'], 'building', 'blocked').join(','), 'a destination already carried is not added twice').toBe('type:bug,status:blocked');
    expect(github.nextLabels(null, 'specced', 'building').join(','), 'an issue answering with no labels still lands on its column').toBe('status:building');
  });

  test('a move is one PATCH of the issue, with the viewer’s token as the whole of the auth', async () => {
    const fetchImpl = mkFetch((url, options) => ((options && options.method) === 'PATCH'
      ? jsonResponse(200, { number: 48 })
      : jsonResponse(200, { number: 48, labels: [{ name: 'status:specced' }, { name: 'type:enhancement' }] })));
    const answer = await github.moveIssueStatus({
      repo: 'ITW/workkit', number: 48, from: 'specced', to: 'building',
    }, { token: 'fake-token-for-tests', fetch: fetchImpl });

    expect(fetchImpl.calls.length, 'the labels the issue carries now, then the one write').toBe(2);
    expect(fetchImpl.calls[0].url, 'read from the issue itself - the board’s copy is up to a minute old').toBe('https://api.github.com/repos/ITW/workkit/issues/48');
    expect(fetchImpl.calls[0].options.method, 'a read').toBe('GET');
    expect(fetchImpl.calls[0].options.cache, 'never answered from the browser’s cache - a gate judges what the issue says now').toBe('no-store');
    expect(fetchImpl.calls[1].url, 'and the write is the same resource').toBe('https://api.github.com/repos/ITW/workkit/issues/48');
    expect(fetchImpl.calls[1].options.method, 'one call, so the issue is never unlabelled nor twice-labelled').toBe('PATCH');
    expect(fetchImpl.calls[1].options.headers.authorization, 'the token is the whole of the auth').toBe('Bearer fake-token-for-tests');
    expect(JSON.parse(fetchImpl.calls[1].options.body).labels.join(','), 'carrying the set the move leaves behind').toBe('type:enhancement,status:building');
    expect(answer.ok, 'and the answer is the tower’s own result shape').toBe(true);
    expect(answer.data.status, 'naming where the card landed').toBe('building');
  });

  test('a write with no token reaches GitHub not at all', async () => {
    const fetchImpl = mkFetch(() => { throw new Error('a request was made'); });
    const move = await github.moveIssueStatus({ repo: 'o/r', number: 1, from: 'inbox', to: 'specced' }, { token: '', fetch: fetchImpl });
    const filed = await github.createIssue({ repo: 'o/r', title: 'x' }, { token: '', fetch: fetchImpl });
    expect(fetchImpl.calls.length, 'neither write left the browser').toBe(0);
    expect(/no GitHub token/.test(move.reason), `the move says which failure it is, got: ${move.reason}`).toBeTruthy();
    expect(/no GitHub token/.test(filed.reason), `and so does the filing, got: ${filed.reason}`).toBeTruthy();
  });

  test('a token that can only read is told so in words, and reads as a refusal', async () => {
    // A read-only token gets through the move's read and is refused on its write.
    const forbidden = mkFetch((url, options) => ((options && options.method) === 'PATCH'
      ? jsonResponse(403, { message: 'Resource not accessible by personal access token' })
      : jsonResponse(200, { number: 1, labels: [{ name: 'status:inbox' }] })));
    const answer = await github.moveIssueStatus({
      repo: 'o/r', number: 1, from: 'inbox', to: 'building',
    }, { token: 'read-only', fetch: forbidden });
    expect(answer.ok, 'the move did not land').toBe(false);
    expect(/write/i.test(answer.reason) && /Issues: Read and write/.test(answer.reason),
      `the viewer is told their token lacks write access and what to make instead, got: ${answer.reason}`).toBeTruthy();
    expect(github.isTokenRefusal(answer), 'and a refused write is a token refusal like a refused read').toBeTruthy();

    const expired = await github.createIssue({ repo: 'owner/workkit', title: 'x' }, {
      token: 'expired',
      fetch: mkFetch((url) => {
        if (url === 'data/home.json') return jsonResponse(200, { home: 'owner/workkit' });
        if (isRoster(url)) return jsonResponse(200, { repos: ['owner/workkit'], home: 'owner/workkit' });
        return jsonResponse(401, { message: 'Bad credentials' });
      }),
    });
    expect(/expired/.test(expired.reason), `a 401 is the other story - the token itself, got: ${expired.reason}`).toBeTruthy();
    expect(github.isTokenRefusal(expired), 'which the runtime answers with the prompt').toBeTruthy();
  });

  test('a move GitHub would not accept leaves the board’s card where it was, with the reason', async () => {
    const gone = await github.moveIssueStatus({ repo: 'o/r', number: 9, from: 'inbox', to: 'specced' }, {
      token: 't', fetch: mkFetch(jsonResponse(404, { message: 'Not Found' })),
    });
    expect(gone.ok, 'the read of the issue failed, so nothing was written').toBe(false);
    expect(/404/.test(gone.reason) && /Not Found/.test(gone.reason), `GitHub’s own sentence survives, got: ${gone.reason}`).toBeTruthy();
  });

  test('a refused read is told in read words, and a refused write in write words', async () => {
    const blindRead = mkFetch((url, options) => ((options && options.method) === 'PATCH'
      ? jsonResponse(200, { number: 1 })
      : jsonResponse(403, { message: 'Resource not accessible by personal access token' })));
    const unseen = await github.moveIssueStatus({
      repo: 'o/r', number: 1, from: 'inbox', to: 'specced',
    }, { token: 'wrong-repos', fetch: blindRead });
    expect(blindRead.calls.length, 'a move that cannot read the issue never reaches the write').toBe(1);
    expect(/read/i.test(unseen.reason) && !/Issues: Read and write/.test(unseen.reason),
      `a token that cannot SEE the repository is not sent after write access, got: ${unseen.reason}`).toBeTruthy();

    const blindWrite = mkFetch((url, options) => ((options && options.method) === 'PATCH'
      ? jsonResponse(403, { message: 'Resource not accessible by personal access token' })
      : jsonResponse(200, { number: 1, labels: [{ name: 'status:inbox' }] })));
    const refused = await github.moveIssueStatus({
      repo: 'o/r', number: 1, from: 'inbox', to: 'building',
    }, { token: 'read-only', fetch: blindWrite });
    expect(/Issues: Read and write/.test(refused.reason), `and the write leg names the permission it wants, got: ${refused.reason}`).toBeTruthy();
  });

  test('a read that answers without labels is not a base to write from', async () => {
    // 200 with a body that will not parse: `rest` answers ok with null data, and
    // relabelling off nothing would PATCH away every label the issue carries.
    const fetchImpl = mkFetch((url, options) => ((options && options.method) === 'PATCH'
      ? jsonResponse(200, { number: 48 })
      : { ok: true, status: 200, json: async () => { throw new Error('Unexpected end of JSON input'); } }));
    const answer = await github.moveIssueStatus({
      repo: 'o/r', number: 48, from: 'specced', to: 'building',
    }, { token: 't', fetch: fetchImpl });
    expect(fetchImpl.calls.length, 'the read happened and the write did not').toBe(1);
    expect(answer.ok, 'and the move says it did not land').toBe(false);
    expect(/labels/.test(answer.reason) && /nothing was changed/.test(answer.reason),
      `the viewer is told what was missing and that the issue is untouched, got: ${answer.reason}`).toBeTruthy();
  });

  test('a move refuses what the endpoint refuses, before anything is read', async () => {
    const fetchImpl = mkFetch(() => { throw new Error('a request was made'); });
    const refuse = async (move) => github.moveIssueStatus(move, { token: 't', fetch: fetchImpl });
    const ok = { repo: 'o/r', number: 1, from: 'inbox', to: 'specced' };

    expect(/nothing to move/.test((await refuse(null)).reason), 'no move at all').toBeTruthy();
    expect(/positive integer/.test((await refuse({ ...ok, number: '1' })).reason), 'a number that is not one').toBeTruthy();
    expect(/positive integer/.test((await refuse({ ...ok, number: 0 })).reason), 'and one that is not positive').toBeTruthy();
    expect(/not a repository slug: r/.test((await refuse({ ...ok, repo: 'r' })).reason), 'a repo that is not a slug').toBeTruthy();
    expect(/from is not a status: nowhere/.test((await refuse({ ...ok, from: 'nowhere' })).reason), 'a status the vocabulary does not define').toBeTruthy();
    expect(/to is not a status: \(none\)/.test((await refuse({ ...ok, to: '' })).reason), 'and a destination that is blank').toBeTruthy();
    expect(/already status:inbox/.test((await refuse({ ...ok, to: 'inbox' })).reason), 'a move to where the issue already is').toBeTruthy();
    expect(fetchImpl.calls.length, 'and every refusal came before GitHub was read at all').toBe(0);
  });

  // The proof gate on the drag: Complete is a column a card has to prove
  // itself into, and the published copy refuses it in the browser, before the
  // PATCH, as the endpoint and the two hooks do.
  const COMMENTS_URL = 'https://api.github.com/repos/o/r/issues/48/comments?per_page=100';

  test('a move to Complete reads the issue’s comments first, and is refused without a Proof: line', async () => {
    const fetchImpl = mkFetch((url) => (url === COMMENTS_URL
      ? jsonResponse(200, [{ body: 'looks good' }, { body: 'proof: lowercase is not the line' }])
      : jsonResponse(200, { number: 48, labels: [{ name: 'status:qa' }] })));
    const answer = await github.moveIssueStatus({
      repo: 'o/r', number: 48, from: 'qa', to: 'complete',
    }, { token: 'fake-token-for-tests', fetch: fetchImpl });

    expect(fetchImpl.calls.length, 'the comments were read and nothing else was - no read of the issue, no PATCH').toBe(1);
    expect(fetchImpl.calls[0].url, 'one page of comments is the whole read').toBe(COMMENTS_URL);
    expect(answer.ok, 'the move was refused in the browser').toBe(false);
    expect(/no comment whose line starts with "Proof:"/.test(answer.reason), `naming what is missing, got: ${answer.reason}`).toBeTruthy();
    expect(/Park it with a Proof: comment first/.test(answer.reason), 'and the fix that exists').toBeTruthy();

    // A read that fails is a refusal too, never a pass: the gate cannot ask.
    const blind = mkFetch(jsonResponse(404, { message: 'Not Found' }));
    const unreadable = await github.moveIssueStatus({
      repo: 'o/r', number: 48, from: 'qa', to: 'complete',
    }, { token: 't', fetch: blind });
    expect(blind.calls.length, 'and it stopped there').toBe(1);
    expect(/could not be read/.test(unreadable.reason), `saying the proof could not be read, got: ${unreadable.reason}`).toBeTruthy();
  });

  test('a Proof: line opening any line of any comment lets that same move through', async () => {
    const fetchImpl = mkFetch((url, options) => {
      if (url === COMMENTS_URL) return jsonResponse(200, [{ body: 'parked at qa.\n  Proof:\n- unit: node tests/tower/app.test.js' }]);
      return (options && options.method) === 'PATCH'
        ? jsonResponse(200, { number: 48 })
        : jsonResponse(200, { number: 48, labels: [{ name: 'status:qa' }, { name: 'type:bug' }] });
    });
    const answer = await github.moveIssueStatus({
      repo: 'o/r', number: 48, from: 'qa', to: 'complete',
    }, { token: 'fake-token-for-tests', fetch: fetchImpl });

    expect(fetchImpl.calls.length, 'the proof, then the labels the issue carries now, then the one write').toBe(3);
    expect(fetchImpl.calls[2].options.method, 'the write the gate let through').toBe('PATCH');
    expect(JSON.parse(fetchImpl.calls[2].options.body).labels.join(','), 'landing on Complete with its other labels intact').toBe('type:bug,status:complete');
    expect(answer.ok, 'and the move landed').toBe(true);
    expect(answer.data.status, 'on the column it was dropped on').toBe('complete');
  });

  test('a move to any column but Complete or Specced reads no comments at all', async () => {
    for (const to of ['building', 'qa', 'blocked', 'backlog']) {
      const fetchImpl = mkFetch((url, options) => ((options && options.method) === 'PATCH'
        ? jsonResponse(200, { number: 48 })
        : jsonResponse(200, { number: 48, labels: [{ name: 'status:inbox' }] })));
      const answer = await github.moveIssueStatus({
        repo: 'o/r', number: 48, from: 'inbox', to,
      }, { token: 't', fetch: fetchImpl });
      expect(answer.ok, `a move to ${to} is not a gated one, and an issue with no body still moves`).toBe(true);
      expect(fetchImpl.calls.length, `the read and the write for ${to}, as before either gate existed`).toBe(2);
      expect(!fetchImpl.calls.some((call) => call.url.includes('/comments')), 'only the flip to Complete pays for the proof read').toBeTruthy();
    }
  });

  // The Spec gate on the drag: Specced is the second column a card has to prove
  // itself into. The issue read the move already makes carries the body, so the
  // gate costs no request, and the refusal comes before the PATCH.
  const ISSUE_URL = 'https://api.github.com/repos/o/r/issues/48';

  const CONTRACT_REASON = contractReason(48);
  const NO_SPEC_REASON = noSpecReason(48);

  /** A move to Specced against an issue whose read answers `body`. */
  const moveToSpecced = async (body) => {
    const fetchImpl = mkFetch((url, options) => ((options && options.method) === 'PATCH'
      ? jsonResponse(200, { number: 48 })
      : jsonResponse(200, { number: 48, labels: [{ name: 'status:inbox' }, { name: 'type:enhancement' }], body })));
    const answer = await github.moveIssueStatus({
      repo: 'o/r', number: 48, from: 'inbox', to: 'specced',
    }, { token: 'fake-token-for-tests', fetch: fetchImpl });
    return { answer, calls: fetchImpl.calls };
  };

  test('a move to Specced whose Spec holds a ### Contract is the read and the write, nothing more', async () => {
    const { answer, calls } = await moveToSpecced(WITH_CONTRACT);
    expect(calls.length, 'no extra request - the issue read carries the body the gate judges').toBe(2);
    expect(calls[0].url, 'the read is the issue itself').toBe(ISSUE_URL);
    expect(calls[0].options.method, 'a read').toBe('GET');
    expect(calls[1].options.method, 'then the write the gate let through').toBe('PATCH');
    expect(JSON.parse(calls[1].options.body).labels.join(','), 'landing on Specced with its other labels intact').toBe('type:enhancement,status:specced');
    expect(answer.ok, 'the Spec carries its Contract, past a fenced ## line').toBe(true);
    expect(answer.data.status, 'on the column it was dropped on').toBe('specced');
  });

  test('a move to Specced whose Spec is exactly the small-item line goes through, as on the endpoint', async () => {
    const { answer, calls } = await moveToSpecced(SMALL_ITEM);
    expect(answer.ok, 'None needed: small item. is a whole Spec').toBe(true);
    expect(calls.length, 'the read and the write').toBe(2);
    expect(calls[1].options.method, 'and the write happened').toBe('PATCH');
  });

  test('a small-item Spec saved with CRLF line ends and a padded line goes through, as on the endpoint', async () => {
    const { answer, calls } = await moveToSpecced(SMALL_ITEM_PADDED);
    expect(answer.ok, 'the line is judged trimmed, CRLF read as LF').toBe(true);
    expect(calls.length, 'the read and the write').toBe(2);
  });

  test('a move to Specced whose Spec has no ### Contract is refused after the read, before any PATCH', async () => {
    const { answer, calls } = await moveToSpecced(WITHOUT_CONTRACT);
    expect(calls.length, 'the issue was read and nothing was written').toBe(1);
    expect(calls[0].options.method, 'the one call is the read').toBe('GET');
    expect(answer.ok, 'refused in the browser - a Contract outside the Spec does not count').toBe(false);
    expect(answer.data, 'with no data, the refusal shape').toBe(null);
    expect(answer.reason, 'in the endpoint’s own words').toBe(CONTRACT_REASON);
  });

  test('a move to Specced on an issue with no ## Spec is refused after the read, before any PATCH', async () => {
    const { answer, calls } = await moveToSpecced(NO_SPEC);
    expect(calls.length, 'the issue was read and nothing was written').toBe(1);
    expect(answer.ok, 'nothing to be specced on').toBe(false);
    expect(answer.data, 'with no data, the refusal shape').toBe(null);
    expect(answer.reason, 'in the endpoint’s own words').toBe(NO_SPEC_REASON);
  });

  test('intake files the issue the endpoint files - same labels, same default body', async () => {
    const fetchImpl = mkSiteFetch({ repos: ['owner/workkit'], home: 'owner/workkit' },
      { html_url: 'https://github.com/owner/workkit/issues/12' });
    const answer = await github.createIssue({ repo: 'OWNER/Workkit', title: '  a thought  ', body: '' }, { token: 'fake-token-for-tests', fetch: fetchImpl });

    const call = fetchImpl.calls[2];
    expect(call.url, 'filed under the ROSTER’s spelling, as the endpoint does').toBe('https://api.github.com/repos/owner/workkit/issues');
    expect(call.options.method, 'a create').toBe('POST');
    expect(call.options.headers.authorization, 'with the viewer’s token').toBe('Bearer fake-token-for-tests');
    const sent = JSON.parse(call.options.body);
    expect(sent.title, 'the title, trimmed').toBe('a thought');
    expect(sent.body, 'and the endpoint’s own default where a body was not typed').toBe(github.DEFAULT_BODY);
    expect(sent.labels.join(','), 'captured, and typed as an idea until triage says otherwise').toBe('status:inbox,type:idea');
    expect(answer.ok, 'answered').toBe(true);
    expect(answer.data.url, 'and the dialog gets the URL to link').toBe('https://github.com/owner/workkit/issues/12');
  });

  test('intake refuses what the endpoint refuses, before anything is filed', async () => {
    const fetchImpl = mkSiteFetch({ repos: ['owner/workkit'], home: 'owner/workkit' },
      { html_url: 'https://github.com/owner/workkit/issues/12' });
    const refuse = async (payload) => github.createIssue(payload, { token: 't', fetch: fetchImpl });

    expect(/unknown repo: owner\/other/.test((await refuse({ repo: 'owner/other', title: 'x' })).reason), 'a repo this site does not sweep').toBeTruthy();
    expect(/title is required/.test((await refuse({ repo: 'owner/workkit', title: '   ' })).reason), 'a blank title').toBeTruthy();
    expect(/longer than 256/.test((await refuse({ repo: 'owner/workkit', title: 'x'.repeat(257) })).reason), 'a title past the cap').toBeTruthy();
    expect(/longer than 4000/.test((await refuse({ repo: 'owner/workkit', title: 'x', body: 'b'.repeat(4001) })).reason), 'a body past it').toBeTruthy();
    expect(fetchImpl.calls.every((call) => call.url === 'data/home.json' || isRoster(call.url)),
      'and every refusal came before GitHub was written to').toBeTruthy();
  });
});
