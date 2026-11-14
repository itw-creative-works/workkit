// tool.call Bash through the hooks module: the Bash chain around its guards. safety:tree-guard is not on it: it
// judges git's real arguments in the git shim (test/scripts/gitshim.test.js, its verdict test/hooks/tree-guard.test.js),
// so the chain holds safety:capture-guard alone. Here: each fire logged, the guards-failed deny, the opt-in gate read
// off the call's real folders (the session folder's repo before the call; after it, the repo it started in or the one
// its event's cwd is in, never a `cd` in the text), HOOK_DISABLE, and a gh write passed on for the gh shim to judge.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, kitLogs, TOOL_SPY, REPO, PLAIN, HOME, SID, bash, answered, denyOf } from '../lib/mod-world.ts'

const verdictsOf = (w: any, hook: string) => hooksLog(w).filter((l: any) => l.hook === hook).map((l: any) => l.verdict)
// The Bash chain, in its order.
const GUARDS = ['safety:capture-guard']
const READ_CAPTURE = 'cat .workkit/capture.md'
const capture = { [`${REPO}/.workkit/capture.md`]: '# capture\n\n- a private thought\n' }

// One tool use, toolu_1: the call, whose mark records where it began, then its Post.
const call = ($: any, command: string) => $.tool.call({ tool: 'Bash', command, description: 'x', tool_use_id: 'toolu_1' } as any)
const post = ($: any, command: string, cwd: string) => $.classic.PostToolUse({
  tool_name: 'Bash', tool_input: { command }, tool_response: {}, tool_use_id: 'toolu_1', session_id: SID, cwd,
})

describe('tool.call Bash: the chain around its guards', () => {
  test('given $.session.cwd() failing, a Bash call is denied with the guards-failed text and never runs', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { cwdFails: true })
    await bash($, 'ls')
    expect(denyOf(w)?.startsWith('workkit: the guards failed before they could judge this call')).toBe(true)
    expect(w.toolRan).toBeUndefined()
  })

  test('one Bash call through the whole chain writes its fire lines with one read and one write of hooks.log', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on)
    await bash($, 'ls')
    const logFile = `${HOME}/.workkit/hooks.log`
    const ops = w.fsOps.filter((o: any) => o.path === logFile).map((o: any) => o.op)
    expect(ops).toEqual(['read', 'write'])
    expect(hooksLog(w).map((l: any) => l.hook)).toEqual(GUARDS)
  })

  test('a fire in an opted-in repo appends one six-field line ending in run: one line per guard', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on)
    await bash($, 'ls')
    for (const hook of GUARDS) expect(verdictsOf(w, hook)).toEqual(['run'])
    for (const l of hooksLog(w)) expect(l.line.split('\t')).toHaveLength(6)
    expect(w.toolRan?.command).toBe('ls')
    expect(kitLogs(w)).toHaveLength(0)
  })

  test('a fire in a repo that has not opted in appends one line ending in stood-down: and the call is not judged', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { repos: { [REPO]: null }, files: capture })
    await bash($, READ_CAPTURE)
    expect(answered(w)?.deny).toBeUndefined()
    for (const hook of GUARDS) expect(verdictsOf(w, hook)).toEqual(['stood-down'])
  })

  test('HOOK_DISABLE=1 no-ops a hook that would block: next(e) unchanged and no hooks-log line', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { env: { HOOK_DISABLE: '1' }, files: capture })
    await bash($, READ_CAPTURE)
    expect(answered(w)?.deny).toBeUndefined()
    expect(w.toolRan?.tool).toBe('Bash')
    expect(w.toolRan?.command).toBe(READ_CAPTURE)
    expect(hooksLog(w)).toHaveLength(0)
  })

  test('case 5: gh issue edit 12 --add-label status:qa with no Proof: comment passes the chain, the gh shim judging it', { plugins: [TOOL_SPY] }, async ($, on) => {
    const flip = 'gh issue edit 12 --add-label status:qa'
    const w = mkWorld(on, {
      gh: { issues: [], views: { 12: { comments: [{ body: 'looks good' }] } } },
      status: { [REPO]: ' M tests/a.test.js\n' },
      files: { [`${REPO}/package.json`]: JSON.stringify({ scripts: { test: 'node --test' } }), [`${REPO}/tests/a.test.js`]: 'process.exit(1);\n' },
    })
    await bash($, flip)
    expect(answered(w)?.deny).toBeUndefined()
    expect(w.toolRan?.command).toBe(flip)
  })
})

describe('the gate reads the call\'s real folder', () => {
  test('a session in an opted-in repo: a command that cds to a plain folder first is still judged', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { files: capture })
    await bash($, `cd ${PLAIN} && ${READ_CAPTURE}`)
    expect(verdictsOf(w, 'safety:capture-guard')).toEqual(['run'])
    expect(denyOf(w)?.startsWith('capture-guard: BLOCKED')).toBe(true)
  })

  test('a session in a plain folder: a command that cds into an opted-in repo first stands down', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { cwd: PLAIN, files: capture })
    await bash($, `cd ${REPO} && ${READ_CAPTURE}`)
    expect(verdictsOf(w, 'safety:capture-guard')).toEqual(['stood-down'])
    expect(answered(w)?.deny).toBeUndefined()
  })

  test('after the call, either root counts: a call from a plain session folder that ends in an opted-in repo runs the after-call chain', async ($, on) => {
    const w = mkWorld(on, { cwd: PLAIN })
    await call($, `cd ${REPO} && ls`)
    await post($, `cd ${REPO} && ls`, REPO)
    expect(verdictsOf(w, 'safety:script-write')).toEqual(['run'])
  })

  test('after the call, a call that starts and ends in plain folders and leaves no journal line stands the after-call chain down', async ($, on) => {
    const w = mkWorld(on, { cwd: PLAIN })
    await call($, 'ls')
    await post($, 'ls', PLAIN)
    expect(verdictsOf(w, 'safety:script-write')).toEqual(['stood-down'])
  })
})
