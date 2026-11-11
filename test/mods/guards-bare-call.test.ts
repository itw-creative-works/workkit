// tool.call Bash through the hooks module: workflow:bare-call in the module's
// Bash chain, a compound holding a kit step answered with the notice as the
// result's `context` plus one $.ui.log line and the call still run, the bare
// call answered with nothing. The verdict's own cases are test/hooks/bare-call.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, kitLogs, TOOL_SPY, bash, answered } from '../lib/mod-world.ts'

const NOTE = 'bare-call: run `workkit ship publish` as its own Bash call from the repo root; inside a compound command it misses its allow rule and auto mode can refuse it.'

const verdicts = (w: any) => hooksLog(w).filter((l: any) => l.hook === 'workflow:bare-call').map((l: any) => l.verdict)

describe('tool.call Bash: workflow:bare-call', () => {
  test('a compound holding workkit ship publish: no deny, the notice in context, one $.ui.log line, the call run', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on)
    const command = 'cd /w/repo && workkit ship publish 2>&1 | tail -12'
    await bash($, command)
    const r = answered(w)
    expect(r?.deny).toBeUndefined()
    expect(w.toolRan?.command).toBe(command)
    expect(Array.isArray(r?.context)).toBe(true)
    expect(r.context.join('\n')).toContain(NOTE)
    const logged = kitLogs(w)
    expect(logged).toHaveLength(1)
    expect(logged[0]).toContain(NOTE)
    expect(verdicts(w)).toEqual(['run'])
  })

  test('the bare workkit ship publish: the call run, nothing said', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on)
    await bash($, 'workkit ship publish')
    const r = answered(w)
    expect(r?.deny).toBeUndefined()
    expect(w.toolRan?.command).toBe('workkit ship publish')
    expect((r?.context ?? []).join('\n')).not.toContain('bare-call:')
    expect(kitLogs(w)).toHaveLength(0)
  })
})
