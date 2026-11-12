// tool.call Bash through the hooks module: safety:script-write in the Bash
// chain, its deny, the escape's notice as the result's `context` plus one
// $.ui.log line, and a rewrite of the capture file answered by capture-guard
// first. The verdict's own cases are test/hooks/script-write.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, kitLogs, TOOL_SPY, REPO, bash, answered, denyOf } from '../lib/mod-world.ts'

const PREFIX = 'script-write: BLOCKED this command:'
const ESCAPE = 'WORKKIT_ALLOW_SCRIPT_WRITE'
const REWRITE = "capture-guard: BLOCKED rewriting .workkit/capture.md: its entries are cleared only by the triage drain, and no drain is running.\nRun the workkit:triage skill, which records the marker this guard checks, and clear it there. Adding entries is never the agent's at all: say findings in chat under 🧭 Findings instead, one bullet each, for the owner to answer file or drop; file nothing on your own."

const verdicts = (w: any) => hooksLog(w).filter((l: any) => l.hook === 'safety:script-write').map((l: any) => l.verdict)

describe('tool.call Bash: safety:script-write', () => {
  test('sed -i on a tracked file: denied with the guard\'s text naming sed and the escape, its run line logged, the command not run', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { files: { [`${REPO}/src/x.js`]: 'const a = 1;\n' } })
    await bash($, "sed -i 's/a/b/' src/x.js")
    const deny = denyOf(w)
    expect(deny?.startsWith(PREFIX)).toBe(true)
    expect(deny).toContain('sed')
    expect(deny).toContain(ESCAPE)
    expect(w.toolRan).toBeUndefined()
    expect(verdicts(w)).toEqual(['run'])
  })

  test('given WORKKIT_ALLOW_SCRIPT_WRITE=1 and sed -i: no deny, the stood-aside notice in context, one $.ui.log line, the call run', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { files: { [`${REPO}/src/x.js`]: 'const a = 1;\n' } })
    const command = "WORKKIT_ALLOW_SCRIPT_WRITE=1 sed -i 's/a/b/' src/x.js"
    await bash($, command)
    const r = answered(w)
    expect(r?.deny).toBeUndefined()
    expect(w.toolRan?.command).toBe(command)
    expect(Array.isArray(r?.context)).toBe(true)
    const said = r.context.join('\n')
    expect(said).toContain('script-write:')
    expect(said).toContain('stood aside')
    const logged = kitLogs(w)
    expect(logged).toHaveLength(1)
    expect(logged[0]).toContain('stood aside')
  })

  test('sed -i on the capture file: capture-guard\'s rewrite refusal answers first', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { files: { [`${REPO}/.workkit/capture.md`]: '# capture\n\n- a private thought\n' } })
    await bash($, "sed -i '' 's/a/b/' .workkit/capture.md")
    expect(denyOf(w)).toBe(REWRITE)
    expect(w.toolRan).toBeUndefined()
  })
})
