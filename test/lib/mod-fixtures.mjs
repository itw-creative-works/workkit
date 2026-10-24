// The fixtures both test halves share, as one ES module: the logic suites reach
// it through test/lib/mods-inputs.js (Node requires it), the wiring suites
// through test/lib/mod-world.ts (the engine imports it).

/** A session model id per ladder rung, as $.session.model() answers them. */
export const MODELS = {
  fable: 'claude-fable-5[1m]', opus: 'claude-opus-4-7', sonnet: 'claude-sonnet-4-5', haiku: 'claude-haiku-4-5',
}

/** The fixed clock the brief cases count from, milliseconds since the epoch. */
export const SESSION_NOW = Date.UTC(2026, 9, 21, 12, 0, 0)

/** The UTC calendar date `n` whole days before `now`, the calendar the brief bar counts in. */
export const daysBefore = (n, now = SESSION_NOW) => new Date(now - (n * 86400000)).toISOString().slice(0, 10)

/**
 * brief-status.json as the 9am job writes it: the newest brief `briefDays`
 * back, read off the board `checkedDays` back (today unless the machine was off).
 */
export const briefMarker = (briefDays, checkedDays = 0, now = SESSION_NOW) => ({
  version: 1, lastBrief: daysBefore(briefDays, now), checkedAt: `${daysBefore(checkedDays, now)}T09:00:00Z`,
})

/**
 * One $.session.messages() row, SessionMessage's shape: an owner or system
 * prompt (`row.user(text)`), a tool's answer (`row.result()`), or an assistant
 * turn calling one tool (`row.tool(name, input)`).
 */
let toolUses = 0
export const row = {
  user: (text = 'do the thing') => ({ role: 'user', text, toolUses: [] }),
  result: () => ({ role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: `t${toolUses}`, text: 'ok' }] }),
  tool: (tool, input = {}) => {
    toolUses += 1
    return { role: 'assistant', text: '', toolUses: [{ tool_use_id: `t${toolUses}`, tool, input, text: 'ok' }] }
  },
}
