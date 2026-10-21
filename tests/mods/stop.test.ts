// classic.Stop through the hooks module: manager:close-guard reads the turn off
// $.session.messages() and the model off $.session.model(), warns through one
// $.ui.log line, and passes the event on untouched, never a block or a context.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, row, REPO, SID, MODELS } from '../lib/mod-world.ts'

const stop = ($: any, extra: any = {}) => $.classic.Stop({
  hook_event_name: 'Stop', session_id: SID, cwd: REPO, stop_hook_active: false, ...extra,
})
const edits = (n: number) => Array.from({ length: n }, () => [row.tool('Edit', { file_path: '/x', old_string: 'a', new_string: 'b' }), row.result()]).flat()
const spawn = (type: string) => [row.tool('Task', { subagent_type: type, prompt: 'brief' }), row.result()]
const guardLogs = (w: any) => w.logs.filter((l: string) => l.startsWith('manager:close-guard:'))
const RULE3 = (n: number) => `manager:close-guard: the frontier model made ${n} edits itself this turn with no worker spawn: implementation belongs with workkit:worker.`
const settings = (manager: unknown) => JSON.stringify({ version: 1, enabled: true, manager })

describe('classic.Stop: the Contract cases', () => {
  test('stop_hook_active: true says nothing (ports "stop_hook_active is silent (the turn was judged once)")', async ($, on) => {
    const w = mkWorld(on, { model: MODELS.fable, messages: [row.user(), ...edits(6)] })
    await stop($, { stop_hook_active: true })
    expect(guardLogs(w)).toHaveLength(0)
    expect(w.reached.filter((e: string) => e === 'classic.Stop')).toHaveLength(1)
  })

  test('five edits after the last owner prompt, a frontier model and no spawn: the rule 3 line', async ($, on) => {
    const w = mkWorld(on, { model: MODELS.fable, messages: [row.user(), ...edits(5)] })
    await stop($)
    expect(guardLogs(w)).toEqual([RULE3(5)])
    expect(hooksLog(w).some((l: any) => l.hook === 'manager:close-guard' && l.verdict === 'run')).toBe(true)
  })

  test('four edits: no line', async ($, on) => {
    const w = mkWorld(on, { model: MODELS.fable, messages: [row.user(), ...edits(4)] })
    await stop($)
    expect(guardLogs(w)).toHaveLength(0)
  })

  test('MANAGER_CLOSE_EDITS=2 and two edits: the line', async ($, on) => {
    const w = mkWorld(on, { model: MODELS.fable, env: { MANAGER_CLOSE_EDITS: '2' }, messages: [row.user(), ...edits(2)] })
    await stop($)
    expect(guardLogs(w)).toEqual([RULE3(2)])
  })

  test('one Task spawn of workkit:worker and no verifier: the rule 4 line', async ($, on) => {
    const w = mkWorld(on, { model: MODELS.fable, messages: [row.user(), ...spawn('workkit:worker')] })
    await stop($)
    const lines = guardLogs(w)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('verifier')
    expect(lines[0]).toContain('consider')
    expect(lines[0].endsWith('.')).toBe(true)
  })

  test('a worker and a verifier: no line', async ($, on) => {
    const w = mkWorld(on, { model: MODELS.fable, messages: [row.user(), ...spawn('workkit:worker'), ...spawn('workkit:verifier')] })
    await stop($)
    expect(guardLogs(w)).toHaveLength(0)
  })

  test('a workhorse model: no rule 3', async ($, on) => {
    const w = mkWorld(on, { model: MODELS.opus, messages: [row.user(), ...edits(6)] })
    await stop($)
    expect(guardLogs(w)).toHaveLength(0)
  })

  test('manager.enabled: false in the repo settings: no line (ports "enabled: false silences the guard")', async ($, on) => {
    const w = mkWorld(on, { model: MODELS.fable, repos: { [REPO]: settings({ enabled: false }) }, messages: [row.user(), ...edits(6)] })
    await stop($)
    expect(guardLogs(w)).toHaveLength(0)
  })

  test('a system-framed user entry after the edits: the edits still count', async ($, on) => {
    const handBack = row.user('[Subagent hand-back]\nDONE: the brief is built.')
    const w = mkWorld(on, { model: MODELS.fable, messages: [row.user(), ...edits(5), handBack] })
    await stop($)
    expect(guardLogs(w)).toEqual([RULE3(5)])
  })

  test('the last owner prompt followed by nothing: no line, and next ran once', async ($, on) => {
    const w = mkWorld(on, { model: MODELS.fable, messages: [row.user(), ...edits(6), row.user('thanks, that is all')] })
    await stop($)
    expect(guardLogs(w)).toHaveLength(0)
    expect(w.reached.filter((e: string) => e === 'classic.Stop')).toHaveLength(1)
  })
})

describe('classic.Stop: the answer and the gate', () => {
  test('ports "the output never continues the turn": no block, no context, the event passed on once', async ($, on) => {
    const w = mkWorld(on, { model: MODELS.fable })
    for (const [i, messages] of [[row.user(), ...edits(6)], [row.user(), ...spawn('worker')]].entries()) {
      w.messages = messages
      const r = await stop($)
      expect(guardLogs(w)).toHaveLength(i + 1)
      expect(r?.block).toBeUndefined()
      expect(r?.preventContinuation).toBeUndefined()
      expect(r?.additionalContext).toBeUndefined()
      expect(w.reached.filter((e: string) => e === 'classic.Stop')).toHaveLength(i + 1)
    }
  })

  test('ports "HOOK_DISABLE=1 is a silent no-op": no line, no hooks-log line, the event passed on', async ($, on) => {
    const w = mkWorld(on, { model: MODELS.fable, env: { HOOK_DISABLE: '1' }, messages: [row.user(), ...edits(6)] })
    await stop($)
    expect(guardLogs(w)).toHaveLength(0)
    expect(hooksLog(w).filter((l: any) => l.hook === 'manager:close-guard')).toHaveLength(0)
    expect(w.reached.filter((e: string) => e === 'classic.Stop')).toHaveLength(1)
  })

  test('a repo that has not opted in: no line, and the fire logs stood-down', async ($, on) => {
    const w = mkWorld(on, { model: MODELS.fable, repos: { [REPO]: null }, messages: [row.user(), ...edits(6)] })
    await stop($)
    expect(guardLogs(w)).toHaveLength(0)
    expect(hooksLog(w).some((l: any) => l.hook === 'manager:close-guard' && l.verdict === 'stood-down')).toBe(true)
  })
})
