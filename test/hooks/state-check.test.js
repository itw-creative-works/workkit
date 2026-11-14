// Tests for docs:state-check's logic, stateCheckContext(facts) in
// hooks/mods/state-check.js: the announcements a session start makes about
// the inbox count, the capture file, a repo CLAUDE.md and an AGENTS.md past
// its budget. The facts' shape is test/lib/mods-inputs.js's. The cases about
// gh, the cache and the folder are test/mods/session-start.test.ts.

const { describe, test, expect } = require('../lib/harness');
const { mods, textOf, stateFacts } = require('../lib/mods-inputs');

const { FIX_NOW, stateCheckContext } = mods('state-check');
const say = (facts) => textOf(stateCheckContext(stateFacts(facts)));

describe('state-check: status:inbox issues', () => {
  test('three open inbox issues: announces the count and offers triage', () => {
    const out = say({ inbox: 3 });
    expect(out.includes('3 open status:inbox issues'), `reports 3, got: ${out}`).toBeTruthy();
    expect(out.includes('workkit:triage'), 'points at triage').toBeTruthy();
  });

  test('one issue: singular grammar', () => {
    const out = say({ inbox: 1 });
    expect(out.includes('1 open status:inbox issue.'), `singular form, got: ${out}`).toBeTruthy();
  });
});

describe('state-check: local .workkit/capture.md', () => {
  test('a non-empty capture file: announces it', () => {
    const out = say({ capture: '# capture\n> dump anything\n\nan idea\nanother\n' });
    expect(out.includes('the local capture file has entries'), `announces it, got: ${out}`).toBeTruthy();
    expect(out.includes('triage drains it'), 'names the drain').toBeTruthy();
  });

  test('a header-only capture file: silent', () => {
    expect(say({ capture: '# capture\n> dump anything here\n\n' }), 'headings, blockquotes and blanks are not entries').toBe('');
  });

  test('inbox issues + captures: both in one context', () => {
    const out = say({ inbox: 2, capture: 'note\n' });
    expect(out.includes('2 open status:inbox') && out.includes('the local capture file has entries'), `both signals, got: ${out}`).toBeTruthy();
  });
});

describe('state-check: a repo CLAUDE.md is deleted, renamed or merged', () => {
  test('a pointer-only CLAUDE.md: says to delete it', () => {
    const out = say({ claude: '@AGENTS.md\n', agents: '# repo\n' });
    expect(out.includes('git rm CLAUDE.md'), `names the delete, got: ${out}`).toBeTruthy();
    expect(!out.includes('git mv'), 'never the rename').toBeTruthy();
    expect(!out.includes('by hand'), 'never the merge').toBeTruthy();
  });

  test('a pointer with blank lines and trailing spaces: still pointer-only', () => {
    expect(say({ claude: '\n  @AGENTS.md  \r\n\n' }).includes('git rm CLAUDE.md'), 'names the delete').toBeTruthy();
  });

  test('a content CLAUDE.md with no AGENTS.md beside it: says to rename it', () => {
    const out = say({ claude: '# Big Doc\n\nlots of rules\n' });
    expect(out.includes('git mv CLAUDE.md AGENTS.md'), `names the rename, got: ${out}`).toBeTruthy();
    expect(out.includes('history'), 'says the rename keeps history').toBeTruthy();
    expect(!out.includes('@AGENTS.md'), `no pointer goes back in its place, got: ${out}`).toBeTruthy();
    expect(!out.includes('git rm CLAUDE.md'), 'never the delete').toBeTruthy();
  });

  test('a content CLAUDE.md beside an AGENTS.md: says to merge by hand', () => {
    const out = say({ claude: '@AGENTS.md\n\nUse tabs.\n', agents: '# repo\n\nthe overview\n' });
    expect(out.includes('by hand'), `names the hand merge, got: ${out}`).toBeTruthy();
    expect(!out.includes('git mv'), 'never the rename: AGENTS.md is already there').toBeTruthy();
  });

  test('no CLAUDE.md: silent', () => {
    expect(!say({}).includes('CLAUDE.md'), 'a missing file is fine').toBeTruthy();
  });
});

describe('state-check: oversized AGENTS.md', () => {
  test('AGENTS.md over 250 lines: announces the offload', () => {
    const out = say({ agents: `# repo\n${'line\n'.repeat(255)}` });
    expect(out.includes('AGENTS.md'), `announces the oversized file, got: ${out}`).toBeTruthy();
    expect(out.includes('250'), 'states the budget').toBeTruthy();
  });

  test('AGENTS.md within budget: silent', () => {
    expect(!say({ agents: `# repo\n${'line\n'.repeat(100)}` }).includes('AGENTS.md'), 'a compliant file stays silent').toBeTruthy();
  });

  test('a dense AGENTS.md inside the line count: announces the density rule', () => {
    const out = say({ agents: `# repo\n${'x'.repeat(2100)}\n${'line\n'.repeat(100)}` });
    expect(out.includes('1 line over 400 bytes'), `announces the dense line, got: ${out}`).toBeTruthy();
    expect(out.includes('density rule'), 'names the rule').toBeTruthy();
    expect(out.includes('board-guard'), 'says writes bounce until it fits').toBeTruthy();
    expect(!out.includes('budget 250'), 'the line count is not the complaint').toBeTruthy();
  });

  test('several dense lines: the count is plural', () => {
    const out = say({ agents: `# repo\n${`${'x'.repeat(500)}\n`.repeat(3)}` });
    expect(out.includes('3 lines over 400 bytes'), `counts them, got: ${out}`).toBeTruthy();
  });
});

describe('state-check: a mechanical fix is made now, never asked', () => {
  const times = (text, part) => text.split(part).length - 1;
  const mechanical = [
    ['a pointer-only CLAUDE.md', { claude: '@AGENTS.md\n', agents: '# repo\n' }],
    ['a content CLAUDE.md with no AGENTS.md', { claude: '# Big Doc\n\nlots of rules\n' }],
    ['a dense AGENTS.md', { agents: `# repo\n${'x'.repeat(500)}\n` }],
    ['an AGENTS.md over its line budget', { agents: `# repo\n${'line\n'.repeat(255)}` }],
  ];
  for (const [name, facts] of mechanical) {
    test(`${name}: the nudge carries the fix-now instruction once`, () => {
      const out = say(facts);
      expect(times(out, FIX_NOW), `one fix-now instruction, got: ${out}`).toBe(1);
    });
  }

  test('the hand merge of a CLAUDE.md beside an AGENTS.md, a judgment call, carries no fix-now instruction', () => {
    const out = say({ claude: 'Use tabs.\n', agents: '# repo\n' });
    expect(out.includes('by hand'), `the merge nudge fires, got: ${out}`).toBeTruthy();
    expect(times(out, FIX_NOW), `no fix-now instruction, got: ${out}`).toBe(0);
  });

  test('the inbox and capture nudges, which need triage, carry no fix-now instruction', () => {
    const out = say({ inbox: 2, capture: 'note\n' });
    expect(out.includes('workkit:triage'), `both nudges fire, got: ${out}`).toBeTruthy();
    expect(times(out, FIX_NOW), `no fix-now instruction, got: ${out}`).toBe(0);
  });
});
