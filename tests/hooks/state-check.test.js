// Tests for docs:state-check's logic, stateCheckContext(facts) in
// hooks/mods/state-check.js: the announcements a session start makes about
// the inbox count, the capture file, a repo CLAUDE.md and an AGENTS.md past
// its budget. The facts' shape is tests/lib/mods-inputs.js's. The cases about
// gh, the cache and the folder are hooks/session-start.test.ts.

const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { mods, textOf, stateFacts } = require('../lib/mods-inputs');

// A three-byte character, built from its code so this file holds none.
const WIDE = String.fromCharCode(0x2014);
const say = (facts) => textOf(mods('state-check').stateCheckContext(stateFacts(facts)));

const run = async () => {
  group('state-check: status:inbox issues');

  await test('ports "three open inbox issues: announces the count and offers triage"', () => {
    const out = say({ inbox: 3 });
    assert(out.includes('3 open status:inbox issues'), `reports 3, got: ${out}`);
    assert(out.includes('workkit:triage'), 'points at triage');
  });

  await test('ports "one issue: singular grammar"', () => {
    const out = say({ inbox: 1 });
    assert(out.includes('1 open status:inbox issue.'), `singular form, got: ${out}`);
  });

  group('state-check: local .workkit/capture.md');

  await test('ports "a non-empty capture file: announces it"', () => {
    const out = say({ capture: '# capture\n> dump anything\n\nan idea\nanother\n' });
    assert(out.includes('the local capture file has entries'), `announces it, got: ${out}`);
    assert(out.includes('triage drains it'), 'names the drain');
  });

  await test('ports "a header-only capture file: silent"', () => {
    assertEq(say({ capture: '# capture\n> dump anything here\n\n' }), '', 'headings, blockquotes and blanks are not entries');
  });

  await test('ports "inbox issues + captures: both in one context"', () => {
    const out = say({ inbox: 2, capture: 'note\n' });
    assert(out.includes('2 open status:inbox') && out.includes('the local capture file has entries'), `both signals, got: ${out}`);
  });

  group('state-check: a repo CLAUDE.md is deleted, renamed or merged');

  await test('ports "a pointer-only CLAUDE.md: says to delete it"', () => {
    const out = say({ claude: '@AGENTS.md\n', agents: '# repo\n' });
    assert(out.includes('git rm CLAUDE.md'), `names the delete, got: ${out}`);
    assert(!out.includes('git mv'), 'never the rename');
    assert(!out.includes('by hand'), 'never the merge');
  });

  await test('ports "a pointer with blank lines and trailing spaces: still pointer-only"', () => {
    assert(say({ claude: '\n  @AGENTS.md  \r\n\n' }).includes('git rm CLAUDE.md'), 'names the delete');
  });

  await test('ports "a content CLAUDE.md with no AGENTS.md beside it: says to rename it"', () => {
    const out = say({ claude: '# Big Doc\n\nlots of rules\n' });
    assert(out.includes('git mv CLAUDE.md AGENTS.md'), `names the rename, got: ${out}`);
    assert(out.includes('history'), 'says the rename keeps history');
    assert(!out.includes('@AGENTS.md'), `no pointer goes back in its place, got: ${out}`);
    assert(!out.includes('git rm CLAUDE.md'), 'never the delete');
  });

  await test('ports "a single content line with no AGENTS.md: still a rename"', () => {
    const out = say({ claude: 'Use tabs.\n' });
    assert(out.includes('git mv CLAUDE.md AGENTS.md'), `one line of content is content, got: ${out}`);
    assert(!out.includes('@AGENTS.md'), `no pointer goes back in its place, got: ${out}`);
  });

  await test('ports "a content CLAUDE.md beside an AGENTS.md: says to merge by hand"', () => {
    const out = say({ claude: '@AGENTS.md\n\nUse tabs.\n', agents: '# repo\n\nthe overview\n' });
    assert(out.includes('by hand'), `names the hand merge, got: ${out}`);
    assert(!out.includes('git mv'), 'never the rename: AGENTS.md is already there');
  });

  await test('ports "no CLAUDE.md: silent"', () => {
    assert(!say({}).includes('CLAUDE.md'), 'a missing file is fine');
  });

  group('state-check: oversized AGENTS.md');

  await test('ports "AGENTS.md over 250 lines: announces the offload"', () => {
    const out = say({ agents: `# repo\n${'line\n'.repeat(255)}` });
    assert(out.includes('AGENTS.md'), `announces the oversized file, got: ${out}`);
    assert(out.includes('250'), 'states the budget');
  });

  await test('ports "AGENTS.md within budget: silent"', () => {
    assert(!say({ agents: `# repo\n${'line\n'.repeat(100)}` }).includes('AGENTS.md'), 'a compliant file stays silent');
  });

  await test('ports "a dense AGENTS.md inside the line count: announces the density rule"', () => {
    const out = say({ agents: `# repo\n${'x'.repeat(2100)}\n${'line\n'.repeat(100)}` });
    assert(out.includes('1 line over 400 bytes'), `announces the dense line, got: ${out}`);
    assert(out.includes('density rule'), 'names the rule');
    assert(out.includes('board-guard'), 'says writes bounce until it fits');
    assert(!out.includes('budget 250'), 'the line count is not the complaint');
  });

  await test('ports "several dense lines: the count is plural"', () => {
    const out = say({ agents: `# repo\n${`${'x'.repeat(500)}\n`.repeat(3)}` });
    assert(out.includes('3 lines over 400 bytes'), `counts them, got: ${out}`);
  });

  await test('ports "a 400-byte line: silent (the boundary passes)"', () => {
    assert(!say({ agents: `# repo\n${'x'.repeat(400)}\n` }).includes('AGENTS.md'), 'exactly 400 is within the budget');
  });

  await test('ports "a non-ASCII line: 370 characters, 410 bytes, and it counts"', () => {
    const line = `${'x'.repeat(350)}${WIDE.repeat(20)}`;
    assertEq(Buffer.byteLength(line, 'utf8'), 410, 'the fixture is 410 bytes');
    const out = say({ agents: `# repo\n${line}\n` });
    assert(out.includes('1 line over 400 bytes'), `bytes decide it, got: ${out}`);
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
