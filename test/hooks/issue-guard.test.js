// Tests for safety:issue-guard's logic, leakVerdict({ text, envFiles, slug, parseEnv }) in hooks/mods/issue-guard.js:
// the outbound text of a gh call (its argv joined by newlines, then every body file's content) is refused when it
// carries a local .env value (named by KEY) or a token shape (named by kind). Which body files a call names, and reading
// them, is the shim gate's, and so is the wiring: test/scripts/identity/gh-shim.test.js.

const { parseEnv } = require('util');
const { describe, test, expect } = require('../lib/harness');
const { mods } = require('../lib/mods-inputs');

const CWD = '/w/work';
const SECRET = 'sup3rSecretValue_9f2a';
const PLACEHOLDER = 'your-api-key-here-1234';
const ENV = {
  path: `${CWD}/.env`,
  text: ['# a comment', '', `API_SECRET=${SECRET}`, 'DEBUG=true', 'RETRIES=3000', 'SHORT=abc', 'LOCAL_URL=http://localhost/app', ''].join('\n'),
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

// The verdict over a gh call's argv (from the verb on) and its body files' contents.
const judge = async (argv, { envFiles = CWD_ENV, bodies = [], slug = null } = {}) => mods('issue-guard')
  .leakVerdict({ text: [...argv, ...bodies].join('\n'), envFiles, slug, parseEnv });

const denyOf = (r) => (r && typeof r.deny === 'string' ? r.deny.replace(/\n$/, '') : null);

const blocks = async (argv, expected, facts) => {
  const deny = denyOf(await judge(argv, facts));
  expect(deny, `must block: gh ${argv.join(' ')}`).toBe(expected);
  return deny;
};

const passes = async (argv, facts) => {
  const r = await judge(argv, facts);
  expect(denyOf(r), `must pass: gh ${argv.join(' ')}`).toBe(null);
  expect(r ?? null, `silently: gh ${argv.join(' ')}`).toBe(null);
};

// The argv workflow/lib/discussions.sh sends, with the body inline.
const mutation = (body) => [
  'api', 'graphql',
  '-f', 'repoId=R_kg1', '-f', 'catId=DIC_kw1', '-f', 'title=Daily: 2026-07-29',
  '-f', `body=${body}`,
  '-f', [
    'query=mutation($repoId:ID!,$catId:ID!,$title:String!,$body:String!){',
    '  createDiscussion(input:{repositoryId:$repoId, categoryId:$catId, title:$title, body:$body}){',
    '    discussion { url }',
    '  }',
    '}',
  ].join('\n'),
];

describe('issue-guard: blocked outbound text', () => {
  test('gh issue create carrying a .env value: exit 2, names the KEY not the value', async () => {
    const deny = await blocks(['issue', 'create', '--title', 'auth fails', '--body', `the token is ${SECRET}`], ENV_VALUE('API_SECRET'));
    expect(!deny.includes(SECRET), 'never echoes the value').toBeTruthy();
  });

  test('GitHub token shape: exit 2, names the kind not the match', async () => {
    const deny = await blocks(['issue', 'comment', '12', '--body', `use ${TOKEN} to retry`], GITHUB);
    expect(!deny.includes(TOKEN), 'never echoes the match').toBeTruthy();
  });

  test('other token shapes: exit 2', async () => {
    for (const [value, what] of [
      [`sk-${'aB3'.repeat(8)}`, 'an API key-shaped string (sk- prefix)'],
      [`AIza${'Sy0aBcDeFgHiJkLmNoPq'}`, 'a Google API key-shaped string'],
      ['xoxb-1234567890-abcdefghij', 'a Slack token-shaped string'],
      ['AKIAIOSFODNN7EXAMPLE', 'an AWS access key-shaped string'],
      ['-----BEGIN RSA PRIVATE KEY-----', 'a private key block'],
    ]) {
      await blocks(['pr', 'comment', '4', '--body', `here: ${value}`], BLOCK(what));
    }
  });

  test('long high-entropy run: exit 2', async () => {
    await blocks(['issue', 'edit', '7', '--body', `key ${'aB3'.repeat(15)}`], BLOCK('a long high-entropy run'));
  });

  test('--body-file CONTENT is scanned: exit 2: a body file\'s content after the argv', async () => {
    await blocks(['issue', 'create', '--title', 'x', '--body-file', 'body.md'], ENV_VALUE('API_SECRET'), {
      bodies: [`## Description\n\nthe key is ${SECRET}\n`],
    });
  });
});

describe('issue-guard: the GraphQL door', () => {
  test('a clean createDiscussion: exit 0', async () => {
    await passes(mutation('## Went well\n\nThe suite is green.'));
  });

  test('a plain GraphQL query: exit 0', async () => {
    await passes(['api', 'graphql', '-f', 'owner=ITW-Creative-Works', '-f', 'name=workkit', '-f', [
      'query=query($owner:String!,$name:String!){',
      '  repository(owner:$owner, name:$name){ id hasDiscussionsEnabled',
      '    discussions(first:10){ nodes { title createdAt body } } }',
      '}',
    ].join('\n')]);
  });
});

describe('issue-guard: the repo root .env', () => {
  test('a root .env value, from a subdirectory cwd: exit 2, names the KEY', async () => {
    const deny = await blocks(['issue', 'comment', '12', '--body', `it failed with ${ROOT_SECRET}`], ENV_VALUE('ROOT_TOKEN'), { envFiles: [SUB_ENV, ROOT_ENV] });
    expect(!deny.includes(ROOT_SECRET), 'never echoes the value').toBeTruthy();
  });

  test('the subdirectory\'s own .env is still scanned: exit 2', async () => {
    await blocks(['issue', 'comment', '12', '--body', `it failed with ${SUB_SECRET}`], ENV_VALUE('SUB_TOKEN'), { envFiles: [SUB_ENV, ROOT_ENV] });
  });

  test('clean text from a subdirectory: exit 0', async () => {
    await passes(['issue', 'comment', '12', '--body', 'specced, building now'], { envFiles: [SUB_ENV, ROOT_ENV] });
  });

  test('a cwd in no repo at all: exit 0, the toplevel lookup never errors', async () => {
    await passes(['issue', 'create', '--title', 'x', '--body', 'plain text'], { envFiles: [] });
  });
});

describe('issue-guard: allowed', () => {
  test('40-char lowercase-hex sha: exit 0 (false-positive guard)', async () => {
    await passes(['issue', 'comment', '12', '--body', 'fixed in a94a8fe5ccb19ba61c4c0873d391e987982fbbd3']);
  });

  test('cross-repo links, absolute paths and long branch names: exit 0 (verifier finding)', async () => {
    for (const b of [
      'see https://github.com/ITW-Creative-Works/workkit/issues/57 for the spec',
      'it lives at /Users/someone/Developer/Repositories/ITW-Creative-Works/workkit/hooks/safety/issue-guard/run.sh',
      'branched as feat/Issue57-PublicRepoRules-secretGuard-2026-Q3-followUp',
    ]) {
      await passes(['issue', 'comment', '57', '--body', b]);
    }
    await passes(['pr', 'create', '--title', 'x', '--body', 'on feat/Issue57-PublicRepoRules-secretGuard-2026-Q3-followUp']);
  });

  test('a placeholder from .env.example: exit 0 (verifier finding)', async () => {
    await passes(['issue', 'comment', '12', '--body', `set API_SECRET=${PLACEHOLDER} locally`]);
  });

  test('non-secret .env values are not matched: exit 0', async () => {
    for (const v of ['true', '3000', 'abc', 'http://localhost/app']) {
      await passes(['issue', 'comment', '12', '--body', `the value is ${v} here`]);
    }
  });
});

describe('issue-guard: prose-shaped .env values', () => {
  test('a plain lowercase word value, and a comment using that word: the write passes', async () => {
    const envFiles = [{ path: `${CWD}/.env`, text: 'PROJECT_ID=lighthouse\n' }];
    await passes(['issue', 'comment', '12', '--body', 'the lighthouse page renders again'], { envFiles });
  });

  test('a value under eight characters, and a comment containing it: the write passes', async () => {
    const envFiles = [{ path: `${CWD}/.env`, text: 'REGION_CODE=Qz7Kp2m\n' }];
    await passes(['issue', 'comment', '12', '--body', 'the run stopped at step Qz7Kp2m today'], { envFiles });
  });

  test('a mixed-case value with digits, and a comment containing it: refused naming the key', async () => {
    const value = 'Tide4Harbor92';
    const envFiles = [{ path: `${CWD}/.env`, text: `HARBOR_KEY=${value}\n` }];
    const deny = await blocks(['issue', 'comment', '12', '--body', `it failed with ${value} today`], ENV_VALUE('HARBOR_KEY'), { envFiles });
    expect(!deny.includes(value), 'never echoes the value').toBeTruthy();
  });

  test('a lowercase value carrying a digit, and a comment containing it: refused naming the key', async () => {
    const value = 'lighthouse7';
    const envFiles = [{ path: `${CWD}/.env`, text: `BEACON_ID=${value}\n` }];
    const deny = await blocks(['issue', 'comment', '12', '--body', `it failed with ${value} today`], ENV_VALUE('BEACON_ID'), { envFiles });
    expect(!deny.includes(value), 'never echoes the value').toBeTruthy();
  });
});

describe('issue-guard: a value under a key naming a secret', () => {
  const envOf = (key, value) => [{ path: `${CWD}/.env`, text: `${key}=${value}\n` }];
  const comment = (value) => ['issue', 'comment', '12', '--body', `the ${value} page renders again`];

  test('one lowercase word under DB_PASSWORD, and a comment using that word: refused naming the key', async () => {
    const deny = await blocks(comment('sunflowers'), ENV_VALUE('DB_PASSWORD'), { envFiles: envOf('DB_PASSWORD', 'sunflowers') });
    expect(!deny.includes('sunflowers'), 'never echoes the value').toBeTruthy();
  });

  test('one lowercase word under each key piece, in any case: refused naming that key', async () => {
    for (const [key, value] of [
      ['ADMIN_PASS', 'marigolds'],
      ['OLD_PWD', 'tangerine'],
      ['client_secret', 'evergreen'],
      ['api_token', 'riverbank'],
      ['Signing_Key', 'moonstone'],
      ['AWS_CREDENTIALS', 'driftwood'],
    ]) {
      await blocks(comment(value), ENV_VALUE(key), { envFiles: envOf(key, value) });
    }
  });

  test('a number of eight digits, and a local URL with no credentials: refused naming the key', async () => {
    await blocks(comment('12345678'), ENV_VALUE('ADMIN_PASS'), { envFiles: envOf('ADMIN_PASS', '12345678') });
    const url = 'http://localhost/hook';
    await blocks(comment(url), ENV_VALUE('WEBHOOK_SECRET'), { envFiles: envOf('WEBHOOK_SECRET', url) });
  });

  test('a value under eight characters under DB_PASSWORD: the write passes', async () => {
    await passes(comment('hunter2'), { envFiles: envOf('DB_PASSWORD', 'hunter2') });
  });

  test('the same lowercase word under APP_NAME: the write passes', async () => {
    await passes(comment('sunflowers'), { envFiles: envOf('APP_NAME', 'sunflowers') });
  });
});

describe('issue-guard: public GitHub names', () => {
  // The org slug sits in the .env beside the real secret; a name the outbound
  // text or the origin slug makes public is never a leak.
  const ORG_ENV = [{ path: ENV.path, text: `${ENV.text}ORG="itw-creative-works"\n` }, EXAMPLE];
  const ORG_BODY = ['issue', 'comment', '1', '--body', 'itw-creative-works is the org'];

  test('a --repo flag naming the org: the write passes', async () => {
    await passes(['issue', 'comment', '1', '--repo', 'itw-creative-works/workkit', '--body', 'x'], { envFiles: ORG_ENV });
  });

  test('a body file linking a github.com URL under the org: the write passes', async () => {
    await passes(['issue', 'comment', '1', '--body-file', 'b.md'], {
      envFiles: ORG_ENV,
      bodies: ['https://github.com/itw-creative-works/workkit/issues/4\n'],
    });
  });

  test('the org named with no slug in the text, from another origin: refused naming ORG', async () => {
    const deny = await blocks(ORG_BODY, ENV_VALUE('ORG'), { envFiles: ORG_ENV, slug: 'alice/dotfiles' });
    expect(!deny.includes('itw-creative-works'), 'never echoes the value').toBeTruthy();
  });

  test('the same text from a repo whose origin owner is the org: the write passes', async () => {
    await passes(ORG_BODY, { envFiles: ORG_ENV, slug: 'itw-creative-works/workkit' });
  });

  test('a real secret beside a public --repo slug: refused naming API_SECRET', async () => {
    await blocks(['issue', 'comment', '1', '--repo', 'itw-creative-works/workkit', '--body', SECRET], ENV_VALUE('API_SECRET'), { envFiles: ORG_ENV });
  });

  test('a -R flag spelled in another case: the write passes', async () => {
    await passes(['issue', 'comment', '1', '-R', 'Itw-Creative-Works/Workkit', '--body', 'x'], { envFiles: ORG_ENV });
    await passes(['issue', 'comment', '1', '-R', 'Itw-Creative-Works/Workkit', '--body', 'itw-creative-works is the org'], { envFiles: ORG_ENV });
  });

  test('a REST path naming the org: the write passes', async () => {
    await passes(['api', 'repos/itw-creative-works/workkit/issues/4/comments', '-f', 'body=x'], { envFiles: ORG_ENV });
  });

  test('a -R flag attached to its slug: the write passes', async () => {
    await passes(['issue', 'comment', '1', '-Ritw-creative-works/workkit', '--body', 'x'], { envFiles: ORG_ENV });
  });

  test('a github.com name segment ending in one punctuation character: the write passes', async () => {
    await passes(['issue', 'comment', '1', '--body', 'see (https://github.com/alice/itw-creative-works)'], { envFiles: ORG_ENV });
  });

  test('a real secret beside a public REST path: refused naming API_SECRET', async () => {
    await blocks(['api', 'repos/itw-creative-works/workkit/issues/4/comments', '-f', `body=${SECRET}`], ENV_VALUE('API_SECRET'), { envFiles: ORG_ENV });
  });
});

// The rows of the .env line blocks below: one file holding `line`, every value under SERVICE_ID.
const VALUE = 'abc123xyz999';
const envHolding = (line) => [{ path: `${CWD}/.env`, text: `${line}\n` }];
const failedWith = (value) => ['issue', 'comment', '12', '--body', `it failed with ${value} today`];

// Each row: the .env line, the value an outbound text carries, and the call
// carrying it (by default a comment holding the value mid-sentence).
const refused = async (rows) => {
  for (const [line, value, argv = failedWith(value)] of rows) {
    const deny = denyOf(await judge(argv, { envFiles: envHolding(line) }));
    expect(deny, `must block: ${JSON.stringify(line)}`).toBe(ENV_VALUE('SERVICE_ID'));
    expect(!deny.includes(value), `never echoes the value: ${JSON.stringify(line)}`).toBeTruthy();
  }
};

describe('issue-guard: a trailing comment on a .env line', () => {
  test('an unquoted value before a space or a tab and a #: refused naming the key', async () => {
    await refused([
      [`SERVICE_ID=${VALUE} # note`, VALUE],
      [`SERVICE_ID=${VALUE}\t# note`, VALUE],
    ]);
  });

  test('a quoted value before a # comment, double or single, space or tab: refused naming the key', async () => {
    await refused([
      [`SERVICE_ID="${VALUE}" # note`, VALUE],
      [`SERVICE_ID='${VALUE}' # note`, VALUE],
      [`SERVICE_ID="${VALUE}"\t# note`, VALUE],
    ]);
  });

  test('a quoted value with a # right after its closing quote, double or single: refused naming the key', async () => {
    await refused([
      [`SERVICE_ID="${VALUE}"#note`, VALUE],
      [`SERVICE_ID='${VALUE}'#note`, VALUE],
    ]);
  });

  test('two spaces before the #, and a text ending on the value: refused naming the key', async () => {
    await refused([[`SERVICE_ID=${VALUE}  # x`, VALUE, ['issue', 'comment', '12', '--body', `it failed with ${VALUE}`]]]);
  });

  test('an export line with a trailing comment: refused naming the key', async () => {
    await refused([[`export SERVICE_ID=${VALUE} # note`, VALUE]]);
  });

  test('a hash inside the quotes, or with no whitespace before it, stays part of the value: refused naming the key', async () => {
    await refused([
      ['SERVICE_ID="abc # 123xyz999"', 'abc # 123xyz999'],
      ['SERVICE_ID=abc#123xyz999', 'abc#123xyz999'],
    ]);
  });

  test('an unquoted value with a spaced #, and a text carrying the whole of it: refused naming the key', async () => {
    await refused([['SERVICE_ID=abc # 123xyz999', 'abc # 123xyz999']]);
  });

  test('a public GitHub name before a trailing comment, and a --repo flag naming it: the write passes', async () => {
    await passes(['issue', 'comment', '1', '--repo', 'itw-creative-works/x', '--body', 'x'], { envFiles: envHolding('ORG=itw-creative-works # the org') });
  });

  test('a plain value with a trailing comment, and a comment using that value: the write passes', async () => {
    await passes(['issue', 'comment', '12', '--body', 'the development build is green'], { envFiles: envHolding('MODE=development # dev') });
    await passes(['issue', 'comment', '12', '--body', 'the flag is true here'], { envFiles: envHolding('DEBUG=true # on') });
  });
});

describe('issue-guard: a .env file read the way an app reads it, and line by line', () => {
  test('a value in backticks, and a text carrying it bare: refused naming the key', async () => {
    await refused([[`SERVICE_ID=\`${VALUE}\``, VALUE]]);
  });

  test('a \\n escape in double quotes, and a text carrying a real line break there: refused naming the key', async () => {
    await refused([['SERVICE_ID="abc123\\nxyz999"', 'abc123\nxyz999']]);
  });

  test('a double-quoted value over two lines, and a text carrying the same two lines: refused naming the key', async () => {
    await refused([['SERVICE_ID="abc123\nxyz999"', 'abc123\nxyz999']]);
  });

  test('a key set twice, and a text carrying either value: refused naming the key', async () => {
    const twice = 'SERVICE_ID=first111value\nSERVICE_ID=second22value';
    await refused([
      [twice, 'first111value'],
      [twice, 'second22value'],
    ]);
  });

  test('Windows line ends, with and without a trailing comment: refused naming the key on the bare value', async () => {
    await refused([
      [`SERVICE_ID=${VALUE}\r\nDEBUG=true\r`, VALUE],
      [`SERVICE_ID=${VALUE} # note\r\nDEBUG=true\r`, VALUE],
      [`SERVICE_ID="${VALUE}" # note\r\nDEBUG=true\r`, VALUE],
    ]);
  });

  test('a key set twice, its first line ending in a comment, and a text carrying the first value: refused naming the key', async () => {
    await refused([
      ['SERVICE_ID=first111value # c\nSERVICE_ID=second22value', 'first111value'],
      ['SERVICE_ID="first111value" # c\nSERVICE_ID=second22value', 'first111value'],
      ['SERVICE_ID=first111value # c\r\nSERVICE_ID=second22value\r', 'first111value'],
    ]);
  });

  test('a key set twice, its first value in double quotes, and a text carrying that value: refused naming the key', async () => {
    await refused([['SERVICE_ID="first111value"\nSERVICE_ID=second22value', 'first111value']]);
  });

  test('a quoted value holding a quote and a # inside it, and a text carrying all of it: refused naming the key', async () => {
    await refused([['SERVICE_ID="ab1" # cd2345"', 'ab1" # cd2345']]);
  });

  test('a bare value holding a # before a trailing comment, and a text carrying the value: refused naming the key', async () => {
    await refused([['SERVICE_ID=abc#123xyz999 # note', 'abc#123xyz999']]);
  });

  test('a line under an unclosed quote above it, and a text carrying its value: refused naming the key', async () => {
    await refused([[`U="abc\nSERVICE_ID=${VALUE} # c\nX="y"`, VALUE]]);
  });

  test('no parseEnv handed in: it throws, naming parseEnv', () => {
    expect(() => mods('issue-guard').leakVerdict({ text: 'x', envFiles: [], slug: null })).toThrow('parseEnv');
  });
});
