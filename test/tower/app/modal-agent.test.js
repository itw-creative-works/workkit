//
// Tests for the tower dashboard's modal.js: the agent dialog.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const { describe, before, test, expect } = require('../../lib/harness');
const { loadLibs, openAgentDialog, NOW } = require('./helpers');

describe('tower/app: modal - the agent dialog', () => {
  let secondHand, modal;
  before(async () => { ({ secondHand, modal } = await loadLibs()); });

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

  test('a crew card is reachable without a mouse, keyed by the agent it draws', () => {
    const attrs = modal.agentTrigger(AGENT);
    expect(attrs.includes('data-agent="agent-k1"'), 'the agent id is the key').toBeTruthy();
    expect(attrs.includes('role="button"') && attrs.includes('tabindex="0"'), 'the same affordance an issue card gets').toBeTruthy();
  });

  test('the dialog says what the card had no room for', () => {
    const parts = modal.agentDialog(AGENT, NOW);
    expect(parts.title.includes('worker') && parts.title.includes('workkit'), 'the role and the repo it is working in').toBeTruthy();
    expect(parts.body.includes('Edit') && parts.body.includes('9s ago'), 'the last tool and when it was called').toBeTruthy();
    expect(parts.body.includes(`data-live-ts="${NOW - 4000}"`) && parts.body.includes('>4s<'), 'how fresh it is - the header\'s live age, the one thing on the dialog that moves').toBeTruthy();
    expect(parts.body.includes('8m'), 'and how long it has been running').toBeTruthy();
    expect(parts.body.includes('400') && parts.body.includes('90'), 'the two token counters').toBeTruthy();
    expect(parts.body.includes('$0.420'), 'what it came to').toBeTruthy();
    expect(parts.body.includes(AGENT.transcript), 'and where to read the whole of it').toBeTruthy();
    expect(parts.body.includes('fa-spin'), 'with the same indicator the card carries').toBeTruthy();
  });

  test('a field the payload does not carry is left out, never drawn as a dash', () => {
    const young = modal.agentDialog({ id: 'agent-new', label: 'scout', role: 'scout' }, NOW);
    expect(!young.body.includes('Last tool'), 'a session that has called nothing says nothing about tools').toBeTruthy();
    expect(!young.body.includes('Tokens in'), 'nor about a spend it has not made').toBeTruthy();
    expect(!young.body.includes('Cost'), 'nor a cost').toBeTruthy();
    expect(!young.body.includes('Running for'), 'nor an uptime it does not know').toBeTruthy();
    expect(young.body.includes('agent-new'), 'the id it does have is still there').toBeTruthy();
  });

  test('every field the agent dialog writes reaches it as text', () => {
    const hostile = modal.agentDialog({
      id: '"><img src=x>', label: '<script>alert(1)</script>', role: '<b>role</b>', model: '<i>m</i>', effort: '<u>e</u>', lastTool: '<em>Bash</em>', transcript: '/tmp/<svg>.jsonl',
    }, NOW);
    for (const markup of [hostile.title, hostile.body]) {
      expect(!markup.includes('<script>') && !markup.includes('<img src=x>'), 'no injected element survives').toBeTruthy();
      expect(!markup.includes('<em>') && !markup.includes('<svg>'), 'and neither do the quieter ones').toBeTruthy();
    }
  });

  test('the dialog says how fresh the agent is ONCE, in the half that ages', () => {
    // A "Last activity" row frozen at open beside the header's ticking age is
    // two numbers for one fact, and they disagree within seconds.
    const parts = modal.agentDialog(AGENT, NOW);
    expect(!parts.body.includes('Last activity'), 'the frozen row is gone').toBeTruthy();
    expect(parts.body.match(/data-live-age/g).length, 'and the live one is the only span saying it').toBe(1);
    // The shape the refresh below reaches into, pinned against the real markup
    // so the double and the builder cannot drift apart in silence.
    expect(/<div class="[^"]*" data-agent-head>/.test(parts.body), 'the header, patched in place so its glyph keeps turning').toBeTruthy();
    expect(parts.body.includes('<div data-agent-rows>'), 'and the rows, which hold no motion and are rewritten whole').toBeTruthy();
    expect(parts.body.indexOf('data-agent-head') < parts.body.indexOf('data-agent-rows'), 'in that order').toBeTruthy();
  });

  test('a feed paint brings the open dialog up to the stamps it just read', () => {
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
    expect(modal.refreshAgentDialog(NOW + 30000, dialog.host), 'the open dialog was refreshed').toBe(true);

    expect(dialog.wrapper.dataset.liveTs, 'the dialog carries the stamp the feed brought').toBe(String(NOW + 28000));
    expect(dialog.icon.className, 'so it is working, two seconds after its last move - not idle, thirty-four seconds after the one it opened on').toBe('omega-tower-activity omega-tower-activity--working');
    expect(dialog.label.textContent, 'and the age says the same').toBe('2s');
    expect(dialog.glyph.writes, 'the glyph was neither replaced nor restyled - one unbroken spin across the paint').toBe(0);
    expect(dialog.wrapper.wipes, 'nothing under the header was replaced').toBe(0);
    expect(dialog.head.writes, 'and the header itself was patched, never rewritten').toBe(0);
    expect(dialog.rows.innerHTML.includes('Bash'), 'the rows are the fresh read too').toBeTruthy();
    expect(dialog.rows.innerHTML.includes('20.0K'), 'spend and all').toBeTruthy();
  });

  test('a paint that changed nothing rewrites nothing', () => {
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
    expect(dialog.rows.writes, 'a poll paints twice, and the second one costs nothing').toBe(first);
  });

  test('a dialog nobody opened, and one open on an agent that ended', () => {
    const closed = openAgentDialog({ key: '', indicator: null });
    expect(modal.refreshAgentDialog(NOW, closed.host), 'a closed dialog carries no key and is refreshed by nothing').toBe(false);
    expect(closed.rows.writes, 'and is written to by nothing').toBe(0);
    expect(modal.refreshAgentDialog(NOW, null), 'nor is a page whose layout ships no dialog at all').toBe(false);

    // An agent that ended between polls stops being registered, so the dialog
    // keeps its last stamps and the second hand decays them as it would on the
    // card: gray, then gone.
    const ended = openAgentDialog({
      key: 'agent-ended',
      indicator: {
        phase: 'working',
        age: '4s',
        title: 'running for 8m',
        stamps: { liveState: 'working', liveTs: String(NOW - 4000), liveAlive: String(NOW - 8 * 60000) },
      },
    });
    expect(modal.refreshAgentDialog(NOW + 10000, ended.host), 'nothing is registered under that key any more').toBe(false);
    expect(ended.rows.writes, 'so the dialog is left saying what it last knew').toBe(0);
    secondHand.applyLive(ended.host, NOW + 25000);
    expect(ended.icon.className, 'and the second hand takes it gray').toBe('omega-tower-activity omega-tower-activity--idle');
    secondHand.applyLive(ended.host, NOW + 6 * 60000);
    expect(ended.wrapper.children.length, 'and then away').toBe(0);
  });

  test('an indicator that aged out comes back when the agent does', () => {
    const entry = { ...AGENT, id: 'agent-back', lastActivity: NOW - 6 * 60000 };
    modal.agentTrigger(entry);
    // A dialog opened on an agent quiet past the cutoff has no indicator at all
    // - there is no element to patch, so the refresh redraws the header.
    const dialog = openAgentDialog({ key: 'agent-back', indicator: null });
    modal.agentTrigger({ ...entry, lastActivity: NOW });
    expect(modal.refreshAgentDialog(NOW, dialog.host), 'the refresh answers').toBe(true);
    expect(dialog.head.innerHTML.includes(`data-live-ts="${NOW}"`), 'and the header is drawn again, stamps and all').toBeTruthy();
    expect(dialog.head.innerHTML.includes('fa-spin'), 'spinning - the agent is moving again').toBeTruthy();
  });
});
