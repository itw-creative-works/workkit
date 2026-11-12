// tool.call Bash through the hooks module: workflow:bare-call in the module's
// Bash chain, a compound holding a kit step answered with the notice as the
// result's `context` plus one $.ui.log line and the call still run, the bare
// call answered with nothing. The verdict's own cases are test/hooks/bare-call.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, kitLogs, TOOL_SPY, bash, answered } from '../lib/mod-world.ts'

const noteFor = (step: string) => `bare-call: run \`${step}\` as its own Bash call from the repo root; inside a compound command it misses its allow rule and auto mode can refuse it.`
const NOTE = noteFor('workkit ship publish')
const WATCH_NOTE = noteFor('workkit watch --end')

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

  test('a compound holding workkit watch --end: the notice names workkit watch --end, the call run', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on)
    const command = 'cd pkg && workkit watch --end'
    await bash($, command)
    const r = answered(w)
    expect(r?.deny).toBeUndefined()
    expect(w.toolRan?.command).toBe(command)
    expect((r?.context ?? []).join('\n')).toContain(WATCH_NOTE)
  })

  test('the bare workkit watch --end run: the call run, nothing said', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on)
    await bash($, 'workkit watch --end run')
    const r = answered(w)
    expect(r?.deny).toBeUndefined()
    expect(w.toolRan?.command).toBe('workkit watch --end run')
    expect((r?.context ?? []).join('\n')).not.toContain('bare-call:')
    expect(kitLogs(w)).toHaveLength(0)
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
