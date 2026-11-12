// tool.call Bash through the hooks module: workflow:unwatched in the module's
// Bash chain, a call's run_in_background reaching it as a background call:
// answered with the notice as the result's `context` plus one $.ui.log line and
// the call still run, the same command in the foreground answered with nothing.
// The verdict's own cases are test/hooks/unwatched.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, kitLogs, TOOL_SPY, bash, answered } from '../lib/mod-world.ts'

const COMMAND = 'npm test -- test/x.test.js'
const NOTE = `workflow:unwatched: the supervisor does not read this background test run; start that step as workkit supervise -- ${COMMAND}`

const verdicts = (w: any) => hooksLog(w).filter((l: any) => l.hook === 'workflow:unwatched').map((l: any) => l.verdict)

describe('tool.call Bash: workflow:unwatched', () => {
  test('a background npm test -- test/x.test.js: no deny, the notice in context, one $.ui.log line, the call run', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on)
    await $.tool.call({ tool: 'Bash', command: COMMAND, description: 'x', run_in_background: true } as any)
    const r = answered(w)
    expect(r?.deny).toBeUndefined()
    expect(w.toolRan?.command).toBe(COMMAND)
    expect(Array.isArray(r?.context)).toBe(true)
    expect(r.context.join('\n')).toContain(NOTE)
    const logged = kitLogs(w)
    expect(logged).toHaveLength(1)
    expect(logged[0]).toContain(NOTE)
    expect(verdicts(w)).toEqual(['run'])
  })

  test('the same command not in the background: the call run, nothing said', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on)
    await bash($, COMMAND)
    const r = answered(w)
    expect(r?.deny).toBeUndefined()
    expect(w.toolRan?.command).toBe(COMMAND)
    expect((r?.context ?? []).join('\n')).not.toContain('workflow:unwatched:')
    expect(kitLogs(w)).toHaveLength(0)
  })
})
