// classic.PreToolUse through the hooks module, reached the way a session
// reaches it, through $.tool.call: manager:spawn-guard warns on a Task/Agent
// call as additionalContext plus a $.ui.log line, and never decides the call.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, spied, SPY, MODELS } from '../lib/mod-world.ts'

const agentCall = ($: any, subagentType: string, extra: any = {}) => $.tool.call({
  tool: 'Agent', subagent_type: subagentType, prompt: 'do the thing', description: 'a task', ...extra,
})

describe('classic.PreToolUse: manager:spawn-guard', () => {
  test('ports "<class> with model: haiku warns": the warning reaches the context and the log', { plugins: [SPY] }, async ($, on) => {
    const w = mkWorld(on)
    await agentCall($, 'workkit:worker', { model: 'haiku' })
    const answered = spied(w)
    expect(answered).toHaveLength(1)
    const ctx = (answered[0]?.additionalContext || []).join('\n')
    expect(ctx).toContain('manager:resolver')
    expect(ctx).toContain('worker')
    expect(w.logs.some((l: string) => !l.startsWith('spy:') && l.includes('manager:resolver'))).toBe(true)
    expect(w.toolRan).toBeDefined()
  })

  test('ports "the same spawn WITHOUT a model param is silent"', { plugins: [SPY] }, async ($, on) => {
    const w = mkWorld(on)
    await agentCall($, 'workkit:worker')
    expect(spied(w)[0]?.additionalContext).toBeUndefined()
    expect(w.logs.filter((l: string) => !l.startsWith('spy:'))).toHaveLength(0)
  })

  test('ports "no path ever returns a permission decision"', { plugins: [SPY] }, async ($, on) => {
    const w = mkWorld(on, { model: MODELS.fable })
    for (const [type, extra] of [
      ['workkit:worker', { model: 'haiku' }],
      ['workkit:advisor', {}],
      ['workkit:advisor', { model: 'haiku' }],
      ['workkit:scout', { model: 'sonnet' }],
    ] as const) {
      w.toolRan = undefined
      await agentCall($, type, extra)
      expect(w.toolRan).toBeDefined()
    }
    const answers = spied(w)
    expect(answers).toHaveLength(4)
    for (const a of answers) {
      expect((a.additionalContext || []).length).toBeGreaterThan(0)
      expect(a.deny).toBeUndefined()
      expect(a.ask).toBeUndefined()
      expect(a.allow).toBeUndefined()
      expect(a.updatedInput).toBeUndefined()
    }
  })

  test('ports "an advisor spawn from a frontier session warns": the session model comes from $.session.model()', { plugins: [SPY] }, async ($, on) => {
    const w = mkWorld(on, { model: MODELS.fable })
    await agentCall($, 'workkit:advisor')
    expect((spied(w)[0]?.additionalContext || []).join('\n')).toContain('redundant')
  })

  test('ports "a non-Agent tool is silent"', { plugins: [SPY] }, async ($, on) => {
    const w = mkWorld(on)
    await $.tool.call({ tool: 'Bash', command: 'echo hi', description: 'x', model: 'haiku' } as any)
    expect(w.logs.filter((l: string) => !l.startsWith('spy:') )).toHaveLength(0)
    expect(hooksLog(w).some((l: any) => l.hook === 'manager:spawn-guard')).toBe(false)
  })

  test('ports "a missing ladder is silent"', { plugins: [SPY] }, async ($, on) => {
    const w = mkWorld(on)
    w.touchKit('hooks/manager/resources/ladder.json', null)
    await agentCall($, 'workkit:worker', { model: 'haiku' })
    expect(spied(w)[0]?.additionalContext).toBeUndefined()
    expect(w.toolRan).toBeDefined()
  })

  test('ports "an unparseable ladder is silent"', { plugins: [SPY] }, async ($, on) => {
    const w = mkWorld(on, { kit: { 'hooks/manager/resources/ladder.json': 'not json {' } })
    await agentCall($, 'workkit:worker', { model: 'haiku' })
    expect(spied(w)[0]?.additionalContext).toBeUndefined()
  })

  test('ports "loader routes manager:spawn-guard": the fire leaves a run line in the hooks log', { plugins: [SPY] }, async ($, on) => {
    const w = mkWorld(on)
    await agentCall($, 'workkit:worker', { model: 'haiku' })
    expect(hooksLog(w).some((l: any) => l.hook === 'manager:spawn-guard' && l.verdict === 'run')).toBe(true)
  })

  test('ports "HOOK_DISABLE=1 is a silent no-op"', { plugins: [SPY] }, async ($, on) => {
    const w = mkWorld(on, { env: { HOOK_DISABLE: '1' } })
    await agentCall($, 'workkit:worker', { model: 'haiku' })
    expect(spied(w)[0]?.additionalContext).toBeUndefined()
    expect(w.toolRan).toBeDefined()
  })
})
