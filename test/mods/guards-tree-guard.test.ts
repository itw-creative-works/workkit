// tool.call Bash through the hooks module: safety:tree-guard in the module's
// Bash chain, its deny, the escape's notice as the result's `context` plus one
// $.ui.log line, and the path probe answered by the world's files.
// The verdict's own cases are test/hooks/tree-guard.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, toolSpied, kitLogs, TOOL_SPY, REPO, HOME, bash, answered, denyOf } from '../lib/mod-world.ts'

const BLOCK = (found: string) => `tree-guard: BLOCKED this command: it runs ${found}, which discards or parks working-tree state, and this tree is SHARED: reverting your own edits that way takes whatever else is uncommitted with it (issue #157).\nRevert your own changes by reverse-editing your own hunks: edit each file back to what it was. If the discard is genuinely intended, the OWNER reruns the command with WORKKIT_ALLOW_DISCARD=1 in front of it.`
const ASIDE = 'tree-guard: stood aside for a deliberate discard: WORKKIT_ALLOW_DISCARD=1 is set on this command (git reset --hard).'

const verdicts = (w: any) => hooksLog(w).filter((l: any) => l.hook === 'safety:tree-guard').map((l: any) => l.verdict)

describe('tool.call Bash: safety:tree-guard', () => {
  test('ports "the loader routes safety:tree-guard to the script": git reset --hard is denied with the hook\'s text, its run line logged', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on)
    await bash($, 'git reset --hard')
    expect(denyOf(w)).toBe(BLOCK('git reset --hard'))
    expect(w.toolRan).toBeUndefined()
    expect(verdicts(w)).toEqual(['run'])
  })

  test('given WORKKIT_ALLOW_DISCARD=1 and git reset --hard: no deny, the notice in context, one $.ui.log line', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on)
    await bash($, 'WORKKIT_ALLOW_DISCARD=1 git reset --hard')
    const r = answered(w)
    expect(r?.deny).toBeUndefined()
    expect(w.toolRan?.command).toBe('WORKKIT_ALLOW_DISCARD=1 git reset --hard')
    expect(Array.isArray(r?.context)).toBe(true)
    expect(r.context.join('\n')).toContain(ASIDE)
    const logged = kitLogs(w)
    expect(logged).toHaveLength(1)
    expect(logged[0]).toContain(ASIDE)
  })

  test('ports "checkout with . or a path-looking token: exit 2": a path the repo holds is a pathspec, a branch name is not', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { files: { [`${REPO}/src/app.js`]: 'const x = 1;\n' } })
    await bash($, 'git checkout src/app.js')
    expect(denyOf(w)).toBe(BLOCK('git checkout with a pathspec'))
    await bash($, 'git checkout feature/thing')
    expect(toolSpied(w)[1]?.deny).toBeUndefined()
    expect(w.toolRan?.command).toBe('git checkout feature/thing')
  })
})

describe('tool.call Bash: the chain around its guards', () => {
  test('given $.session.cwd() failing, a Bash call is denied with the guards-failed text and never runs', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { cwdFails: true })
    await bash($, 'ls')
    expect(denyOf(w)?.startsWith('workkit: the guards failed before they could judge this call')).toBe(true)
    expect(w.toolRan).toBeUndefined()
  })

  test('one Bash call through the ten guards writes its fire lines with one read and one write of hooks.log', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on)
    await bash($, 'ls')
    const logFile = `${HOME}/.workkit/hooks.log`
    const ops = w.fsOps.filter((o: any) => o.path === logFile).map((o: any) => o.op)
    expect(ops).toEqual(['read', 'write'])
    const guards = ['commit-gate', 'commit-language', 'release-taken', 'tree-guard', 'issue-guard', 'proof-guard', 'spec-guard', 'suite-guard', 'capture-guard', 'findings-guard']
    const logged = new Set(hooksLog(w).map((l: any) => l.hook))
    expect(guards.filter((g) => !logged.has(`safety:${g}`))).toEqual([])
  })
})
