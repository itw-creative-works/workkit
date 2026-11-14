// Tests for workflow:standards's logic: the setup pester's wording for an
// engine kept in Claude's plugin cache. The pester's every-session rule, the
// non-git and declined cases and the wording anywhere else are
// test/mods/session-start.test.ts. The shared prologue is ./helpers.js.

const { describe, test, after, expect } = require('../../lib/harness');
const { say, dropPathWithoutGh } = require('./helpers');

describe('workflow:standards: the setup pester', () => {
  after(() => dropPathWithoutGh());

  test('an engine in the plugin cache: the pester says so', () => {
    const engine = '/w/home/.claude/plugins/cache/workkit/workkit/0.0.0/workflow';
    const ctx = say({ participation: 'enabled', isSetUp: false, engine, isInCache: true });
    const line = ctx.split('\n').find((l) => l.startsWith('SETUP:')) || '';
    expect(line.includes('plugin cache'), `the nudge names the plugin cache, got: ${line}`).toBeTruthy();
    expect(line.includes('workkit.sh setup'), `and still hands over the command, got: ${line}`).toBeTruthy();
  });
});
