//
// Tests for the tower dashboard's github.js: the two writes (the drag's relabel
// and the intake's filing).
// The shared prologue (the lib loader, the fetch stubs, the fixtures) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { loadLibs, mkFetch, jsonResponse, isRoster, mkSiteFetch } = require('./helpers');

const run = async () => {
  const { github } = await loadLibs();

  group('tower/app: github - the two writes');

  // The tower's own source is the reference for both writes: the published site
  // must relabel and file exactly what the endpoint on the machine does, and
  // the two live on opposite sides of the copy boundary (issue #77). The
  // endpoint's source is the whole set: server.js and every piece in server/.
  const apiDir = path.join(__dirname, '..', '..', '..', 'tower', 'api');
  const serverSrc = [path.join(apiDir, 'server.js')]
    .concat(fs.readdirSync(path.join(apiDir, 'server')).filter((name) => name.endsWith('.js')).sort().map((name) => path.join(apiDir, 'server', name)))
    .map((file) => fs.readFileSync(file, 'utf8')).join('\n');

  await test('the browser writes the endpoint’s own move - the old status off, the new one on, nothing else touched', () => {
    assertEq(
      github.nextLabels([{ name: 'status:specced' }, { name: 'type:enhancement' }, { name: 'priority:high' }], 'specced', 'building').join(','),
      'type:enhancement,priority:high,status:building',
      'every label that is not the status survives the move',
    );
    assertEq(github.nextLabels(['status:building'], 'building', 'blocked').join(','), 'status:blocked', 'the one status is replaced, never doubled');
    assertEq(github.nextLabels(['type:bug', 'status:blocked'], 'building', 'blocked').join(','), 'type:bug,status:blocked', 'a destination already carried is not added twice');
    assertEq(github.nextLabels(null, 'specced', 'building').join(','), 'status:building', 'an issue answering with no labels still lands on its column');
    // The semantics are the endpoint's, and this is where the two are held together.
    assert(/--remove-label', `status:\$\{checked\.from\}`/.test(serverSrc), 'the tower removes the from label');
    assert(/--add-label', `status:\$\{checked\.to\}`/.test(serverSrc), 'and adds the to label, in one call');
  });

  await test('a move is one PATCH of the issue, with the viewer’s token as the whole of the auth', async () => {
    const fetchImpl = mkFetch((url, options) => ((options && options.method) === 'PATCH'
      ? jsonResponse(200, { number: 48 })
      : jsonResponse(200, { number: 48, labels: [{ name: 'status:specced' }, { name: 'type:enhancement' }] })));
    const answer = await github.moveIssueStatus({
      repo: 'ITW/workkit', number: 48, from: 'specced', to: 'building',
    }, { token: 'fake-token-for-tests', fetch: fetchImpl });

    assertEq(fetchImpl.calls.length, 2, 'the labels the issue carries now, then the one write');
    assertEq(fetchImpl.calls[0].url, 'https://api.github.com/repos/ITW/workkit/issues/48', 'read from the issue itself - the board’s copy is up to a minute old');
    assertEq(fetchImpl.calls[0].options.method, 'GET', 'a read');
    assertEq(fetchImpl.calls[1].url, 'https://api.github.com/repos/ITW/workkit/issues/48', 'and the write is the same resource');
    assertEq(fetchImpl.calls[1].options.method, 'PATCH', 'one call, so the issue is never unlabelled nor twice-labelled');
    assertEq(fetchImpl.calls[1].options.headers.authorization, 'Bearer fake-token-for-tests', 'the token is the whole of the auth');
    assertEq(JSON.parse(fetchImpl.calls[1].options.body).labels.join(','), 'type:enhancement,status:building', 'carrying the set the move leaves behind');
    assertEq(answer.ok, true, 'and the answer is the tower’s own result shape');
    assertEq(answer.data.status, 'building', 'naming where the card landed');
  });

  await test('a write with no token reaches GitHub not at all', async () => {
    const fetchImpl = mkFetch(() => { throw new Error('a request was made'); });
    const move = await github.moveIssueStatus({ repo: 'o/r', number: 1, from: 'inbox', to: 'specced' }, { token: '', fetch: fetchImpl });
    const filed = await github.createIssue({ repo: 'o/r', title: 'x' }, { token: '', fetch: fetchImpl });
    assertEq(fetchImpl.calls.length, 0, 'neither write left the browser');
    assert(/no GitHub token/.test(move.reason), `the move says which failure it is, got: ${move.reason}`);
    assert(/no GitHub token/.test(filed.reason), `and so does the filing, got: ${filed.reason}`);
  });

  await test('a token that can only read is told so in words, and reads as a refusal', async () => {
    // A read-only token gets through the move's READ and is refused on its write.
    const forbidden = mkFetch((url, options) => ((options && options.method) === 'PATCH'
      ? jsonResponse(403, { message: 'Resource not accessible by personal access token' })
      : jsonResponse(200, { number: 1, labels: [{ name: 'status:inbox' }] })));
    const answer = await github.moveIssueStatus({
      repo: 'o/r', number: 1, from: 'inbox', to: 'specced',
    }, { token: 'read-only', fetch: forbidden });
    assertEq(answer.ok, false, 'the move did not land');
    assert(/write/i.test(answer.reason) && /Issues: Read and write/.test(answer.reason),
      `the viewer is told their token lacks write access and what to make instead, got: ${answer.reason}`);
    assert(github.isTokenRefusal(answer), 'and a refused write is a token refusal like a refused read');

    const expired = await github.createIssue({ repo: 'owner/workkit', title: 'x' }, {
      token: 'expired',
      fetch: mkFetch((url) => {
        if (url === 'data/home.json') return jsonResponse(200, { home: 'owner/workkit' });
        if (isRoster(url)) return jsonResponse(200, { repos: ['owner/workkit'], home: 'owner/workkit' });
        return jsonResponse(401, { message: 'Bad credentials' });
      }),
    });
    assert(/expired/.test(expired.reason), `a 401 is the other story - the token itself, got: ${expired.reason}`);
    assert(github.isTokenRefusal(expired), 'which the runtime answers with the prompt');
  });

  await test('a move GitHub would not accept leaves the board’s card where it was, with the reason', async () => {
    const gone = await github.moveIssueStatus({ repo: 'o/r', number: 9, from: 'inbox', to: 'specced' }, {
      token: 't', fetch: mkFetch(jsonResponse(404, { message: 'Not Found' })),
    });
    assertEq(gone.ok, false, 'the read of the issue failed, so nothing was written');
    assert(/404/.test(gone.reason) && /Not Found/.test(gone.reason), `GitHub’s own sentence survives, got: ${gone.reason}`);
  });

  await test('a refused read is told in read words, and a refused write in write words', async () => {
    const blindRead = mkFetch((url, options) => ((options && options.method) === 'PATCH'
      ? jsonResponse(200, { number: 1 })
      : jsonResponse(403, { message: 'Resource not accessible by personal access token' })));
    const unseen = await github.moveIssueStatus({
      repo: 'o/r', number: 1, from: 'inbox', to: 'specced',
    }, { token: 'wrong-repos', fetch: blindRead });
    assertEq(blindRead.calls.length, 1, 'a move that cannot read the issue never reaches the write');
    assert(/read/i.test(unseen.reason) && !/Issues: Read and write/.test(unseen.reason),
      `a token that cannot SEE the repository is not sent after write access, got: ${unseen.reason}`);

    const blindWrite = mkFetch((url, options) => ((options && options.method) === 'PATCH'
      ? jsonResponse(403, { message: 'Resource not accessible by personal access token' })
      : jsonResponse(200, { number: 1, labels: [{ name: 'status:inbox' }] })));
    const refused = await github.moveIssueStatus({
      repo: 'o/r', number: 1, from: 'inbox', to: 'specced',
    }, { token: 'read-only', fetch: blindWrite });
    assert(/Issues: Read and write/.test(refused.reason), `and the write leg names the permission it wants, got: ${refused.reason}`);
  });

  await test('a read that answers without labels is not a base to write from', async () => {
    // 200 with a body that will not parse: `rest` answers ok with null data, and
    // relabelling off nothing would PATCH away every label the issue carries.
    const fetchImpl = mkFetch((url, options) => ((options && options.method) === 'PATCH'
      ? jsonResponse(200, { number: 48 })
      : { ok: true, status: 200, json: async () => { throw new Error('Unexpected end of JSON input'); } }));
    const answer = await github.moveIssueStatus({
      repo: 'o/r', number: 48, from: 'specced', to: 'building',
    }, { token: 't', fetch: fetchImpl });
    assertEq(fetchImpl.calls.length, 1, 'the read happened and the write did not');
    assertEq(answer.ok, false, 'and the move says it did not land');
    assert(/labels/.test(answer.reason) && /nothing was changed/.test(answer.reason),
      `the viewer is told what was missing and that the issue is untouched, got: ${answer.reason}`);
  });

  await test('a move refuses what the endpoint refuses, before anything is read', async () => {
    const fetchImpl = mkFetch(() => { throw new Error('a request was made'); });
    const refuse = async (move) => github.moveIssueStatus(move, { token: 't', fetch: fetchImpl });
    const ok = { repo: 'o/r', number: 1, from: 'inbox', to: 'specced' };

    assert(/nothing to move/.test((await refuse(null)).reason), 'no move at all');
    assert(/positive integer/.test((await refuse({ ...ok, number: '1' })).reason), 'a number that is not one');
    assert(/positive integer/.test((await refuse({ ...ok, number: 0 })).reason), 'and one that is not positive');
    assert(/not a repository slug: r/.test((await refuse({ ...ok, repo: 'r' })).reason), 'a repo that is not a slug');
    assert(/from is not a status: nowhere/.test((await refuse({ ...ok, from: 'nowhere' })).reason), 'a status the vocabulary does not define');
    assert(/to is not a status: \(none\)/.test((await refuse({ ...ok, to: '' })).reason), 'and a destination that is blank');
    assert(/already status:inbox/.test((await refuse({ ...ok, to: 'inbox' })).reason), 'a move to where the issue already is');
    assertEq(fetchImpl.calls.length, 0, 'and every refusal came before GitHub was read at all');

    // The rules restated across the copy boundary, pinned to the endpoint that owns them.
    const statuses = Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'workflow', 'labels.json'), 'utf8')).groups.status.values);
    assertEq(github.MOVE_STATUSES.slice().sort().join(','), statuses.sort().join(','), 'the statuses a move may name are the vocabulary’s own');
    assert(serverSrc.includes('issue number must be a positive integer'), 'the number rule is the endpoint’s');
    assert(serverSrc.includes('not a repository slug:'), 'the slug rule is the endpoint’s');
    assert(serverSrc.includes('the issue is already status:'), 'and so is the refusal of a move that is not one');
  });

  // The proof gate on the drag (issue #236): Complete is the one column a card
  // has to prove itself into, and the published copy holds the same gate the
  // endpoint and the two hooks hold - refused in the browser, before the PATCH.
  const COMMENTS_URL = 'https://api.github.com/repos/o/r/issues/48/comments?per_page=100';

  await test('a move to Complete reads the issue’s comments first, and is refused without a Proof: line', async () => {
    const fetchImpl = mkFetch((url) => (url === COMMENTS_URL
      ? jsonResponse(200, [{ body: 'looks good' }, { body: 'proof: lowercase is not the line' }])
      : jsonResponse(200, { number: 48, labels: [{ name: 'status:qa' }] })));
    const answer = await github.moveIssueStatus({
      repo: 'o/r', number: 48, from: 'qa', to: 'complete',
    }, { token: 'fake-token-for-tests', fetch: fetchImpl });

    assertEq(fetchImpl.calls.length, 1, 'the comments were read and nothing else was - no read of the issue, no PATCH');
    assertEq(fetchImpl.calls[0].url, COMMENTS_URL, 'one page of comments is the whole read');
    assertEq(answer.ok, false, 'the move was refused in the browser');
    assert(/no comment whose line starts with "Proof:"/.test(answer.reason), `naming what is missing, got: ${answer.reason}`);
    assert(/Park it with a Proof: comment first/.test(answer.reason), 'and the fix that exists');

    // A read that FAILS is a refusal too, never a pass: the gate cannot ask.
    const blind = mkFetch(jsonResponse(404, { message: 'Not Found' }));
    const unreadable = await github.moveIssueStatus({
      repo: 'o/r', number: 48, from: 'qa', to: 'complete',
    }, { token: 't', fetch: blind });
    assertEq(blind.calls.length, 1, 'and it stopped there');
    assert(/could not be read/.test(unreadable.reason), `saying the proof could not be read, got: ${unreadable.reason}`);

    // The sentence and the pattern are the endpoint's, across the copy boundary.
    assert(serverSrc.includes('carries no comment whose line starts with "Proof:"'), 'the refusal is the endpoint’s own sentence');
    assert(serverSrc.includes('/(^|\\n)[ \\t]*Proof:/'), 'and the line it looks for is the endpoint’s own pattern');
    // The same pattern has a third home on the shell side, and the gated status
    // is a vocabulary word: both pinned, so a change to either cannot leave the
    // board and the hooks disagreeing with every test green (#236).
    const fs = require('fs');
    const libSrc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'hooks', 'lib', 'proof.sh'), 'utf8');
    assert(libSrc.includes('(^|\\n)[ \\t]*Proof:'), 'hooks/lib/proof.sh looks for the same line');
    const statusWords = Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'workflow', 'labels.json'), 'utf8')).groups.status.values);
    assert(statusWords.includes('complete'), 'and the gated status is one the vocabulary names');
  });

  await test('a Proof: line opening any line of any comment lets that same move through', async () => {
    const fetchImpl = mkFetch((url, options) => {
      if (url === COMMENTS_URL) return jsonResponse(200, [{ body: 'parked at qa.\n  Proof:\n- unit: node tests/tower/app.test.js' }]);
      return (options && options.method) === 'PATCH'
        ? jsonResponse(200, { number: 48 })
        : jsonResponse(200, { number: 48, labels: [{ name: 'status:qa' }, { name: 'type:bug' }] });
    });
    const answer = await github.moveIssueStatus({
      repo: 'o/r', number: 48, from: 'qa', to: 'complete',
    }, { token: 'fake-token-for-tests', fetch: fetchImpl });

    assertEq(fetchImpl.calls.length, 3, 'the proof, then the labels the issue carries now, then the one write');
    assertEq(fetchImpl.calls[2].options.method, 'PATCH', 'the write the gate let through');
    assertEq(JSON.parse(fetchImpl.calls[2].options.body).labels.join(','), 'type:bug,status:complete', 'landing on Complete with its other labels intact');
    assertEq(answer.ok, true, 'and the move landed');
    assertEq(answer.data.status, 'complete', 'on the column it was dropped on');
  });

  await test('a move to any other column reads no comments at all', async () => {
    const fetchImpl = mkFetch((url, options) => ((options && options.method) === 'PATCH'
      ? jsonResponse(200, { number: 48 })
      : jsonResponse(200, { number: 48, labels: [{ name: 'status:inbox' }] })));
    const answer = await github.moveIssueStatus({
      repo: 'o/r', number: 48, from: 'inbox', to: 'specced',
    }, { token: 't', fetch: fetchImpl });
    assertEq(answer.ok, true, 'moved');
    assertEq(fetchImpl.calls.length, 2, 'the read and the write, as before the gate existed');
    assert(!fetchImpl.calls.some((call) => call.url.includes('/comments')), 'only the flip to Complete pays for the proof read');
  });

  await test('intake files the issue the endpoint files - same labels, same default body', async () => {
    const fetchImpl = mkSiteFetch({ repos: ['owner/workkit'], home: 'owner/workkit' },
      { html_url: 'https://github.com/owner/workkit/issues/12' });
    const answer = await github.createIssue({ repo: 'OWNER/Workkit', title: '  a thought  ', body: '' }, { token: 'fake-token-for-tests', fetch: fetchImpl });

    const call = fetchImpl.calls[2];
    assertEq(call.url, 'https://api.github.com/repos/owner/workkit/issues', 'filed under the ROSTER’s spelling, as the endpoint does');
    assertEq(call.options.method, 'POST', 'a create');
    assertEq(call.options.headers.authorization, 'Bearer fake-token-for-tests', 'with the viewer’s token');
    const sent = JSON.parse(call.options.body);
    assertEq(sent.title, 'a thought', 'the title, trimmed');
    assertEq(sent.body, github.DEFAULT_BODY, 'and the endpoint’s own default where a body was not typed');
    assertEq(sent.labels.join(','), 'status:inbox,type:idea', 'captured, and typed as an idea until triage says otherwise');
    assertEq(answer.ok, true, 'answered');
    assertEq(answer.data.url, 'https://github.com/owner/workkit/issues/12', 'and the dialog gets the URL to link');

    // The rules restated across the copy boundary, pinned to the endpoint that owns them.
    assert(serverSrc.includes(`const DEFAULT_BODY = '${github.DEFAULT_BODY}'`), 'the default body is the endpoint’s');
    assert(serverSrc.includes(`const TITLE_MAX = ${github.TITLE_MAX}`), 'the title cap is the endpoint’s');
    assert(serverSrc.includes(`const BODY_MAX = ${github.BODY_MAX}`), 'the body cap is the endpoint’s');
    for (const label of github.INTAKE_LABELS) assert(serverSrc.includes(`'--label', '${label}'`), `${label} is what the endpoint files with`);
  });

  await test('intake refuses what the endpoint refuses, before anything is filed', async () => {
    const fetchImpl = mkSiteFetch({ repos: ['owner/workkit'], home: 'owner/workkit' },
      { html_url: 'https://github.com/owner/workkit/issues/12' });
    const refuse = async (payload) => github.createIssue(payload, { token: 't', fetch: fetchImpl });

    assert(/unknown repo: owner\/other/.test((await refuse({ repo: 'owner/other', title: 'x' })).reason), 'a repo this site does not sweep');
    assert(/title is required/.test((await refuse({ repo: 'owner/workkit', title: '   ' })).reason), 'a blank title');
    assert(/longer than 256/.test((await refuse({ repo: 'owner/workkit', title: 'x'.repeat(257) })).reason), 'a title past the cap');
    assert(/longer than 4000/.test((await refuse({ repo: 'owner/workkit', title: 'x', body: 'b'.repeat(4001) })).reason), 'a body past it');
    assert(fetchImpl.calls.every((call) => call.url === 'data/home.json' || isRoster(call.url)),
      'and every refusal came before GitHub was written to');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
