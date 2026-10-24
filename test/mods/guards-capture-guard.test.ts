// tool.call Bash through the hooks module: safety:capture-guard in the Bash
// chain, the triage marker read off the world's files by its age, keyed to the
// capture file's repo or, for a file in no repo, the .workkit folder's parent,
// and the finding route read from findings.file.
// The verdict's own cases are test/hooks/capture-guard/*.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, TOOL_SPY, REPO, HOME, bash, denyOf } from '../lib/mod-world.ts'

const NOW = 1800000000000
const TMPDIR = '/w/tmp'
const REPO_MARKER = `${TMPDIR}/claude-triage-marker/2d98e56dc36b7431b8f668bf4d7715c564698d73`
const HOME_MARKER = `${TMPDIR}/claude-triage-marker/0a51b0fa3ab03e73525a857074f825928990c353`

const READ = "capture-guard: BLOCKED reading .workkit/capture.md: it is the owner's capture surface, and its contents are read only during a triage run.\nRun the workkit:triage skill, which records the marker this guard checks, and read it there. Counting the entries (wc -l) stays open."
const WRITE = (route: string) => `capture-guard: BLOCKED writing .workkit/capture.md: it is the owner's capture surface, and the agent never adds to it.\nIts entries are cleared only by the triage drain: run the workkit:triage skill, which records the marker this guard checks. ${route}`
const ROUTE_OFF = 'Say findings in chat under 🧭 Findings instead, one bullet each, for the owner to answer file or drop; file nothing on your own.'
const ROUTE_ON = 'File a finding as a status:inbox issue with gh instead; where GitHub cannot be reached, put it in chat and let the owner decide.'

const verdicts = (w: any) => hooksLog(w).filter((l: any) => l.hook === 'safety:capture-guard').map((l: any) => l.verdict)

// A world with the clock fixed, both capture files, and each marker given its age in seconds.
const world = (on: any, opts: any = {}, markers: Record<string, number> = {}) => {
  const files: Record<string, string> = {
    [`${REPO}/.workkit/capture.md`]: '# capture\n\n- a private thought\n',
    [`${HOME}/.workkit/capture.md`]: '# capture\n\n- a private thought\n',
  }
  for (const marker of Object.keys(markers)) files[marker] = ''
  const w = mkWorld(on, { now: NOW, ...opts, env: { TMPDIR, ...(opts.env || {}) }, files })
  for (const [marker, age] of Object.entries(markers)) w.mtimes.set(marker, NOW - age * 1000)
  return w
}

describe('tool.call Bash: safety:capture-guard', () => {
  test('ports "a content-reading command: exit 2": the deny, its run line logged, the command not run', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on)
    await bash($, 'cat .workkit/capture.md')
    expect(denyOf(w)).toBe(READ)
    expect(w.toolRan).toBeUndefined()
    expect(verdicts(w)).toEqual(['run'])
  })

  test('ports "a fresh marker opens the Bash path too: exit 0": the repo-keyed marker', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, {}, { [REPO_MARKER]: 0 })
    await bash($, 'cat .workkit/capture.md')
    expect(denyOf(w)).toBeNull()
    expect(w.toolRan?.command).toBe('cat .workkit/capture.md')
  })

  test('ports "a marker 31 minutes old: exit 2" on the Bash path', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, {}, { [REPO_MARKER]: 31 * 60 })
    await bash($, 'cat .workkit/capture.md')
    expect(denyOf(w)).toBe(READ)
  })

  test('ports "the ~/ spelling resolves to the same anchor": blocked with no marker, opened by the $HOME-keyed one', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on)
    await bash($, 'cat ~/.workkit/capture.md')
    expect(denyOf(w)).toBe(READ)
    w.files.set(HOME_MARKER, '')
    w.mtimes.set(HOME_MARKER, NOW)
    await bash($, 'cat ~/.workkit/capture.md')
    expect(denyOf(w, 1)).toBeNull()
  })

  test('ports "the braced HOME spelling resolves like the bare one" and "a cwd outside any git repo still keys off the .workkit parent"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, {}, { [HOME_MARKER]: 0 })
    await bash($, 'cat "$HOME/.workkit/capture.md"')
    await bash($, 'cat "${HOME}/.workkit/capture.md"')
    expect(denyOf(w, 0)).toBeNull()
    expect(denyOf(w, 1)).toBeNull()
  })

  test('ports "an append into the capture file: exit 2 with and without a marker": a marker does not open it', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, {}, { [REPO_MARKER]: 0 })
    await bash($, 'echo "- a thought" >> .workkit/capture.md')
    expect(denyOf(w)).toBe(WRITE(ROUTE_OFF))
    await bash($, 'workkit note "a thought"')
    expect(denyOf(w, 1)).toBe(WRITE(ROUTE_OFF))
  })

  test('ports "findings.file on: the refusal names the status:inbox route": read from the repo settings', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, { repos: { [REPO]: JSON.stringify({ version: 1, enabled: true, findings: { file: true } }) } })
    await bash($, 'echo "- a thought" >> .workkit/capture.md')
    expect(denyOf(w)).toBe(WRITE(ROUTE_ON))
  })
})
