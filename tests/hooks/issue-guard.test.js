/* eslint-disable no-console */
//
// Tests for hooks/safety/issue-guard — the PreToolUse hook that blocks a
// `gh issue create|comment|edit` or `gh pr create|comment|edit|merge` whose
// outbound text carries a secret: a value from a local .env file, or a
// token-shaped string. Every repo is assumed public (docs/project-state.md →
// "Issue anatomy"). A 40-char lowercase-hex sha must never bounce.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary } = require('../lib/harness');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'safety', 'issue-guard', 'run.sh');

// One throwaway repo-ish directory per run, holding the .env the value scan
// reads and any --body-file fixture.
const CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-guard-'));
const SECRET = 'sup3rSecretValue_9f2a';
fs.writeFileSync(path.join(CWD, '.env'), [
  '# a comment',
  '',
  `API_SECRET=${SECRET}`,
  'DEBUG=true',
  'PORT=3000',
  'SHORT=abc',
  'LOCAL_URL=http://localhost:8693',
  '',
].join('\n'));
// The example/template variants hold public placeholders and must be skipped.
const PLACEHOLDER = 'your-api-key-here-1234';
fs.writeFileSync(path.join(CWD, '.env.example'), `API_SECRET=${PLACEHOLDER}\n`);

// A git repo whose .env sits at the ROOT while the session stands in a
// subdirectory — the case that made value matching go blind. Realpath'd so the
// git toplevel and the cwd are the same string on macOS.
const REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'issue-guard-repo-')));
spawnSync('git', ['init', '-q'], { cwd: REPO });
const ROOT_SECRET = 'r00tSecretValue_7c1b';
fs.writeFileSync(path.join(REPO, '.env'), `ROOT_TOKEN=${ROOT_SECRET}\n`);
const SUB = path.join(REPO, 'packages', 'api');
fs.mkdirSync(SUB, { recursive: true });
const SUB_SECRET = 'subSecretValue_4d9e';
fs.writeFileSync(path.join(SUB, '.env'), `SUB_TOKEN=${SUB_SECRET}\n`);

const runHook = (command, cwd = CWD) => {
  const input = JSON.stringify({ tool_name: 'Bash', cwd, tool_input: { command } });
  const res = spawnSync('bash', [HOOK], {
    input,
    env: { ...process.env, HOME: os.homedir() },
    encoding: 'utf8',
    timeout: 10000,
  });
  return { code: res.status, stderr: res.stderr || '' };
};

