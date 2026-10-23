// classic.SubagentStart through the hooks module: manager:addon stacks a
// personal add-on onto a workkit:<name> spawn. This event, one hook on it,
// also carries the hooks-log cases: where the line lands and the cap.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, contextOf, HOME, REPO, SID } from '../lib/mod-world.ts'

const start = ($: any, agentType: string) => $.classic.SubagentStart({
  agent_id: 'agent-abc123', agent_type: agentType, session_id: SID, cwd: REPO,
})

describe('classic.SubagentStart: manager:addon', () => {
  test('ports "workkit:verifier with an add-on gets the header and the text"', async ($, on) => {
    const file = '/w/wh/agents/verifier.md'
    mkWorld(on, { env: { WORKFLOW_HOME: '/w/wh' }, files: { [file]: 'Always check the Windows lane.\nSecond line.\n' } })
    const r = await start($, 'workkit:verifier')
    const [header, ...body] = contextOf(r).split('\n')
    expect(header).toBe(`Personal add-on for workkit:verifier (from ${file}):`)
    expect(body.join('\n')).toBe('Always check the Windows lane.\nSecond line.')
  })

  test("ports \"each agent reads its own file, not a sibling's\"", async ($, on) => {
    mkWorld(on, { env: { WORKFLOW_HOME: '/w/wh' }, files: { '/w/wh/agents/verifier.md': 'verifier only', '/w/wh/agents/scout.md': 'scout only' } })
    const ctx = contextOf(await start($, 'workkit:scout'))
    expect(ctx).toContain('scout only')
    expect(ctx).not.toContain('verifier only')
  })

  test('ports "with no WORKFLOW_HOME the add-on is read from ~/.workkit"', async ($, on) => {
    mkWorld(on, { files: { [`${HOME}/.workkit/agents/worker.md`]: 'from the default home' } })
    expect(contextOf(await start($, 'workkit:worker'))).toContain('from the default home')
  })

  test('ports "no add-on file: exit 0, no output"', async ($, on) => {
    mkWorld(on, { env: { WORKFLOW_HOME: '/w/wh' }, files: { '/w/wh/agents/other.md': 'x' } })
    expect(contextOf(await start($, 'workkit:verifier'))).toBe('')
  })

  for (const type of ['Explore', 'verifier', 'other-plugin:verifier']) {
    test(`ports "agent_type ${type} gets nothing, even with a matching file"`, async ($, on) => {
      mkWorld(on, { env: { WORKFLOW_HOME: '/w/wh' }, files: { '/w/wh/agents/verifier.md': 'must not leak' } })
      expect(contextOf(await start($, type))).toBe('')
    })
  }

  test('ports "an unreadable add-on exits non-zero naming the file": the agent runs as shipped', async ($, on) => {
    const file = '/w/wh/agents/verifier.md'
    mkWorld(on, { env: { WORKFLOW_HOME: '/w/wh' }, files: { [file]: 'locked away' }, unreadable: [file] })
    const r = await start($, 'workkit:verifier')
    expect(contextOf(r)).not.toContain('locked away')
    expect(r.block).toBeUndefined()
  })

  test('ports "loader routes manager:addon": the fire leaves a run line', async ($, on) => {
    const w = mkWorld(on, { files: { [`${HOME}/.workkit/agents/scout.md`]: 'through the module' } })
    expect(contextOf(await start($, 'workkit:scout'))).toContain('through the module')
    const lines = hooksLog(w).filter((l: any) => l.hook === 'manager:addon')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ event: 'SubagentStart', sid: SID, cwd: REPO, verdict: 'run' })
    expect(lines[0].iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })
})

describe('the hooks log', () => {
  test('a log at 10,001 lines is cut to its last 5,000 before the line is added', async ($, on) => {
    const old = Array.from({ length: 10001 }, (_, i) => `old-${i + 1}`)
    const w = mkWorld(on, { files: { [`${HOME}/.workkit/hooks.log`]: `${old.join('\n')}\n` } })
    await start($, 'workkit:scout')
    const lines = (w.files.get(`${HOME}/.workkit/hooks.log`) as string).split('\n').filter(Boolean)
    const kept = lines.filter((l: string) => l.startsWith('old-'))
    expect(kept).toHaveLength(5000)
    expect(kept[0]).toBe('old-5002')
    expect(kept[4999]).toBe('old-10001')
    expect(lines.slice(5000).every((l: string) => l.split('\t').length === 6)).toBe(true)
    expect(lines.length).toBeGreaterThan(5000)
  })
})
