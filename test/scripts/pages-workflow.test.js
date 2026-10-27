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

const cases = async () => {
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

  group('pages.yml: the deploy');

  await test('no run: line writes a home.json, a repos.json or a CNAME', () => {
    const named = runLines(lines()).filter((l) => /home\.json|repos\.json|CNAME/.test(l));
    assertEq(named.join('\n'), '', 'the central copy carries no home pointer, no repo list and no domain');
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
