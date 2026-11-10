// Tests for the gh shim's cloud release verbs: in a Claude Code cloud session
// `gh release view` reaches GitHub as a REST call through the real gh, printed in
// gh's own shape, and `gh release create` is refused before any call, since the
// session's proxy refuses every release write. Each case runs a scratch kit's shim
// with CLAUDE_CODE_REMOTE=true against a stub gh answering `gh api` routes from
// fixtures shaped like GitHub's REST answers, then reads the requests and output.

const {
  group, test, testUnless, assert, assertEq, summary, selfRun,
} = require('../../lib/harness');
const { IS_WINDOWS, NO_NODE_STUB } = require('../../lib/platform');
const { eqArgv, fmtCalls } = require('../../lib/argv-log');
const {
  cloudWorld, assertSame, assertOk, printedJson, routes,
} = require('../../lib/identity');

const RELEASES = 'repos/acme/rostered/releases';
const REFUSED = 'gh: a cloud session cannot create a release (the proxy refuses release writes); CI\'s release job makes it when the release commit reaches the default branch';

const { runCloud } = cloudWorld();

/** A release as GitHub's REST releases routes answer one. */
const restRelease = (tag, { draft = false, prerelease = false, body = `The ${tag} notes.` } = {}) => ({
  url: `https://api.github.com/${RELEASES}/9001`,
  html_url: `https://github.com/acme/rostered/releases/tag/${tag}`,
  id: 9001,
  node_id: 'RE_kwDO9001',
  tag_name: tag,
  target_commitish: 'main',
  name: `Release ${tag}`,
  draft,
  prerelease,
  author: { login: 'octocat' },
  created_at: '2026-11-04T09:00:00Z',
  published_at: '2026-11-04T09:05:00Z',
  assets: [],
  body,
});

const FIELDS = 'tagName,name,url,isDraft,isPrerelease,publishedAt,createdAt,targetCommitish,body';

const cases = async () => {
  // The shim starts the stub `gh` from Node through rest.js, as rest.test.js does; on Windows these skip alike.
  const runTest = testUnless(IS_WINDOWS, NO_NODE_STUB);

  group('identity/gh in a cloud session: release view');

  await runTest('release view <tag> --json reads the tag\'s release and prints gh\'s fields', async () => {
    const api = { [`GET ${RELEASES}/tags/v1.2.0`]: { body: restRelease('v1.2.0', { prerelease: true }) } };
    const res = runCloud(['release', 'view', 'v1.2.0', '--json', FIELDS], { api });
    assertOk(res, 'release view v1.2.0');
    assertSame(routes(res.requests), [['GET', `${RELEASES}/tags/v1.2.0`]], 'one read of the tag\'s release');
    assertSame(printedJson(res, 'release view'), {
      tagName: 'v1.2.0',
      name: 'Release v1.2.0',
      url: 'https://github.com/acme/rostered/releases/tag/v1.2.0',
      isDraft: false,
      isPrerelease: true,
      publishedAt: '2026-11-04T09:05:00Z',
      createdAt: '2026-11-04T09:00:00Z',
      targetCommitish: 'main',
      body: 'The v1.2.0 notes.',
    }, 'gh\'s fields');
  });

  await runTest('release view with no tag reads the latest release', async () => {
    const api = { [`GET ${RELEASES}/latest`]: { body: restRelease('v1.3.0') } };
    const res = runCloud(['release', 'view', '--json', 'tagName'], { api });
    assertOk(res, 'release view');
    assertSame(routes(res.requests), [['GET', `${RELEASES}/latest`]], 'one read of the latest');
    assertSame(printedJson(res, 'release view'), { tagName: 'v1.3.0' }, 'its tag');
  });

  await runTest('release view of a tag with no release prints gh\'s release not found, exit 1', async () => {
    const res = runCloud(['release', 'view', 'v9.9.9', '--json', 'tagName'], { api: {} });
    assertEq(res.code, 1, `exit 1, stdout: ${res.stdout}, stderr: ${res.stderr}`);
    assert(res.stderr.includes('release not found'), `gh's line, got: ${res.stderr}`);
  });

  await runTest('release view -q .<field> naming an asked field prints its value raw, as gh prints a string', async () => {
    const api = { [`GET ${RELEASES}/tags/v1.2.0`]: { body: restRelease('v1.2.0') } };
    for (const flag of ['-q', '--jq']) {
      const res = runCloud(['release', 'view', 'v1.2.0', '--json', 'tagName', flag, '.tagName'], { api });
      assertOk(res, `release view ${flag} .tagName`);
      assertEq(res.stdout, 'v1.2.0\n', `${flag}: the tag, raw`);
    }
  });

  await test('release view -q with any other expression, or a path naming a field not asked, is refused with a line and prints nothing', async () => {
    const api = { [`GET ${RELEASES}/tags/v1.2.0`]: { body: restRelease('v1.2.0') } };
    for (const expr of ['.tagName | ascii_downcase', '.name']) {
      const res = runCloud(['release', 'view', 'v1.2.0', '--json', 'tagName', '-q', expr], { api });
      assert(res.code !== 0, `${expr}: a refusal, got exit ${res.code}, stdout: ${res.stdout}`);
      assertEq(res.stdout, '', `${expr}: nothing printed`);
      assert(res.stderr.trim().length > 0, `${expr}: a line on stderr`);
    }
  });

  await runTest('release view with no --json prints the title, tag, draft, prerelease, published and url lines, then --, then the body', async () => {
    const api = { [`GET ${RELEASES}/tags/v1.2.0`]: { body: restRelease('v1.2.0', { body: '### Added\n\n- A thing.' }) } };
    const res = runCloud(['release', 'view', 'v1.2.0'], { api });
    assertOk(res, 'release view v1.2.0');
    const head = [
      'title:\tRelease v1.2.0', 'tag:\tv1.2.0', 'draft:\tfalse', 'prerelease:\tfalse', 'published:\t2026-11-04T09:05:00Z',
      'url:\thttps://github.com/acme/rostered/releases/tag/v1.2.0', '--', '### Added\n\n- A thing.',
    ].join('\n');
    assert(res.stdout.startsWith(head), `gh's header then the body, got: ${JSON.stringify(res.stdout)}`);
  });

  group('identity/gh in a cloud session: release create');

  await test('release create is refused with its line, exit 1, before any gh call', async () => {
    const api = { [`POST ${RELEASES}`]: { status: 201, body: restRelease('v1.4.0') } };
    const res = runCloud(['release', 'create', 'v1.4.0', '--title', 'v1.4.0', '--notes', 'x', '--target', 'abc1234'], { api });
    assertEq(res.code, 1, `exit 1, stdout: ${res.stdout}, stderr: ${res.stderr}`);
    assert(res.stderr.split('\n').includes(REFUSED), `the refusal line, got: ${res.stderr}`);
    assertSame([res.calls, res.requests], [[], []], 'no gh call and no request');
  });

  group('identity/gh in a cloud session: release subcommands REST does not serve');

  await runTest('release list runs the real gh once, whole, with no gh api call', async () => {
    const argv = ['release', 'list', '--limit', '5'];
    const res = runCloud(argv, { api: {} });
    assertOk(res, 'release list');
    assertEq(res.calls.length, 1, `the real gh runs once, got ${fmtCalls(res.calls)}`);
    assert(eqArgv(res.calls[0], argv), `every argument passed through, got ${fmtCalls(res.calls)}`);
    assertEq(res.requests.length, 0, `no gh api call, got: ${JSON.stringify(res.requests)}`);
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
