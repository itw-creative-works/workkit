// Tests for safety:issue-guard's logic, issueGuardVerdict({ command,
// envFiles, bodies }) in hooks/mods/issue-guard.js: a gh issue or pr write, a
// GraphQL discussion or issue mutation, or a REST write to an issue or pull
// endpoint is refused when its outbound text carries a local .env value (named
// by KEY) or a token shape (named by kind). Each case ports the HEAD case its
// name quotes; `bodies` is keyed by the path as the command spells it. Dropped
// with the shell spawn: "hooks.json registers the guard under PreToolUse Bash"
// and "malformed JSON: exit 0" (the wiring is tests/mods/guards-issue-guard.test.ts).

const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { mods } = require('../lib/mods-inputs');

const CWD = '/w/work';
const SECRET = 'sup3rSecretValue_9f2a';
const PLACEHOLDER = 'your-api-key-here-1234';
const ENV = {
  path: `${CWD}/.env`,
  text: ['# a comment', '', `API_SECRET=${SECRET}`, 'DEBUG=true', 'PORT=3000', 'SHORT=abc', 'LOCAL_URL=http://localhost:8693', ''].join('\n'),
};
// The example variant holds a public placeholder and must be skipped.
const EXAMPLE = { path: `${CWD}/.env.example`, text: `API_SECRET=${PLACEHOLDER}\n` };
const CWD_ENV = [ENV, EXAMPLE];

// A repo whose .env sits at the root while the session stands in a
// subdirectory with an .env of its own: the gatherer hands both over.
const REPO = '/w/repo';
const SUB = `${REPO}/packages/api`;
const ROOT_SECRET = 'r00tSecretValue_7c1b';
const SUB_SECRET = 'subSecretValue_4d9e';
const ROOT_ENV = { path: `${REPO}/.env`, text: `ROOT_TOKEN=${ROOT_SECRET}\n` };
const SUB_ENV = { path: `${SUB}/.env`, text: `SUB_TOKEN=${SUB_SECRET}\n` };

const TOKEN = `ghp_${'A1b2C3d4E5f6G7h8I9j0'}`;
const PUBLIC = 'Every repo workkit touches is assumed public, issues and PRs and comments included: no secrets, credentials, tokens, or private business or personal details. Keep that context in chat or in local files and reference it indirectly.';
const BLOCK = (what) => `issue-guard: BLOCKED this gh command: the outbound text carries ${what}.\n${PUBLIC}`;
const ENV_VALUE = (key) => BLOCK(`the value of ${key} from a local .env file`);
const GITHUB = BLOCK('a GitHub token-shaped string');

const judge = async (command, { envFiles = CWD_ENV, bodies = {} } = {}) => mods('issue-guard')
  .issueGuardVerdict({ command, envFiles, bodies });

const denyOf = (r) => (r && typeof r.deny === 'string' ? r.deny.replace(/\n$/, '') : null);

const blocks = async (command, expected, facts) => {
  const deny = denyOf(await judge(command, facts));
  assertEq(deny, expected, `must block: ${command}`);
  return deny;
};

const passes = async (command, facts) => {
  const r = await judge(command, facts);
  assertEq(denyOf(r), null, `must pass: ${command}`);
  assertEq(r ?? null, null, `silently: ${command}`);
};

// The shape workflow/lib/discussions.sh sends, with the body inline.
const mutation = (body) => [
  'gh api graphql',
  '-f repoId="R_kg1" -f catId="DIC_kw1" -f title="Daily: 2026-07-29"',
  `-f body='${body}'`,
  "-f query='mutation($repoId:ID!,$catId:ID!,$title:String!,$body:String!){",
  '  createDiscussion(input:{repositoryId:$repoId, categoryId:$catId, title:$title, body:$body}){',
  '    discussion { url }',
  '  }',
  "}'",
].join(' ');

