//
// Tests for the tower dashboard's modal.js: the agent dialog.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { loadLibs, libs, openAgentDialog, NOW } = require('./helpers');

const run = async () => {
  const { secondHand, modal } = await loadLibs();

  group('tower/app: modal - the agent dialog');

  const AGENT = {
    id: 'agent-k1',
    label: 'worker',
    role: 'worker',
    cwd: '/repos/ITW/workkit',
    model: 'claude-opus-5',
    effort: 'high',
    state: 'working',
    lastActivity: NOW - 4000,
    aliveSince: NOW - 8 * 60000,
    lastTool: 'Edit',
    lastToolAt: NOW - 9000,
    tokens: 12000,
    usage: { input: 400, output: 90, total: 12000 },
    cost: 0.42,
    transcript: '/home/alice/.claude/projects/-repos-ITW-workkit/sess/subagents/agent-k1.jsonl',
  };

  await test('a crew card is reachable without a mouse, keyed by the agent it draws', () => {
    const attrs = modal.agentTrigger(AGENT);
    assert(attrs.includes('data-agent="agent-k1"'), 'the agent id is the key');
    assert(attrs.includes('role="button"') && attrs.includes('tabindex="0"'), 'the same affordance an issue card gets');
  });

  await test('the dialog says what the card had no room for', () => {
    const parts = modal.agentDialog(AGENT, NOW);
    assert(parts.title.includes('worker') && parts.title.includes('workkit'), 'the role and the repo it is working in');
    assert(parts.body.includes('Edit') && parts.body.includes('9s ago'), 'the last tool and when it was called');
    assert(parts.body.includes(`data-live-ts="${NOW - 4000}"`) && parts.body.includes('>4s<'), 'how fresh it is - the header\'s live age, the one thing on the dialog that moves');
    assert(parts.body.includes('8m'), 'and how long it has been running');
    assert(parts.body.includes('400') && parts.body.includes('90'), 'the two token counters');
    assert(parts.body.includes('$0.420'), 'what it came to');
    assert(parts.body.includes(AGENT.transcript), 'and where to read the whole of it');
    assert(parts.body.includes('fa-spin'), 'with the same indicator the card carries');
  });

  await test('a field the payload does not carry is left out, never drawn as a dash', () => {
    const young = modal.agentDialog({ id: 'agent-new', label: 'scout', role: 'scout' }, NOW);
    assert(!young.body.includes('Last tool'), 'a session that has called nothing says nothing about tools');
    assert(!young.body.includes('Tokens in'), 'nor about a spend it has not made');
    assert(!young.body.includes('Cost'), 'nor a cost');
    assert(!young.body.includes('Running for'), 'nor an uptime it does not know');
    assert(young.body.includes('agent-new'), 'the id it does have is still there');
  });

  await test('every field the agent dialog writes reaches it as text', () => {
    const hostile = modal.agentDialog({
      id: '"><img src=x>', label: '<script>alert(1)</script>', role: '<b>role</b>', model: '<i>m</i>', effort: '<u>e</u>', lastTool: '<em>Bash</em>', transcript: '/tmp/<svg>.jsonl',
    }, NOW);
    for (const markup of [hostile.title, hostile.body]) {
      assert(!markup.includes('<script>') && !markup.includes('<img src=x>'), 'no injected element survives');
      assert(!markup.includes('<em>') && !markup.includes('<svg>'), 'and neither do the quieter ones');
    }
  });

  await test('the dialog says how fresh the agent is ONCE, in the half that ages', () => {
    // The defect this proves against: the header's ticking age and a "Last
    // activity" row frozen at open, two numbers for one fact - twenty seconds
    // in, the row still said 4s while the header said 24s.
    const parts = modal.agentDialog(AGENT, NOW);
    assert(!parts.body.includes('Last activity'), 'the frozen row is gone');
    assertEq(parts.body.match(/data-live-age/g).length, 1, 'and the live one is the only span saying it');
    // The shape the refresh below reaches into, pinned against the real markup
    // so the double and the builder cannot drift apart in silence.
    assert(/<div class="[^"]*" data-agent-head>/.test(parts.body), 'the header, patched in place so its glyph keeps turning');
    assert(parts.body.includes('<div data-agent-rows>'), 'and the rows, which hold no motion and are rewritten whole');
    assert(parts.body.indexOf('data-agent-head') < parts.body.indexOf('data-agent-rows'), 'in that order');
  });

  await test('a feed paint brings the open dialog up to the stamps it just read', () => {
    const entry = {
      ...AGENT, id: 'agent-live', lastActivity: NOW - 4000, lastToolAt: NOW - 4000,
    };
    modal.agentTrigger(entry);
    const dialog = openAgentDialog({
      key: 'agent-live',
      indicator: {
        phase: 'working',
        age: '4s',
        title: 'running for 8m',
        stamps: { liveState: 'working', liveTs: String(NOW - 4000), liveAlive: String(NOW - 8 * 60000) },
      },
    });

    // Half a minute of work later, the paint has re-registered the same agent
    // with everything it did since. Without the refresh the dialog is still
    // holding the stamps it opened with - gray at twenty seconds, gone at
    // sixty - while the card behind it spins.
    modal.agentTrigger({
      ...entry, lastActivity: NOW + 28000, lastTool: 'Bash', lastToolAt: NOW + 28000, tokens: 20000,
    });
    assertEq(modal.refreshAgentDialog(NOW + 30000, dialog.host), true, 'the open dialog was refreshed');

    assertEq(dialog.wrapper.dataset.liveTs, String(NOW + 28000), 'the dialog carries the stamp the feed brought');
    assertEq(dialog.icon.className, 'omega-tower-activity omega-tower-activity--working', 'so it is working, two seconds after its last move - not idle, thirty-four seconds after the one it opened on');
    assertEq(dialog.label.textContent, '2s', 'and the age says the same');
    assertEq(dialog.glyph.writes, 0, 'the glyph was neither replaced nor restyled - one unbroken spin across the paint');
    assertEq(dialog.wrapper.wipes, 0, 'nothing under the header was replaced');
    assertEq(dialog.head.writes, 0, 'and the header itself was patched, never rewritten');
    assert(dialog.rows.innerHTML.includes('Bash'), 'the rows are the fresh read too');
    assert(dialog.rows.innerHTML.includes('20.0K'), 'spend and all');
  });

  await test('a paint that changed nothing rewrites nothing', () => {
    const entry = { ...AGENT, id: 'agent-still' };
    modal.agentTrigger(entry);
    const dialog = openAgentDialog({
      key: 'agent-still',
      indicator: {
        phase: 'working',
        age: '4s',
        title: 'running for 8m',
        stamps: { liveState: 'working', liveTs: String(NOW - 4000), liveAlive: String(NOW - 8 * 60000) },
      },
    });
    modal.refreshAgentDialog(NOW, dialog.host);
    const first = dialog.rows.writes;
    modal.refreshAgentDialog(NOW, dialog.host);
    assertEq(dialog.rows.writes, first, 'a poll paints twice, and the second one costs nothing');
  });

  await test('a dialog nobody opened, and one open on an agent that ended', () => {
    const closed = openAgentDialog({ key: '', indicator: null });
    assertEq(modal.refreshAgentDialog(NOW, closed.host), false, 'a closed dialog carries no key and is refreshed by nothing');
    assertEq(closed.rows.writes, 0, 'and is written to by nothing');
    assertEq(modal.refreshAgentDialog(NOW, null), false, 'nor is a page whose layout ships no dialog at all');

    // An agent that ended between polls stops being drawn, so the next paint
    // stops registering it. The honest thing is the last stamps it had: the
    // dialog keeps them and the second hand decays them exactly as it would on
    // the card that is no longer there - gray, then gone.
    const ended = openAgentDialog({
      key: 'agent-ended',
      indicator: {
        phase: 'working',
        age: '4s',
        title: 'running for 8m',
        stamps: { liveState: 'working', liveTs: String(NOW - 4000), liveAlive: String(NOW - 8 * 60000) },
      },
    });
    assertEq(modal.refreshAgentDialog(NOW + 10000, ended.host), false, 'nothing is registered under that key any more');
    assertEq(ended.rows.writes, 0, 'so the dialog is left saying what it last knew');
    secondHand.applyLive(ended.host, NOW + 25000);
    assertEq(ended.icon.className, 'omega-tower-activity omega-tower-activity--idle', 'and the second hand takes it gray');
    secondHand.applyLive(ended.host, NOW + 6 * 60000);
    assertEq(ended.wrapper.children.length, 0, 'and then away');
  });

  await test('an indicator that aged out comes back when the agent does', () => {
    const entry = { ...AGENT, id: 'agent-back', lastActivity: NOW - 6 * 60000 };
    modal.agentTrigger(entry);
    // A dialog opened on an agent quiet past the cutoff has no indicator at all
    // - there is no element to patch, so the refresh redraws the header.
    const dialog = openAgentDialog({ key: 'agent-back', indicator: null });
    modal.agentTrigger({ ...entry, lastActivity: NOW });
    assertEq(modal.refreshAgentDialog(NOW, dialog.host), true, 'the refresh answers');
    assert(dialog.head.innerHTML.includes(`data-live-ts="${NOW}"`), 'and the header is drawn again, stamps and all');
    assert(dialog.head.innerHTML.includes('fa-spin'), 'spinning - the agent is moving again');
  });

  await test('the paint is what refreshes it, on every page and not just the crew', () => {
    // The dialogs are the LAYOUT's and outlive every page, so the refresh is
    // wired where all six paints pass through rather than in the one page whose
    // cards opened it.
    const fs = require('fs');
    const runtime = fs.readFileSync(path.join(libs, 'page.js'), 'utf8');
    assert(/import \{[^}]*refreshAgentDialog[^}]*\} from '\.\/modal\.js'/.test(runtime), 'the runtime takes the refresh from the dialog module');
    assert(/^\s*refreshAgentDialog\(\);$/m.test(runtime), 'and calls it');
    assert(runtime.indexOf('options.render(body, state);') < runtime.search(/^\s*refreshAgentDialog\(\);$/m), 'after the render that re-registered the agents it reads');
  });

  await test('the open writes the key the refresh reads, and the close removes it', () => {
    // The whole feature hinges on this pair: without the key no paint ever
    // refreshes the dialog, and without the cleanup a closed dialog keeps
    // refreshing forever. The mount runs only in a browser, so the wiring is
    // pinned where it lives.
    const fs = require('fs');
    const source = fs.readFileSync(path.join(libs, 'modal', 'agent.js'), 'utf8');
    assert(/body\.dataset\.agentOpen = key;/.test(source), 'the open records which agent is on screen');
    assert(/addEventListener\('hidden\.bs\.modal', \(\) => \{ delete body\.dataset\.agentOpen; \}\)/.test(source), 'and the close deletes it');
    const open = source.indexOf('body.dataset.agentOpen = key;');
    const shown = source.indexOf('.show()', open);
    assert(open >= 0 && shown > open, 'the key is written before the dialog is shown - never a shown dialog without one');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
