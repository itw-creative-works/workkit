/* eslint-disable no-console */
// Tests for .github/workflows/checks.yml, read as text: a push runs the suite
// only on main and never for a push touching only the release files, and a
// pull request still runs it.

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, selfRun, summary } = require('../lib/harness');
const { indentOf, isContent, childrenOf } = require('../lib/workflow-yaml');

const WORKFLOW = path.join(__dirname, '..', '..', '.github', 'workflows', 'checks.yml');

const unquote = (word) => word.trim().replace(/^(['"])(.*)\1$/, '$2');

// The lines nested under the first `key:` line at `indent` within `lines`, the
// key line itself first; null when no such key.
const block = (lines, key, indent) => {
  const keyRe = new RegExp(`^ {${indent}}["']?${key.replace(/[.]/g, '\\.')}["']?:`);
  const at = lines.findIndex((line) => keyRe.test(line));
  return at === -1 ? null : [lines[at], ...childrenOf(lines, at)];
};

// A list value in either YAML spelling, `key: [a, b]` or `- a` lines below it.
const listValue = (keyBlock) => {
  const inline = keyBlock[0].replace(/\s#.*$/, '').split(':').slice(1).join(':').trim();
  if (inline.startsWith('[')) {
    return inline.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean);
  }
  return keyBlock.slice(1).filter(isContent).map((line) => unquote(line.trim().replace(/^- /, '')));
};

// The children of a block, at the indent of its first content line.
const childIndent = (keyBlock) => {
  const first = keyBlock.slice(1).find(isContent);
  return first ? indentOf(first) : -1;
};

const run = async () => {
  group('checks.yml: the triggers');

  await test('a push runs only on main and skips one touching only CHANGELOG.md and the plugin manifest; a pull request still runs', () => {
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
    const ignored = block(push, 'paths-ignore', filters);
    assert(ignored, 'on.push carries `paths-ignore`');
    assertEq(JSON.stringify(listValue(ignored).sort()), JSON.stringify(['.claude-plugin/plugin.json', 'CHANGELOG.md']), 'on.push.paths-ignore');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
