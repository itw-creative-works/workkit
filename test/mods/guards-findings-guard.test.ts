// tool.call Bash through the hooks module: safety:findings-guard in the Bash
// chain, findings.file read from the repo's .workkit/settings.json over the
// machine's ~/.workkit/settings.json, and its deny.
// The verdict's own cases are test/hooks/findings-guard.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, TOOL_SPY, REPO, HOME, bash, answered, denyOf } from '../lib/mod-world.ts'

const CREATE = 'gh issue create --title "review notes from the 0.19.0 ship" --body "..."'
const BLOCK = "findings-guard: BLOCKED this gh issue create: a review notes issue files findings, and findings.file is not on for this repo.\nSay findings in chat under 🧭 Findings instead, one bullet each, for the owner to answer file or drop; file nothing on your own. findings.file: true in the settings file (the repo's .workkit/settings.json, or ~/.workkit/settings.json) turns filing on."
const settings = (findings?: boolean) => `${JSON.stringify({ version: 1, enabled: true, ...(findings === undefined ? {} : { findings: { file: findings } }) })}\n`


describe('tool.call Bash: safety:findings-guard', () => {
  test('ports "no findings.file key in either file: the create bounces, naming the chat route and the toggle"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { files: { [`${HOME}/.workkit/settings.json`]: '{ "version": 1 }\n' } })
    await bash($, CREATE)
    expect(denyOf(w)).toBe(BLOCK)
    expect(w.toolRan).toBeUndefined()
    expect(hooksLog(w).filter((l: any) => l.hook === 'safety:findings-guard').map((l: any) => l.verdict)).toEqual(['run'])
  })

  test('ports "true globally and false in the repo file bounces; false globally and true in the repo file passes"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const off = mkWorld(on, { repos: { [REPO]: settings(false) }, files: { [`${HOME}/.workkit/settings.json`]: settings(true) } })
    await bash($, CREATE)
    expect(denyOf(off)).toBe(BLOCK)
  })

  test('ports "findings.file true in the repo file and false globally: it passes"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { repos: { [REPO]: settings(true) }, files: { [`${HOME}/.workkit/settings.json`]: settings(false) } })
    await bash($, CREATE)
    expect(answered(w)?.deny).toBeUndefined()
    expect(w.toolRan?.command).toBe(CREATE)
  })

  test('ports "findings.file true in the global file and no repo key: it passes"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { repos: { [REPO]: settings() }, files: { [`${HOME}/.workkit/settings.json`]: settings(true) } })
    await bash($, CREATE)
    expect(answered(w)?.deny).toBeUndefined()
  })
})
