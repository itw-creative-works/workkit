// Tests for the central dashboard's deploy (.github/workflows/pages.yml): built
// from tower/app by workflow/publish/build.sh and deployed to this repo's own
// Pages. The shape is read off the lines: the kit has no YAML dependency and
// every question here is line-shaped.

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { indentOf, isComment, isContent, childrenOf } = require('../lib/workflow-yaml');

const ROOT = path.join(__dirname, '..', '..');
const PAGES = path.join(ROOT, '.github', 'workflows', 'pages.yml');

const lines = () => fs.readFileSync(PAGES, 'utf8').split('\n');

// The direct children of a block, as `key: value` with the indent dropped.
const entriesOf = (block) => {
  const real = block.filter(isContent);
  if (!real.length) return [];
  const depth = indentOf(real[0]);
  return real.filter((l) => indentOf(l) === depth).map((l) => l.trim());
};

const topLevel = (all, key) => all.indexOf(`${key}:`);

// Every line a step's shell runs: a `run:` line and, for a `run: |` or
// `run: >` block, every line under it.
const runLines = (all) => {
  const out = [];
  all.forEach((line, i) => {
    const m = line.match(/^\s*(?:- )?run:\s*(.*)$/);
    if (!m) return;
    out.push(line);
    if (/^[|>]/.test(m[1])) out.push(...childrenOf(all, i));
  });
  return out;
};

// The step a line belongs to: from its `- ` opener to the next line at or
// above that opener's indent.
const stepOf = (all, at) => {
  let start = at;
  while (start >= 0 && !(/^\s*- /.test(all[start]) && indentOf(all[start]) <= indentOf(all[at]))) start--;
  assert(start >= 0, `line ${at + 1} sits in a step`);
  const depth = indentOf(all[start]);
  let end = start + 1;
  while (end < all.length && !(isContent(all[end]) && indentOf(all[end]) <= depth)) end++;
  return all.slice(start, end);
};

// The job a line belongs to: the last two-space key above it under `jobs:`.
const jobOf = (all, at) => {
  const jobs = topLevel(all, 'jobs');
  assert(jobs !== -1, 'a top-level jobs: key');
  let start = at;
  while (start > jobs && !/^ {2}[A-Za-z0-9_-]+:\s*$/.test(all[start])) start--;
  assert(start > jobs, `line ${at + 1} sits in a job`);
  return [all[start], ...childrenOf(all, start)];
};

const findLine = (all, re) => all.findIndex((l) => !isComment(l) && re.test(l));

const run = async () => {
  group('pages.yml: when it runs and what it may touch');

  await test('it runs on a published release and on a manual dispatch, nothing else, with no tabs', () => {
    assert(fs.existsSync(PAGES), '.github/workflows/pages.yml exists');
    const all = lines();
    assert(!all.some((l) => l.includes('\t')), 'no tab characters, which YAML rejects');
    const on = topLevel(all, 'on');
    assert(on !== -1, 'a top-level on: key');
    const triggers = entriesOf(childrenOf(all, on)).map((e) => e.replace(/:.*$/, ''));
    assertEq(triggers.sort().join(','), 'release,workflow_dispatch', 'the two triggers');
    const release = all.findIndex((l, i) => i > on && /^\s+release:\s*$/.test(l));
    assertEq(entriesOf(childrenOf(all, release)).join(','), 'types: [published]', 'a release only once it is published');
  });

  await test('its permissions are contents read, pages write and id-token write', () => {
    const all = lines();
    const blocks = all.map((l, i) => (/^\s*permissions:\s*$/.test(l) ? i : -1)).filter((i) => i !== -1);
    assertEq(blocks.length, 1, 'one permissions: block');
    assertEq(entriesOf(childrenOf(all, blocks[0])).sort().join(','),
      'contents: read,id-token: write,pages: write', 'exactly the three a Pages deploy needs');
  });

  await test('one concurrency group, which never cancels a deploy in flight', () => {
    const all = lines();
    const at = all.map((l, i) => (/^\s*concurrency:/.test(l) && !isComment(l) ? i : -1)).filter((i) => i !== -1);
    assertEq(at.length, 1, 'one concurrency: key');
    // A bare `concurrency: <group>` cancels nothing; a block says so itself.
    if (/^\s*concurrency:\s*\S/.test(all[at[0]])) return;
    const block = entriesOf(childrenOf(all, at[0]));
    assert(block.some((e) => /^group: \S/.test(e)), `the key names a group, got: ${block.join(', ')}`);
    const cancel = block.filter((e) => /^cancel-in-progress:/.test(e));
    assert(cancel.every((e) => e === 'cancel-in-progress: false'), `a run in flight is never cancelled, got: ${cancel}`);
  });

  group('pages.yml: the build');

  await test('node is the version tower/app/targets/web/.nvmrc names', () => {
    const all = lines();
    const at = findLine(all, /^\s+node-version-file: tower\/app\/targets\/web\/\.nvmrc$/);
    assert(at !== -1, 'a node-version-file: line naming the web target’s .nvmrc');
    assert(stepOf(all, at).some((l) => /uses: actions\/setup-node@/.test(l)), 'on the setup-node step');
  });

  await test('build.sh installs, mints and builds tower/app, the build at /workkit/', () => {
    const calls = runLines(lines())
      .filter((l) => !isComment(l))
      .map((l) => l.match(/workflow\/publish\/build\.sh\s+(.*)$/))
      .filter(Boolean)
      .map((m) => m[1].replace(/\s+#.*$/, '').trim().split(/\s+/).map((a) => a.replace(/^['"]|['"]$/g, '')).join(' '));
    assertEq(calls.join(' | '), 'install tower/app | mint tower/app | build tower/app /workkit/',
      'the three calls, in order');
  });

  group('pages.yml: the deploy');

  await test('the artifact is tower/app/targets/web/dist, deployed by GitHub’s Pages actions', () => {
    const all = lines();
    const upload = findLine(all, /uses: actions\/upload-pages-artifact@/);
    assert(upload !== -1, 'an actions/upload-pages-artifact step');
    assert(stepOf(all, upload).some((l) => /^\s+path: tower\/app\/targets\/web\/dist$/.test(l)),
      'uploading the web target’s dist');
    const deploy = findLine(all, /uses: actions\/deploy-pages@/);
    assert(deploy > upload, 'an actions/deploy-pages step, after the upload');
    const job = jobOf(all, deploy);
    const env = job.findIndex((l) => /^\s+environment:/.test(l));
    assert(env !== -1, `the deploy's job names an environment, got:\n${job.join('\n')}`);
    const bound = /^\s+environment:\s*github-pages\s*$/.test(job[env])
      || entriesOf(childrenOf(job, env)).includes('name: github-pages');
    assert(bound, `and it is github-pages, got:\n${job.join('\n')}`);
  });

  await test('no run: line writes a home.json, a repos.json or a CNAME', () => {
    const named = runLines(lines()).filter((l) => /home\.json|repos\.json|CNAME/.test(l));
    assertEq(named.join('\n'), '', 'the central copy carries no home pointer, no repo list and no domain');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