const run = async () => {
  group('issue-guard: blocked outbound text');

  await test('ports "gh issue create carrying a .env value: exit 2, names the KEY not the value"', async () => {
    const deny = await blocks(`gh issue create --title "auth fails" --body "the token is ${SECRET}"`, ENV_VALUE('API_SECRET'));
    assert(!deny.includes(SECRET), 'never echoes the value');
  });

  await test('ports "GitHub token shape: exit 2, names the kind not the match"', async () => {
    const deny = await blocks(`gh issue comment 12 --body "use ${TOKEN} to retry"`, GITHUB);
    assert(!deny.includes(TOKEN), 'never echoes the match');
  });

  await test('ports "other token shapes: exit 2"', async () => {
    for (const [value, what] of [
      [`sk-${'aB3'.repeat(8)}`, 'an API key-shaped string (sk- prefix)'],
      [`AIza${'Sy0aBcDeFgHiJkLmNoPq'}`, 'a Google API key-shaped string'],
      ['xoxb-1234567890-abcdefghij', 'a Slack token-shaped string'],
      ['AKIAIOSFODNN7EXAMPLE', 'an AWS access key-shaped string'],
      ['-----BEGIN RSA PRIVATE KEY-----', 'a private key block'],
    ]) {
      await blocks(`gh pr comment 4 --body "here: ${value}"`, BLOCK(what));
    }
  });

  await test('ports "long high-entropy run: exit 2"', async () => {
    await blocks(`gh issue edit 7 --body "key ${'aB3'.repeat(15)}"`, BLOCK('a long high-entropy run'));
  });

  await test('ports "--body-file CONTENT is scanned: exit 2"', async () => {
    await blocks('gh issue create --title "x" --body-file body.md', ENV_VALUE('API_SECRET'), {
      bodies: { 'body.md': `## Description\n\nthe key is ${SECRET}\n` },
    });
  });

  await test('ports "-F is the same body-file flag and its CONTENT is scanned: exit 2"', async () => {
    const bodies = { 'short-body.md': `the key is ${SECRET}\n` };
    await blocks('gh issue create --title "x" -F short-body.md', ENV_VALUE('API_SECRET'), { bodies });
    await blocks('gh issue comment 12 -F=short-body.md', ENV_VALUE('API_SECRET'), { bodies });
  });

  await test('ports "gh pr merge and gh pr create are gated too: exit 2"', async () => {
    await blocks(`gh pr merge 3 --body "token ${TOKEN}"`, GITHUB);
    await blocks(`gh pr create --title "fix" --body "token ${TOKEN}"`, GITHUB);
  });

  await test('ports "close and reopen post free text too: exit 2 (verifier finding)"', async () => {
    for (const c of [
      `gh issue close 5 --comment "the fix used ${TOKEN}"`,
      `gh issue reopen 5 --comment "still broken with ${TOKEN}"`,
      `gh pr close 9 --comment "superseded, key was ${TOKEN}"`,
    ]) {
      await blocks(c, GITHUB);
    }
  });

  group('issue-guard: the GraphQL door');

  await test('ports "createDiscussion carrying a .env value: exit 2, names the KEY"', async () => {
    const deny = await blocks(mutation(`## Went well\n\nthe token is ${SECRET}`), ENV_VALUE('API_SECRET'));
    assert(!deny.includes(SECRET), 'never echoes the value');
  });

  await test('ports "a token shape in the mutation body: exit 2, names the kind"', async () => {
    const deny = await blocks(mutation(`the run used ${TOKEN}`), GITHUB);
    assert(!deny.includes(TOKEN), 'never echoes the match');
  });

  await test('ports "the -F body=@file form is dereferenced: exit 2 (what discussions.sh sends)"', async () => {
    const file = `${CWD}/summary.md`;
    const cmd = mutation('placeholder').replace("-f body='placeholder'", `-F body="@${file}"`);
    await blocks(cmd, ENV_VALUE('API_SECRET'), { bodies: { [file]: `## Went well\n\nthe key is ${SECRET}\n` } });
  });

  await test('ports "the --field body=@file long form is dereferenced too: exit 2 (verifier finding)"', async () => {
    const file = `${CWD}/long-form-summary.md`;
    for (const flag of ['--field', '--raw-field']) {
      const cmd = mutation('placeholder').replace("-f body='placeholder'", `${flag} body=@${file}`);
      await blocks(cmd, ENV_VALUE('API_SECRET'), { bodies: { [file]: `## Went well\n\nthe key is ${SECRET}\n` } });
    }
  });

  await test('ports "a clean --field mutation: exit 0"', async () => {
    const file = `${CWD}/clean-summary.md`;
    const cmd = mutation('placeholder').replace("-f body='placeholder'", `--field body=@${file}`);
    await passes(cmd, { bodies: { [file]: '## Went well\n\nThe suite is green.\n' } });
  });

  await test('ports "a clean createDiscussion: exit 0"', async () => {
    await passes(mutation('## Went well\n\nThe suite is green.'));
  });

  await test('ports "other discussion and issue mutations are gated: exit 2"', async () => {
    for (const op of ['addDiscussionComment', 'createIssue', 'updateIssue', 'addComment']) {
      await blocks(`gh api graphql -f body='${TOKEN}' -f query='mutation{ ${op}(input:{body:$body}){ clientMutationId } }'`, GITHUB);
    }
  });

  await test('ports "a plain GraphQL query: exit 0, reads are never gated"', async () => {
    await passes([
      'gh api graphql -f owner="ITW-Creative-Works" -f name="workkit"',
      "-f query='query($owner:String!,$name:String!){",
      '  repository(owner:$owner, name:$name){ id hasDiscussionsEnabled',
      '    discussions(first:10){ nodes { title createdAt body } } }',
      "}'",
    ].join(' '));
  });

  await test('ports "a GraphQL query naming a repository mutation-free field: exit 0"', async () => {
    await passes("gh api graphql -f query='{ viewer { login } }'");
  });

  group('issue-guard: the REST door');

  await test('ports "a POST creating an issue with a .env value: exit 2, names the KEY"', async () => {
    const deny = await blocks(`gh api -X POST repos/owner/name/issues -f title="auth fails" -f body="the token is ${SECRET}"`, ENV_VALUE('API_SECRET'));
    assert(!deny.includes(SECRET), 'never echoes the value');
  });

  await test('ports "a PATCH carrying a token shape: exit 2, names the kind"', async () => {
    const deny = await blocks(`gh api --method PATCH /repos/owner/name/issues/12 -f body="use ${TOKEN} to retry"`, GITHUB);
    assert(!deny.includes(TOKEN), 'never echoes the match');
  });

  await test('ports "every issue and pull endpoint shape: exit 2"', async () => {
    for (const p of [
      'repos/owner/name/issues',
      'repos/owner/name/issues/12',
      'repos/owner/name/issues/12/comments',
      'repos/owner/name/issues/comments/9001',
      'repos/owner/name/pulls',
      'repos/owner/name/pulls/12',
      'repos/owner/name/pulls/12/comments',
      'repos/owner/name/pulls/comments/9001',
      'repos/owner/name/pulls/12/reviews',
      'https://api.github.com/repos/owner/name/issues/12/comments',
    ]) {
      await blocks(`gh api -X POST ${p} -f body="key ${TOKEN}"`, GITHUB);
    }
  });

  await test('ports "no method flag at all is the implied POST gh makes: exit 2"', async () => {
    await blocks(`gh api repos/owner/name/issues/12/comments -f body="the key is ${SECRET}"`, ENV_VALUE('API_SECRET'));
  });

  await test('ports "--input CONTENT is dereferenced: exit 2"', async () => {
    const file = `${CWD}/rest-body.json`;
    await blocks(`gh api -X POST repos/owner/name/issues/12/comments --input ${file}`, ENV_VALUE('API_SECRET'), {
      bodies: { [file]: `{ "body": "the key is ${SECRET}" }\n` },
    });
  });

  await test('ports "-F body=@file is dereferenced on the REST door too: exit 2"', async () => {
    const file = `${CWD}/rest-comment.md`;
    await blocks(`gh api -X POST repos/owner/name/issues/12/comments -F body=@${file}`, ENV_VALUE('API_SECRET'), {
      bodies: { [file]: `the key is ${SECRET}\n` },
    });
  });

  await test('ports "reads of the same paths: exit 0"', async () => {
    for (const c of [
      'gh api repos/owner/name/issues',
      'gh api repos/owner/name/issues/12/comments --paginate',
      'gh api -X GET repos/owner/name/issues -f state=open',
      'gh api --method GET repos/owner/name/pulls -f state=all',
      `gh api repos/owner/name/issues/12 --jq .body -H "Authorization: token ${TOKEN}"`,
    ]) {
      await passes(c);
    }
  });

  await test('ports "a body whose PROSE says -X GET does not disarm the scan: exit 2"', async () => {
    await blocks(`gh api repos/owner/name/issues/1/comments -f body='try curl -X GET foo: ${SECRET}'`, ENV_VALUE('API_SECRET'));
  });

  await test('ports "a read chained with a write in one command is still a write: exit 2"', async () => {
    await blocks(`gh api -X GET repos/owner/name/issues > /tmp/x.json && gh api repos/owner/name/issues -f body="${SECRET}"`, ENV_VALUE('API_SECRET'));
  });

  await test('ports "a POST to a path that is not issues or pulls: exit 0"', async () => {
    for (const p of ['repos/owner/name/dispatches', 'repos/owner/name/actions/workflows/brief.yml/dispatches']) {
      await passes(`gh api -X POST ${p} -f ref="${TOKEN}"`);
    }
  });

  await test('ports "a clean REST comment: exit 0"', async () => {
    await passes('gh api -X POST repos/owner/name/issues/12/comments -f body="specced, building now"');
  });

  group('issue-guard: the repo root .env');

  await test('ports "a root .env value, from a subdirectory cwd: exit 2, names the KEY"', async () => {
    const deny = await blocks(`gh issue comment 12 --body "it failed with ${ROOT_SECRET}"`, ENV_VALUE('ROOT_TOKEN'), { envFiles: [SUB_ENV, ROOT_ENV] });
    assert(!deny.includes(ROOT_SECRET), 'never echoes the value');
  });

  await test('ports "the subdirectory\'s own .env is still scanned: exit 2"', async () => {
    await blocks(`gh issue comment 12 --body "it failed with ${SUB_SECRET}"`, ENV_VALUE('SUB_TOKEN'), { envFiles: [SUB_ENV, ROOT_ENV] });
  });

  await test('ports "standing AT the repo root: exit 2, the one scan still catches it"', async () => {
    await blocks(`gh issue comment 12 --body "it failed with ${ROOT_SECRET}"`, ENV_VALUE('ROOT_TOKEN'), { envFiles: [ROOT_ENV] });
  });

  await test('ports "clean text from a subdirectory: exit 0"', async () => {
    await passes('gh issue comment 12 --body "specced, building now"', { envFiles: [SUB_ENV, ROOT_ENV] });
  });

  await test('ports "a cwd in no repo at all: exit 0, the toplevel lookup never errors"', async () => {
    await passes('gh issue create --title "x" --body "plain text"', { envFiles: [] });
  });

  group('issue-guard: allowed');

  await test('ports "clean gh issue close --comment: exit 0"', async () => {
    await passes('gh issue close 57 --comment "done"');
  });

  await test('ports "clean gh issue comment: exit 0"', async () => {
    await passes('gh issue comment 57 --body "specced: the guard blocks the outbound write"');
  });

  await test('ports "40-char lowercase-hex sha: exit 0 (false-positive guard)"', async () => {
    await passes('gh issue comment 12 --body "fixed in a94a8fe5ccb19ba61c4c0873d391e987982fbbd3"');
  });

  await test('ports "cross-repo links, absolute paths and long branch names: exit 0 (verifier finding)"', async () => {
    for (const b of [
      'see https://github.com/ITW-Creative-Works/workkit/issues/57 for the spec',
      'it lives at /Users/someone/Developer/Repositories/ITW-Creative-Works/workkit/hooks/safety/issue-guard/run.sh',
      'branched as feat/Issue57-PublicRepoRules-secretGuard-2026-Q3-followUp',
    ]) {
      await passes(`gh issue comment 57 --body "${b}"`);
    }
    await passes('gh pr create --title "x" --body "on feat/Issue57-PublicRepoRules-secretGuard-2026-Q3-followUp"');
  });

  await test('ports "a placeholder from .env.example: exit 0 (verifier finding)"', async () => {
    await passes(`gh issue comment 12 --body "set API_SECRET=${PLACEHOLDER} locally"`);
  });

  await test('ports "non-secret .env values are not matched: exit 0"', async () => {
    for (const v of ['true', '3000', 'abc', 'http://localhost:8693']) {
      await passes(`gh issue comment 12 --body "the value is ${v} here"`);
    }
  });

  await test('ports "non-gh command carrying a .env value: exit 0"', async () => {
    await passes(`echo "${SECRET}" >> notes.txt`);
  });

  await test('ports "read-only gh commands: exit 0"', async () => {
    await passes('gh issue list --label status:inbox');
    await passes('gh issue view 57 --json body');
  });

  group('issue-guard: fail-open');

  await test('ports "missing command: exit 0"', async () => {
    await passes('');
  });

  await test('ports "a cwd with no .env at all: exit 0"', async () => {
    await passes('gh issue create --title "x" --body "plain text"', { envFiles: [] });
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
