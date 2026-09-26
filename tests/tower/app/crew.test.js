//
// Tests for the tower dashboard's crew.js: the crew tree.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const { group, test, assertEq, summary, selfRun } = require('../../lib/harness');
const { loadLibs } = require('./helpers');

const run = async () => {
  const { crew } = await loadLibs();

  group('tower/app: crew - the tree');

  await test('a telemetry session normalizes with its tokens and its subagents', () => {
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
    assertEq(node.id, 'sess-1', 'the id');
    assertEq(node.title, 'the tower', 'the chat name is the title');
    assertEq(node.tokens, 10, 'the total, not the parts');
    assertEq(node.children.length, 1, 'one subagent');
    assertEq(node.children[0].agentClass, 'worker', 'read from `class`, the field the API sends');
    assertEq(node.children[0].tokens, 5, 'with its own spend');
  });

  await test('a plain session row normalizes too - the fallback roster has no second tier', () => {
    const node = crew.normalize({
      claudePid: 700, session: 'sess-2', cwd: '/repos/Omega/omega', chatName: null, state: 'idle', model: null, effort: null,
    });
    assertEq(node.id, 'sess-2', 'that roster names the id `session`');
    assertEq(node.title, '', 'an unnamed chat is empty, never null on the page');
    assertEq(node.state, 'idle', 'the state it does carry');
    assertEq(node.tokens, null, 'tokens are unknown, which is not zero');
    assertEq(node.children.length, 0, 'and it spawns nothing');
  });

  await test('a root card is titled repo then chat name, with a fallback for each half', () => {
    assertEq(crew.rootLabel({ cwd: '/repos/ITW/workkit', title: 'the tower' }), 'workkit/the tower', 'the repo, a slash, the chat');
    assertEq(crew.rootLabel({ cwd: '/repos/ITW/workkit', title: '', id: 'sess-1' }), 'workkit/sess-1', 'an unnamed chat falls back to its id');
    assertEq(crew.rootLabel({ cwd: '', title: 'the tower' }), 'the tower', 'no cwd is no leading slash');
    assertEq(crew.rootLabel({ cwd: '', title: '', id: '' }), 'session', 'and a node with nothing still has a name');
  });

  await test('the crew splits into who is working and who has finished', () => {
    const children = [
      { state: 'working', id: 'a' },
      { state: 'done', id: 'b' },
      { state: 'done', id: 'c' },
      { state: '', id: 'd' },
    ];
    const split = crew.splitCrew(children);
    assertEq(split.working.map((c) => c.id).join(''), 'a', 'only the stamped working one is live crew');
    assertEq(split.done.map((c) => c.id).join(''), 'bcd', 'everything else is history, unstamped included');
  });

  await test('the summary counts the working crew and says the total in the same breath', () => {
    const tree = [
      { children: [{ state: 'working' }, { state: 'done' }, { state: 'done' }] },
      { children: [{ state: 'working' }, { state: 'working' }] },
      { children: [] },
    ];
    const count = crew.crewCount(tree);
    assertEq(count.working, 3, 'three are running');
    assertEq(count.total, 5, 'out of five the transcripts remember');
  });

  await test('a session with no subagents at all counts as none, not as unknown', () => {
    const count = crew.crewCount([crew.normalize({ id: 'x', tokens: { total: 1 } })]);
    assertEq(count.working, 0, 'nobody running');
    assertEq(count.total, 0, 'and nobody at all');
  });

  await test('both rosters land their moments on one scale - ms epochs, whichever way they were said', () => {
    const session = crew.normalize({
      session: 'sess-1', lastActivity: 1700000000000, aliveSince: 1699999000000, transcript: '/t/a.jsonl',
    });
    assertEq(session.lastActivity, 1700000000000, 'a session row already says ms');
    assertEq(session.aliveSince, 1699999000000, 'both of them');
    assertEq(session.transcript, '/t/a.jsonl', 'and where it was read from');

    const agent = crew.normalize({
      id: 'agent-a', class: 'worker', lastAt: '2026-07-27T12:00:00.000Z', startedAt: '2026-07-27T11:00:00.000Z', lastTool: 'Edit', lastToolAt: '2026-07-27T11:59:00.000Z',
    });
    assertEq(agent.lastActivity, Date.parse('2026-07-27T12:00:00.000Z'), 'a subagent says it in ISO and arrives in ms');
    assertEq(agent.aliveSince, Date.parse('2026-07-27T11:00:00.000Z'), 'the spawn stamp too');
    assertEq(agent.lastTool, 'Edit', 'what it last reached for');
    assertEq(agent.lastToolAt, Date.parse('2026-07-27T11:59:00.000Z'), 'and when');

    const bare = crew.normalize({ id: 'x' });
    assertEq(bare.lastActivity, null, 'a row carrying no time is unknown, never 1970');
    assertEq(bare.aliveSince, null, 'both ways');
    assertEq(crew.normalize({ id: 'y', lastAt: 'not a date' }).lastActivity, null, 'and an unparseable stamp is unknown too');
  });

  await test('the counters behind the total travel for the dialog, and a plain row has none', () => {
    const node = crew.normalize({ id: 'a', tokens: { input: 1, output: 2, total: 10 }, cost: 0.25 });
    assertEq(node.usage.input, 1, 'the input counter');
    assertEq(node.tokens, 10, 'beside the total the card draws');
    assertEq(node.cost, 0.25, 'and what it came to');
    assertEq(crew.normalize({ session: 'b' }).usage, null, 'a session row has no counters, which is not zeros');
    assertEq(crew.normalize({ session: 'b' }).cost, null, 'nor a cost');
  });

  await test('a connector runs the way the card actually sits from the trunk', () => {
    // Four children: two left of centre, two right, none on it.
    assertEq(crew.connectorFlow(0, 4), 'left', 'the far left card is reached by flowing left');
    assertEq(crew.connectorFlow(1, 4), 'left', 'so is the near one');
    assertEq(crew.connectorFlow(2, 4), 'right', 'and the right half flows right');
    assertEq(crew.connectorFlow(3, 4), 'right', 'to the end of the row');
    // An odd row has a card ON the trunk - its line is the drop, with no
    // sideways run to have a direction at all.
    assertEq(crew.connectorFlow(1, 3), 'down', 'the middle of three is straight below the parent');
    assertEq(crew.connectorFlow(0, 1), 'down', 'and an only child is always straight below it');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
