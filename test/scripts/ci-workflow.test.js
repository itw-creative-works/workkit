/* eslint-disable no-console */
// Tests for .github/workflows/checks.yml, read as text: a push runs on main
// and a pull request still runs, and the jobs are wired so the scope job's
// run answer gates the suite and the changelog check, while the required
// `test` job waits on both scope and suite.

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, selfRun, summary } = require('../lib/harness');
const { indentOf, isContent, block, inlineValue, listValue } = require('../lib/workflow-yaml');

const WORKFLOW = path.join(__dirname, '..', '..', '.github', 'workflows', 'checks.yml');

// The children of a block, at the indent of its first content line.
const childIndent = (keyBlock) => {
  const first = keyBlock.slice(1).find(isContent);
  return first ? indentOf(first) : -1;
};

// `needs:` as a list, whether written as one name or as a list.
const needsOf = (keyBlock) => {
  const one = inlineValue(keyBlock);
  return one && !one.startsWith('[') ? [one] : listValue(keyBlock);
};

const cases = async () => {
  group('checks.yml: the triggers');

  await test('a push runs only on main; a pull request still runs', () => {
    const lines = fs.readFileSync(WORKFLOW, 'utf8').split(/\r?\n/);
    const on = block(lines, 'on', 0);
    assert(on, 'checks.yml has a top-level `on:`');
    const triggers = childIndent(on);
    assert(block(on, 'pull_request', triggers), 'pull_request is still a trigger');
    const push = block(on, 'push', triggers);
    assert(push, 'push is a trigger');
    const filters = childIndent(push);
    const branches = filters === -1 ? null : block(push, 'branches', filters);
    assert(branches, 'on.push carries `branches`');
    assertEq(JSON.stringify(listValue(branches)), JSON.stringify(['main']), 'on.push.branches');
  });

  group('checks.yml: the jobs');

  await test('suite and changelog need scope and run only on its run answer; test needs scope and suite', () => {
    const lines = fs.readFileSync(WORKFLOW, 'utf8').split(/\r?\n/);
    const jobs = block(lines, 'jobs', 0);
    assert(jobs, 'checks.yml has a top-level `jobs:`');
    const at = childIndent(jobs);
    const job = (name) => {
      const found = block(jobs, name, at);
      assert(found, `jobs.${name} exists`);
      return found;
    };
    const key = (name, k) => {
      const j = job(name);
      const found = block(j, k, childIndent(j));
      assert(found, `jobs.${name} carries \`${k}\``);
      return found;
    };
    for (const name of ['suite', 'changelog']) {
      assertEq(JSON.stringify(needsOf(key(name, 'needs'))), JSON.stringify(['scope']), `jobs.${name}.needs`);
      assertEq(inlineValue(key(name, 'if')), "needs.scope.outputs.run == 'true'", `jobs.${name}.if`);
    }
    assertEq(JSON.stringify(needsOf(key('test', 'needs')).sort()), JSON.stringify(['scope', 'suite']), 'jobs.test.needs');
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
