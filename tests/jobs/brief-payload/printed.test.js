//
// Tests for jobs/brief-payload.js, the payload the 9am job hands to Claude:
// what is printed, the rendered payload and the script run whole.
// The shared prologue (the two fixture worlds, the composer seam, the summaries fixtures, the news gate) is ./helpers.js.
//

const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { homeEnv } = require('../../lib/platform');
const {
  SCRIPT, render, INSTRUCTION, mkTmp, cleanup, ccFixture, mkWorld, composeIn,
} = require('./helpers');

const run = async () => {
  group('jobs/brief-payload: what is printed');

  await test('the rendered payload leads with the digest instruction', () => {
    const world = mkWorld();
    const text = render(composeIn(world));
    assert(text.startsWith(INSTRUCTION), 'the instruction is first, before anything else');
    assert(/MORNING KICKOFF/.test(text), 'the digest framing survives');
    assert(/the literal prefix "HEADLINE: "/.test(text), 'and fixes the first response line for the notification');
    cleanup(world.root);
  });

  await test('the payload after the instruction is readable JSON carrying the counts', () => {
    const world = mkWorld();
    const text = render(composeIn(world));
    const json = text.slice(INSTRUCTION.length);
    const parsed = JSON.parse(json);
    assertEq(parsed.counts.open, 2, 'the counts round-trip');
    assertEq(parsed.headline, composeIn(world).headline, 'so does the headline');
    assert(/\n  "counts": \{/.test(json), 'indented, not one line: a human reads this over a shoulder');
    cleanup(world.root);
  });

  await test('the instruction describes the new keys and gives each one a section', () => {
    assert(/`nextUp` is the same board asked one question further/.test(INSTRUCTION), 'the payload description explains nextUp');
    assert(/`qa` is built and verified and waiting on the\nowner's check/.test(INSTRUCTION), 'the payload description explains qa (#135)');
    assert(/^WAITING ON YOUR CHECK: every issue in `qa`/m.test(INSTRUCTION), 'and the response shape has its section');
    assert(/`complete` is that check PASSED/.test(INSTRUCTION), 'the payload description explains complete (#196)');
    assert(/^READY TO SHIP: every issue in `complete`/m.test(INSTRUCTION), 'and the response shape has its section too');
    assert(/`findings` is the newest daily summary/.test(INSTRUCTION), 'and the findings');
    assert(/`week` is the weekly rollup, which rides on Mondays/.test(INSTRUCTION), 'and when the week rides');
    assert(/^WORK ON THIS NEXT: `nextUp`/m.test(INSTRUCTION), 'the response shape has its ranked list');
    assert(/waits on/.test(INSTRUCTION), 'and the digest is told to say what an item waits on (#103)');
    assert(/^YESTERDAY: one line/m.test(INSTRUCTION), 'a line for what yesterday produced');
    assert(/^THE WEEK: one line/m.test(INSTRUCTION), 'and one for the week');
    // Each omit clause is looked for inside its OWN section: the instruction is
    // split at every labeled header, so a section that lost the clause fails
    // here instead of matching the next section's copy of it further down.
    const chunks = INSTRUCTION.split(/\n(?=[A-Z][A-Z' 0-9]+:)/);
    for (const section of ['READY TO SHIP', 'WAITING ON YOUR CHECK', 'WORK ON THIS NEXT', 'YESTERDAY', 'THE WEEK']) {
      const chunk = chunks.find((part) => part.startsWith(`${section}:`));
      assert(chunk && /Omit\s+the\s+section\s+entirely/.test(chunk),
        `${section} is omitted when there is nothing to say`);
    }
  });

  await test('run as a script it prints a payload and exits 0', () => {
    // An empty HOME: the live machine's repos are none of this suite's business.
    // WORKKIT_CC_CHANGELOG points the news fetch at a fixture file, so the
    // script's one network read happens against the disk instead.
    const home = mkTmp();
    const res = spawnSync(process.execPath, [SCRIPT], {
      encoding: 'utf8',
      timeout: 60000,
      env: homeEnv(home, { ...process.env, WORKKIT_CC_CHANGELOG: pathToFileURL(ccFixture(home)).href }),
    });
    cleanup(home);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assert(res.stdout.startsWith(INSTRUCTION), 'stdout leads with the instruction');
    const parsed = JSON.parse(res.stdout.slice(INSTRUCTION.length).split('--- CC NEWS ---')[0]);
    assert(typeof parsed.headline === 'string' && parsed.headline.length > 0, 'and carries a headline');
    assert(Array.isArray(parsed.waiting), 'and the sections');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
