//
// The crew tree: what the Crew page draws, worked out before any of it is
// markup.
//
// It reads the two rosters the API serves — a `/api/telemetry` session with its
// subagents, and a bare `/api/sessions` row, which is the same root tier
// without them — and answers one node shape for both. It lives apart from the
// page so the suite can ask it what it made of a payload without a browser.
//

/**
 * One node of the chart, from either roster.
 *
 * A telemetry session carries `tokens` and `subagents`; a plain session row
 * carries neither, and its id is `session` rather than `id`. Those are the only
 * two shapes either endpoint sends.
 *
 * @param {object} node a session or subagent row
 * @returns {{id: string, title: string, cwd: string, model: string, effort: string, state: string, agentClass: string, tokens: number|null, children: object[]}}
 */
export const normalize = (node) => ({
  id: node.id || node.session || '',
  title: node.chatName || '',
  cwd: node.cwd || '',
  model: node.model || '',
  effort: node.effort || '',
  state: node.state || '',
  agentClass: node.class || '',
  tokens: node.tokens ? node.tokens.total : null,
  children: (node.subagents || []).map(normalize),
});

/**
 * A session's subagents split by whether they are still running.
 *
 * The API stamps each one `working` or `done` from how recently its transcript
 * moved. A session's transcript holds every subagent it EVER spawned, so
 * drawing them all as cards shows dozens of finished agents as live crew — the
 * finished ones are a count, not a chart.
 *
 * @param {object[]} children normalized subagent nodes
 * @returns {{working: object[], done: object[]}}
 */
export const splitCrew = (children) => ({
  working: children.filter((child) => child.state === 'working'),
  done: children.filter((child) => child.state !== 'working'),
});

/** How many subagents are working across the whole tree, and how many exist. */
export const crewCount = (tree) => ({
  working: tree.reduce((sum, entry) => sum + splitCrew(entry.children).working.length, 0),
  total: tree.reduce((sum, entry) => sum + entry.children.length, 0),
});