const run = async () => {
  group('issue-guard: blocked outbound text');

  await test('gh issue create carrying a .env value — exit 2, names the KEY not the value', () => {
    const { code, stderr } = runHook(`gh issue create --title "auth fails" --body "the token is ${SECRET}"`);
    assertEq(code, 2, 'a verbatim .env value must block');
    assert(stderr.includes('issue-guard'), 'names itself');
    assert(stderr.includes('API_SECRET'), 'names the key');
    assert(!stderr.includes(SECRET), 'never echoes the value');
    assert(stderr.includes('public'), 'states where sensitive context belongs');
  });

  await test('GitHub token shape — exit 2, names the kind not the match', () => {
    const token = `ghp_${'A1b2C3d4E5f6G7h8I9j0'}`;
    const { code, stderr } = runHook(`gh issue comment 12 --body "use ${token} to retry"`);
    assertEq(code, 2, 'a ghp_ token must block');
    assert(stderr.includes('GitHub token-shaped'), 'names the kind');
    assert(!stderr.includes(token), 'never echoes the match');
  });

  await test('other token shapes — exit 2', () => {
    const cases = [
      ['sk-', `sk-${'aB3'.repeat(8)}`],
      ['AIza', `AIza${'Sy0aBcDeFgHiJkLmNoPq'}`],
      ['xoxb-', 'xoxb-1234567890-abcdefghij'],
      ['AKIA', 'AKIAIOSFODNN7EXAMPLE'],
      ['private key', '-----BEGIN RSA PRIVATE KEY-----'],
    ];
    for (const [name, value] of cases) {
      const { code } = runHook(`gh pr comment 4 --body "here: ${value}"`);
      assertEq(code, 2, `${name} must block`);
    }
  });

  await test('long high-entropy run — exit 2', () => {
    const blob = 'aB3'.repeat(15); // 45 chars, mixed case with digits
    const { code, stderr } = runHook(`gh issue edit 7 --body "key ${blob}"`);
    assertEq(code, 2, 'a 40+ char mixed-case run must block');
    assert(stderr.includes('high-entropy'), 'names the kind');
  });

  await test('--body-file CONTENT is scanned — exit 2', () => {
    const file = path.join(CWD, 'body.md');
    fs.writeFileSync(file, `## Description\n\nthe key is ${SECRET}\n`);
    const { code, stderr } = runHook('gh issue create --title "x" --body-file body.md');
    assertEq(code, 2, 'body-file content must be scanned');
    assert(stderr.includes('API_SECRET'), 'names the key from the file content');
  });

  await test('-F is the same body-file flag and its CONTENT is scanned — exit 2', () => {
    const file = path.join(CWD, 'short-body.md');
    fs.writeFileSync(file, `the key is ${SECRET}\n`);
    for (const c of ['gh issue create --title "x" -F short-body.md', 'gh issue comment 12 -F=short-body.md']) {
      const { code, stderr } = runHook(c);
      assertEq(code, 2, `must block: ${c}`);
      assert(stderr.includes('API_SECRET'), 'names the key from the file content');
    }
  });

  await test('gh pr merge and gh pr create are gated too — exit 2', () => {
    for (const c of [
      `gh pr merge 3 --body "token ghp_${'A1b2C3d4E5f6G7h8I9j0'}"`,
      `gh pr create --title "fix" --body "token ghp_${'A1b2C3d4E5f6G7h8I9j0'}"`,
    ]) {
      assertEq(runHook(c).code, 2, `must block: ${c}`);
    }
  });

  await test('close and reopen post free text too — exit 2 (verifier finding)', () => {
    const token = `ghp_${'A1b2C3d4E5f6G7h8I9j0'}`;
    for (const c of [
      `gh issue close 5 --comment "the fix used ${token}"`,
      `gh issue reopen 5 --comment "still broken with ${token}"`,
      `gh pr close 9 --comment "superseded, key was ${token}"`,
    ]) {
      const { code, stderr } = runHook(c);
      assertEq(code, 2, `must block: ${c}`);
      assert(stderr.includes('GitHub token-shaped'), 'names the kind');
    }
  });

  group('issue-guard: the GraphQL door');

  // The shape workflow/discussions.sh sends, with the body inline rather than
  // from a file — the same mutation either way.
  const mutation = (body) => [
    'gh api graphql',
    '-f repoId="R_kg1" -f catId="DIC_kw1" -f title="Daily — 2026-07-29"',
    `-f body='${body}'`,
    "-f query='mutation($repoId:ID!,$catId:ID!,$title:String!,$body:String!){",
    '  createDiscussion(input:{repositoryId:$repoId, categoryId:$catId, title:$title, body:$body}){',
    '    discussion { url }',
    '  }',
    "}'",
  ].join(' ');

  await test('createDiscussion carrying a .env value — exit 2, names the KEY', () => {
    const { code, stderr } = runHook(mutation(`## Went well\n\nthe token is ${SECRET}`));
    assertEq(code, 2, 'the summary path is an outbound write like any other');
    assert(stderr.includes('API_SECRET'), 'names the key');
    assert(!stderr.includes(SECRET), 'never echoes the value');
  });

  await test('a token shape in the mutation body — exit 2, names the kind', () => {
    const token = `ghp_${'A1b2C3d4E5f6G7h8I9j0'}`;
    const { code, stderr } = runHook(mutation(`the run used ${token}`));
    assertEq(code, 2, 'a ghp_ token must block here too');
    assert(stderr.includes('GitHub token-shaped'), 'names the kind');
    assert(!stderr.includes(token), 'never echoes the match');
  });

  await test('the -F body=@file form is dereferenced — exit 2 (what discussions.sh sends)', () => {
    const file = path.join(CWD, 'summary.md');
    fs.writeFileSync(file, `## Went well\n\nthe key is ${SECRET}\n`);
    const cmd = mutation('placeholder').replace("-f body='placeholder'", `-F body="@${file}"`);
    const { code, stderr } = runHook(cmd);
    assertEq(code, 2, 'the body arrives as a file, and its content is the outbound text');
    assert(stderr.includes('API_SECRET'), 'names the key from the file content');
  });

  await test('the --field body=@file long form is dereferenced too — exit 2 (verifier finding)', () => {
    const file = path.join(CWD, 'long-form-summary.md');
    fs.writeFileSync(file, `## Went well\n\nthe key is ${SECRET}\n`);
    for (const flag of ['--field', '--raw-field']) {
      const cmd = mutation('placeholder').replace("-f body='placeholder'", `${flag} body=@${file}`);
      const { code, stderr } = runHook(cmd);
      assertEq(code, 2, `gh's long synonym is the same door: ${flag}`);
      assert(stderr.includes('API_SECRET'), 'names the key from the file content');
    }
  });

  await test('a clean --field mutation — exit 0', () => {
    const file = path.join(CWD, 'clean-summary.md');
    fs.writeFileSync(file, '## Went well\n\nThe suite is green.\n');
    const cmd = mutation('placeholder').replace("-f body='placeholder'", `--field body=@${file}`);
    const { code, stderr } = runHook(cmd);
    assertEq(code, 0, `ordinary summary prose publishes the long way too, got: ${stderr}`);
    assertEq(stderr, '', 'silent');
  });

  await test('a clean createDiscussion — exit 0', () => {
    const { code, stderr } = runHook(mutation('## Went well\n\nThe suite is green.'));
    assertEq(code, 0, `ordinary summary prose publishes, got: ${stderr}`);
    assertEq(stderr, '', 'silent');
  });

  await test('other discussion and issue mutations are gated — exit 2', () => {
    const token = `ghp_${'A1b2C3d4E5f6G7h8I9j0'}`;
    for (const op of ['addDiscussionComment', 'createIssue', 'updateIssue', 'addComment']) {
      const cmd = `gh api graphql -f body='${token}' -f query='mutation{ ${op}(input:{body:$body}){ clientMutationId } }'`;
      assertEq(runHook(cmd).code, 2, `must block: ${op}`);
    }
  });

  await test('a plain GraphQL query — exit 0, reads are never gated', () => {
    const query = [
      'gh api graphql -f owner="ITW-Creative-Works" -f name="workkit"',
      "-f query='query($owner:String!,$name:String!){",
      '  repository(owner:$owner, name:$name){ id hasDiscussionsEnabled',
      '    discussions(first:10){ nodes { title createdAt body } } }',
      "}'",
    ].join(' ');
    const { code, stderr } = runHook(query);
    assertEq(code, 0, `a read writes nothing, got: ${stderr}`);
  });

  await test('a GraphQL query naming a repository mutation-free field — exit 0', () => {
    const { code, stderr } = runHook("gh api graphql -f query='{ viewer { login } }'");
    assertEq(code, 0, `an anonymous operation is a query, got: ${stderr}`);
  });

  group('issue-guard: the repo root .env');

  await test("a root .env value, from a subdirectory cwd — exit 2, names the KEY", () => {
    const { code, stderr } = runHook(
      `gh issue comment 12 --body "it failed with ${ROOT_SECRET}"`, SUB);
    assertEq(code, 2, "the repo root's values are loaded from a subdirectory too");
    assert(stderr.includes('ROOT_TOKEN'), 'names the key');
    assert(!stderr.includes(ROOT_SECRET), 'never echoes the value');
  });

  await test("the subdirectory's own .env is still scanned — exit 2", () => {
    const { code, stderr } = runHook(
      `gh issue comment 12 --body "it failed with ${SUB_SECRET}"`, SUB);
    assertEq(code, 2, 'the cwd scan is unchanged');
    assert(stderr.includes('SUB_TOKEN'), 'names the key');
  });

  await test('standing AT the repo root — exit 2, the one scan still catches it', () => {
    const { code, stderr } = runHook(
      `gh issue comment 12 --body "it failed with ${ROOT_SECRET}"`, REPO);
    assertEq(code, 2, 'toplevel == cwd is scanned once and still blocks');
    assert(stderr.includes('ROOT_TOKEN'), 'names the key');
  });

  await test('clean text from a subdirectory — exit 0', () => {
    const { code, stderr } = runHook('gh issue comment 12 --body "specced, building now"', SUB);
    assertEq(code, 0, `the root scan adds no false block, got: ${stderr}`);
  });

  await test('a cwd in no repo at all — exit 0, the toplevel lookup never errors', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-guard-norepo-'));
    const { code, stderr } = runHook('gh issue create --title "x" --body "plain text"', bare);
    assertEq(code, 0, `no repo → just the cwd scan, got: ${stderr}`);
    fs.rmSync(bare, { recursive: true, force: true });
  });

  group('issue-guard: allowed');

  await test('clean gh issue close --comment — exit 0', () => {
    const { code, stderr } = runHook('gh issue close 57 --comment "done"');
    assertEq(code, 0, 'a clean closing comment passes');
    assertEq(stderr, '', 'silent');
  });

  await test('clean gh issue comment — exit 0', () => {
    const { code, stderr } = runHook('gh issue comment 57 --body "specced — the guard blocks the outbound write"');
    assertEq(code, 0, 'clean text passes');
    assertEq(stderr, '', 'silent');
  });

  await test('40-char lowercase-hex sha — exit 0 (false-positive guard)', () => {
    const sha = 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3';
    assertEq(sha.length, 40, 'fixture is a real sha length');
    const { code, stderr } = runHook(`gh issue comment 12 --body "fixed in ${sha}"`);
    assertEq(code, 0, `commit shas must never bounce, got: ${stderr}`);
  });

  await test('cross-repo links, absolute paths and long branch names — exit 0 (verifier finding)', () => {
    // The entropy class used to include / and -, so every one of these read as
    // one 40+ char mixed-case run. The spec REQUIRES cross-repo links in issue
    // bodies, which made this the guard's fatal false positive.
    const bodies = [
      'see https://github.com/ITW-Creative-Works/workkit/issues/57 for the spec',
      'it lives at /Users/someone/Developer/Repositories/ITW-Creative-Works/workkit/hooks/safety/issue-guard/run.sh',
      'branched as feat/Issue57-PublicRepoRules-secretGuard-2026-Q3-followUp',
    ];
    for (const b of bodies) {
      const { code, stderr } = runHook(`gh issue comment 57 --body "${b}"`);
      assertEq(code, 0, `must pass, got: ${stderr}`);
    }
    const { code, stderr } = runHook('gh pr create --title "x" --body "on feat/Issue57-PublicRepoRules-secretGuard-2026-Q3-followUp"');
    assertEq(code, 0, `a long branch name in a PR body must pass, got: ${stderr}`);
  });

  await test('a placeholder from .env.example — exit 0 (verifier finding)', () => {
    const { code, stderr } = runHook(`gh issue comment 12 --body "set API_SECRET=${PLACEHOLDER} locally"`);
    assertEq(code, 0, `example/template files hold public placeholders, got: ${stderr}`);
  });

  await test('non-secret .env values are not matched — exit 0', () => {
    for (const v of ['true', '3000', 'abc', 'http://localhost:8693']) {
      const { code, stderr } = runHook(`gh issue comment 12 --body "the value is ${v} here"`);
      assertEq(code, 0, `"${v}" must not block, got: ${stderr}`);
    }
  });

  await test('non-gh command carrying a .env value — exit 0', () => {
    const { code } = runHook(`echo "${SECRET}" >> notes.txt`);
    assertEq(code, 0, 'only gh issue/pr writes are gated');
  });

  await test('read-only gh commands — exit 0', () => {
    for (const c of ['gh issue list --label status:inbox', `gh issue view 57 --json body`]) {
      assertEq(runHook(c).code, 0, `must pass: ${c}`);
    }
  });

  group('issue-guard: wiring and fail-open');

  await test('hooks.json registers the guard under PreToolUse Bash', () => {
    const wiring = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    const bash = (wiring.hooks.PreToolUse || []).find((b) => b.matcher === 'Bash');
    assert(bash, 'a PreToolUse Bash block exists');
    assert(bash.hooks.some((h) => h.command.includes('safety:issue-guard')),
      'the Bash block routes safety:issue-guard through the loader');
  });

  await test('missing command — exit 0', () => {
    const res = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ tool_input: {} }),
      env: { ...process.env, HOME: os.homedir() },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0, 'no command → fail open');
  });

  await test('malformed JSON — exit 0', () => {
    const res = spawnSync('bash', [HOOK], {
      input: 'not json',
      env: { ...process.env, HOME: os.homedir() },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0, 'bad input → fail open');
  });

  await test('a cwd with no .env at all — exit 0', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-guard-bare-'));
    const { code, stderr } = runHook('gh issue create --title "x" --body "plain text"', empty);
    assertEq(code, 0, `no .env is not an error, got: ${stderr}`);
    fs.rmSync(empty, { recursive: true, force: true });
  });
};

module.exports = async () => {
  await run();
  const result = summary();
  fs.rmSync(CWD, { recursive: true, force: true });
  fs.rmSync(REPO, { recursive: true, force: true });
  return result;
};

if (require.main === module) {
  module.exports().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
