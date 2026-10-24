// tool.call Bash through the hooks module: safety:spec-guard in the Bash
// chain, its body read through gh from the session's folder, its deny, and a
// gh that cannot answer passing the flip with one $.ui.log line.
// The verdict's own cases are test/hooks/spec-guard.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, kitLogs, TOOL_SPY, REPO, bash, answered, denyOf } from '../lib/mod-world.ts'

const BLOCK = (n: number) => `spec-guard: BLOCKED this flip: #${n} has a written Spec with no ### Contract (docs/project-state.md § Specs): add Files, Names and Cases, or the small-item line None needed: small item., then flip.`
const SKIPPED = (n: number) => `spec-guard: could not read issue #${n} (gh could not answer), so the spec gate did not run on this command.`
const FLIP = (n: number) => `gh issue edit ${n} --remove-label status:inbox --add-label status:specced`
const VIEWS = {
  12: { body: '## Description\n\nA typo.\n\n## Spec\n\nNone needed: small item.\n' },
  14: { body: '## Description\n\nX.\n\n## Spec\n\nBuild the thing, carefully.\n\n## Notes\n\nnone\n' },
}

const issueViews = (w: any) => w.ghCalls().filter((c: any) => c.argv[1] === 'issue' && c.argv[2] === 'view')

describe('tool.call Bash: safety:spec-guard', () => {
  test('ports "a written Spec with no ### Contract blocks, with the exact line": and "the read runs in the session\'s directory"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { gh: { issues: [], views: VIEWS } })
    await bash($, FLIP(14))
    expect(denyOf(w)).toBe(BLOCK(14))
    expect(w.toolRan).toBeUndefined()
    const views = issueViews(w)
    expect(views).toHaveLength(1)
    expect(views[0].argv).toEqual(expect.arrayContaining(['14', '--json', 'body']))
    expect(views[0].init.cwd).toBe(REPO)
    expect(hooksLog(w).filter((l: any) => l.hook === 'safety:spec-guard').map((l: any) => l.verdict)).toEqual(['run'])
  })

  test('ports "the small-item Spec passes, silently"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { gh: { issues: [], views: VIEWS } })
    await bash($, FLIP(12))
    expect(answered(w)?.deny).toBeUndefined()
    expect(w.toolRan?.command).toBe(FLIP(12))
    expect(kitLogs(w)).toHaveLength(0)
  })

  for (const gh of ['offline', 'absent']) {
    test(`given gh answering an error (${gh}), then spec-guard passes with a $.ui.log line: ports "a gh view that fails" and "gh not on PATH"`, { plugins: [TOOL_SPY] }, async ($, on) => {
      const w = mkWorld(on, { gh })
      await bash($, FLIP(14))
      expect(answered(w)?.deny).toBeUndefined()
      expect(w.toolRan?.command).toBe(FLIP(14))
      expect((answered(w)?.context || []).join('\n')).toContain(SKIPPED(14))
      const logged = kitLogs(w)
      expect(logged).toHaveLength(1)
      expect(logged[0]).toContain(SKIPPED(14))
    })
  }
})
