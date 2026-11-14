//
// Tests for the tower dashboard's crew.js: the crew tree.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const { describe, before, test, expect } = require('../../lib/harness');
const { loadLibs } = require('./helpers');

describe('tower/app: crew - the tree', () => {
  let crew;
  before(async () => { ({ crew } = await loadLibs()); });

  test('a telemetry session normalizes with its tokens and its subagents', () => {
    const node = crew.normalize({
      id: 'sess-1',
      chatName: 'the tower',
      cwd: '/repos/ITW/workkit',
      model: 'claude-opus-5',
      effort: 'high',
      state: 'working',
      tokens: { input: 1, output: 2, cacheRead: 3, cacheCreation: 4, total: 10 },
      subagents: [{ id: 'agent-a', class: 'worker', model: 'claude-sonnet-5', state: 'working', tokens: { total: 5 } }],
    });
    expect(node.id, 'the id').toBe('sess-1');
    expect(node.title, 'the chat name is the title').toBe('the tower');
    expect(node.tokens, 'the total, not the parts').toBe(10);
    expect(node.children.length, 'one subagent').toBe(1);
    expect(node.children[0].agentClass, 'read from `class`, the field the API sends').toBe('worker');
    expect(node.children[0].tokens, 'with its own spend').toBe(5);
  });

  test('a plain session row normalizes too - the fallback roster has no second tier', () => {
    const node = crew.normalize({
      claudePid: 700, session: 'sess-2', cwd: '/repos/Omega/omega', chatName: null, state: 'idle', model: null, effort: null,
    });
    expect(node.id, 'that roster names the id `session`').toBe('sess-2');
    expect(node.title, 'an unnamed chat is empty, never null on the page').toBe('');
    expect(node.state, 'the state it does carry').toBe('idle');
    expect(node.tokens, 'tokens are unknown, which is not zero').toBe(null);
    expect(node.children.length, 'and it spawns nothing').toBe(0);
  });

  test('a root card is titled repo then chat name, with a fallback for each half', () => {
    expect(crew.rootLabel({ cwd: '/repos/ITW/workkit', title: 'the tower' }), 'the repo, a slash, the chat').toBe('workkit/the tower');
    expect(crew.rootLabel({ cwd: '/repos/ITW/workkit', title: '', id: 'sess-1' }), 'an unnamed chat falls back to its id').toBe('workkit/sess-1');
    expect(crew.rootLabel({ cwd: '', title: 'the tower' }), 'no cwd is no leading slash').toBe('the tower');
    expect(crew.rootLabel({ cwd: '', title: '', id: '' }), 'and a node with nothing still has a name').toBe('session');
  });

  test('the crew splits into who is working and who has finished', () => {
    const children = [
      { state: 'working', id: 'a' },
      { state: 'done', id: 'b' },
      { state: 'done', id: 'c' },
      { state: '', id: 'd' },
    ];
    const split = crew.splitCrew(children);
    expect(split.working.map((c) => c.id).join(''), 'only the stamped working one is live crew').toBe('a');
    expect(split.done.map((c) => c.id).join(''), 'everything else is history, unstamped included').toBe('bcd');
  });

  test('the summary counts the working crew and says the total in the same breath', () => {
    const tree = [
      { children: [{ state: 'working' }, { state: 'done' }, { state: 'done' }] },
      { children: [{ state: 'working' }, { state: 'working' }] },
      { children: [] },
    ];
    const count = crew.crewCount(tree);
    expect(count.working, 'three are running').toBe(3);
    expect(count.total, 'out of five the transcripts remember').toBe(5);
  });

  test('a session with no subagents at all counts as none, not as unknown', () => {
    const count = crew.crewCount([crew.normalize({ id: 'x', tokens: { total: 1 } })]);
    expect(count.working, 'nobody running').toBe(0);
    expect(count.total, 'and nobody at all').toBe(0);
  });

  test('both rosters land their moments on one scale - ms epochs, whichever way they were said', () => {
    const session = crew.normalize({
      session: 'sess-1', lastActivity: 1700000000000, aliveSince: 1699999000000, transcript: '/t/a.jsonl',
    });
    expect(session.lastActivity, 'a session row already says ms').toBe(1700000000000);
    expect(session.aliveSince, 'both of them').toBe(1699999000000);
    expect(session.transcript, 'and where it was read from').toBe('/t/a.jsonl');

    const agent = crew.normalize({
      id: 'agent-a', class: 'worker', lastAt: '2026-07-27T12:00:00.000Z', startedAt: '2026-07-27T11:00:00.000Z', lastTool: 'Edit', lastToolAt: '2026-07-27T11:59:00.000Z',
    });
    expect(agent.lastActivity, 'a subagent says it in ISO and arrives in ms').toBe(Date.parse('2026-07-27T12:00:00.000Z'));
    expect(agent.aliveSince, 'the spawn stamp too').toBe(Date.parse('2026-07-27T11:00:00.000Z'));
    expect(agent.lastTool, 'what it last reached for').toBe('Edit');
    expect(agent.lastToolAt, 'and when').toBe(Date.parse('2026-07-27T11:59:00.000Z'));

    const bare = crew.normalize({ id: 'x' });
    expect(bare.lastActivity, 'a row carrying no time is unknown, never 1970').toBe(null);
    expect(bare.aliveSince, 'both ways').toBe(null);
    expect(crew.normalize({ id: 'y', lastAt: 'not a date' }).lastActivity, 'and an unparseable stamp is unknown too').toBe(null);
  });

  test('the counters behind the total travel for the dialog, and a plain row has none', () => {
    const node = crew.normalize({ id: 'a', tokens: { input: 1, output: 2, total: 10 }, cost: 0.25 });
    expect(node.usage.input, 'the input counter').toBe(1);
    expect(node.tokens, 'beside the total the card draws').toBe(10);
    expect(node.cost, 'and what it came to').toBe(0.25);
    expect(crew.normalize({ session: 'b' }).usage, 'a session row has no counters, which is not zeros').toBe(null);
    expect(crew.normalize({ session: 'b' }).cost, 'nor a cost').toBe(null);
  });

  test('a connector runs the way the card actually sits from the trunk', () => {
    // Four children: two left of centre, two right, none on it.
    expect(crew.connectorFlow(0, 4), 'the far left card is reached by flowing left').toBe('left');
    expect(crew.connectorFlow(1, 4), 'so is the near one').toBe('left');
    expect(crew.connectorFlow(2, 4), 'and the right half flows right').toBe('right');
    expect(crew.connectorFlow(3, 4), 'to the end of the row').toBe('right');
    // An odd row has a card on the trunk: its line is the drop, with no
    // sideways run to have a direction at all.
    expect(crew.connectorFlow(1, 3), 'the middle of three is straight below the parent').toBe('down');
    expect(crew.connectorFlow(0, 1), 'and an only child is always straight below it').toBe('down');
  });
});
