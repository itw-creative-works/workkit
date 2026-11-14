// tool.call Bash through the hooks module: safety:capture-guard, the Bash chain's one guard. The module makes the
// one text match, whether the command contains .workkit/capture.md, and hands the guard that answer alone. A match
// with no triage marker under 30 minutes old (read off the world's files by its age, keyed to the call's repo) is
// refused, a count included; inside a triage run it runs. A command with no such path runs, whatever it writes:
// the disk check after the call reports that (test/mods/guards-script-write.test.ts).
// The guard on its boolean is test/hooks/capture-guard/bash-path.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, TOOL_SPY, REPO, bash, denyOf } from '../lib/mod-world.ts'

const NOW = 1800000000000
const TMPDIR = '/w/tmp'
const REPO_MARKER = '/w/home/.workkit/markers/claude-triage-marker/2d98e56dc36b7431b8f668bf4d7715c564698d73'

const verdicts = (w: any) => hooksLog(w).filter((l: any) => l.hook === 'safety:capture-guard').map((l: any) => l.verdict)
const refused = (w: any, i = 0) => denyOf(w, i)?.startsWith('capture-guard: BLOCKED') ?? false

// A world with the clock fixed, the repo's capture file, and the repo's marker given its age in seconds.
const world = (on: any, markerAgeS: number | null = null) => {
  const files: Record<string, string> = { [`${REPO}/.workkit/capture.md`]: '# capture\n\n- a private thought\n' }
  if (markerAgeS !== null) files[REPO_MARKER] = ''
  const w = mkWorld(on, { now: NOW, env: { TMPDIR }, files })
  if (markerAgeS !== null) w.mtimes.set(REPO_MARKER, NOW - markerAgeS * 1000)
  return w
}

describe('tool.call Bash: safety:capture-guard', () => {
  test('a command containing .workkit/capture.md and no triage marker: refused before it runs, its run line logged', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on)
    await bash($, 'cat .workkit/capture.md')
    expect(refused(w)).toBe(true)
    expect(w.toolRan).toBeUndefined()
    expect(verdicts(w)).toEqual(['run'])
  })

  test('a count is refused the same way', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on)
    await bash($, 'wc -l .workkit/capture.md')
    expect(refused(w)).toBe(true)
    expect(w.toolRan).toBeUndefined()
  })

  test('a marker 31 minutes old is no triage run: refused', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, 31 * 60)
    await bash($, 'cat .workkit/capture.md')
    expect(refused(w)).toBe(true)
  })

  test('a fresh marker: a command containing the path runs, a write included', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, 0)
    await bash($, 'cat .workkit/capture.md')
    expect(denyOf(w)).toBeNull()
    expect(w.toolRan?.command).toBe('cat .workkit/capture.md')
    await bash($, 'printf "# capture\\n" > .workkit/capture.md')
    expect(denyOf(w, 1)).toBeNull()
  })

  test('workkit note and a command naming another .workkit file run with no marker: no path, no refusal', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on)
    await bash($, 'workkit note "a thought"')
    expect(denyOf(w)).toBeNull()
    expect(w.toolRan?.command).toBe('workkit note "a thought"')
    await bash($, 'cat .workkit/agents/session.md')
    expect(denyOf(w, 1)).toBeNull()
  })
})
