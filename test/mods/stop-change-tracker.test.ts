// classic.Stop through the hooks module: docs:change-tracker after
// manager:close-guard, its `{ block }` carrying the nag on uncommitted code or
// unfiled entries, the fingerprint's SHA-1 kept in .workkit/agents/.change-tracker
// where .workkit/ is gitignored, and silence on a state already nagged about.
// The verdict's own cases are test/hooks/change-tracker.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, REPO, PLAIN, SID } from '../lib/mod-world.ts'

const PROMPT = 'The working tree has uncommitted code/config changes. (fixture prompt.md)'
const STATE = `${REPO}/.workkit/agents/.change-tracker`
// The SHA-1 of the fingerprint text: the status line, then the diff.
const SHA1 = '468c05de032a1c9f6bac49ad51f161109d50e722'
const CODE = 'Change tracker: uncommitted code changes detected.'
const ENTRIES = 'Change tracker: unfiled entries detected.'
const FINDINGS_OFF = 'FINDINGS: findings.file is off. Build a finding that belongs to the issue in hand into it; say every other finding in chat under **🧭 Findings**, one bullet each in the cold-reader line, for the owner to answer file or drop. File nothing on your own.'
const FINDINGS_ON = 'FINDINGS: findings.file is on. File each finding outside the issue in hand as a `status:inbox` issue and print the `Filed:` trail for what you filed. If GitHub cannot be reached, put the finding in chat and stop there. The owner decides.'
const BOARD = "BOARD: PROGRESS.md still exists in this repo. Migrate it to issues (recipe: the workkit plugin's docs/project-state.md § Migration), then delete the file. Until that happens, keep it true this turn."
const INBOX = (n: number) => `INBOX: ${n} unfiled entries in ${REPO}/INBOX.md. Surface the count to the user and offer the workkit:triage skill. Filing stays deliberate: never empty the inbox as a side effect.`
const SCRATCH = (n: number) => `SCRATCH: ${n} unfiled entries in ${REPO}/.workkit/capture.md. Surface the count and offer the workkit:triage skill. Filing stays deliberate: never drain the local capture file as a side effect.`
const DIFF = (to: string) => `diff --git a/app.js b/app.js\n--- a/app.js\n+++ b/app.js\n@@ -1 +1 @@\n-one\n+${to}\n`

const stop = ($: any, extra: any = {}) => $.classic.Stop({
  hook_event_name: 'Stop', session_id: SID, cwd: REPO, stop_hook_active: false, ...extra,
})

// An opted-in repo whose .workkit/ is gitignored, the prompt in the kit, and app.js edited.
const world = (on: any, opts: any = {}) => mkWorld(on, {
  status: { [REPO]: ' M app.js\n' },
  diff: { [REPO]: DIFF('two') },
  ignored: [`${REPO}/.workkit/`],
  ...opts,
  kit: { 'hooks/mods/change-tracker/prompt.md': PROMPT, ...(opts.kit || {}) },
  files: { [`${REPO}/app.js`]: 'two\n', ...(opts.files || {}) },
})
const blockOf = (r: any) => (typeof r?.block === 'string' ? r.block : null)

describe('classic.Stop: docs:change-tracker, the Contract cases', () => {
  test('given uncommitted code and no previous fingerprint: { block } with the nag, the state file holds the sha1', async ($, on) => {
    const w = world(on)
    const r = await stop($)
    const block = blockOf(r)
    expect(block).toContain(CODE)
    expect(block).toContain(PROMPT)
    expect(w.files.get(STATE)).toBe(`${SHA1}\n`)
    expect(hooksLog(w).filter((l: any) => l.hook === 'docs:change-tracker').map((l: any) => l.verdict)).toEqual(['run'])
  })

  test('the same tree again: no block, the state file stands (ports "unchanged tree on the next stop: silent")', async ($, on) => {
    const w = world(on)
    expect(blockOf(await stop($))).toContain(CODE)
    const kept = w.files.get(STATE)
    expect(blockOf(await stop($))).toBeNull()
    expect(w.files.get(STATE)).toBe(kept)
  })

  test('ports "stop_hook_active=true: exits 0 (prevents recursion)": no block, nothing written', async ($, on) => {
    const w = world(on)
    expect(blockOf(await stop($, { stop_hook_active: true }))).toBeNull()
    expect(w.files.has(STATE)).toBe(false)
  })
})

describe('classic.Stop: docs:change-tracker, the gathering', () => {
  test('ports "a new edit behind an identical status line: blocks again": the diff is read', async ($, on) => {
    const w = world(on)
    await stop($)
    const first = w.files.get(STATE)
    w.diffs[REPO] = DIFF('six')
    expect(blockOf(await stop($))).toContain(CODE)
    expect(w.files.get(STATE)).not.toBe(first)
  })

  test('ports "an untracked file rewritten in place: blocks again": its content is read', async ($, on) => {
    const w = world(on, { status: { [REPO]: '?? lib.js\n' }, diff: {}, files: { [`${REPO}/lib.js`]: 'one\n' } })
    expect(blockOf(await stop($))).toContain(CODE)
    w.files.set(`${REPO}/lib.js`, 'two\n')
    expect(blockOf(await stop($))).toContain(CODE)
  })

  test('ports "a new capture entry: blocks again": the capture file read, its new entry re-arms the nudge', async ($, on) => {
    const capture = `${REPO}/.workkit/capture.md`
    const w = world(on, { status: {}, diff: {}, files: { [capture]: '# capture\n> header\n\na finding\n' } })
    expect(blockOf(await stop($))).toContain(SCRATCH(1))
    expect(blockOf(await stop($))).toBeNull()
    w.files.set(capture, '# capture\n> header\n\na finding\nanother finding\n')
    expect(blockOf(await stop($))).toContain(SCRATCH(2))
  })

  test('ports "the memory is the repo\'s, not the session\'s"', async ($, on) => {
    world(on)
    expect(blockOf(await stop($, { session_id: 'sess-a' }))).toContain(CODE)
    expect(blockOf(await stop($, { session_id: 'sess-b' }))).toBeNull()
  })

  test('ports ".workkit/ present but not gitignored: nudges every stop, writes nothing"', async ($, on) => {
    const w = world(on, { ignored: [] })
    for (let i = 0; i < 3; i++) expect(blockOf(await stop($))).toContain(CODE)
    expect(w.files.has(STATE)).toBe(false)
  })

  // `.workkit/` is ignored at every depth, so only its absence keeps the write out.
  test('ports "no .workkit/: nudges every stop and writes nothing": a session in a subfolder with none of its own', async ($, on) => {
    const sub = `${REPO}/packages/api`
    const w = world(on, { cwd: sub, ignored: [`${REPO}/.workkit/`, `${sub}/.workkit/`], files: { [`${sub}/index.js`]: 'x\n' } })
    for (let i = 0; i < 2; i++) expect(blockOf(await stop($, { cwd: sub }))).toContain(CODE)
    expect([...w.files.keys()].filter((p: string) => p.startsWith(`${sub}/.workkit`))).toEqual([])
  })

  test('ports "non-git directory: exits 0 silently (fail open)"', async ($, on) => {
    world(on, { cwd: PLAIN })
    expect(blockOf(await stop($, { cwd: PLAIN }))).toBeNull()
  })

  test('a repo that has not opted in: no block, and the fire logs stood-down', async ($, on) => {
    const w = world(on, { repos: { [REPO]: null } })
    expect(blockOf(await stop($))).toBeNull()
    expect(hooksLog(w).filter((l: any) => l.hook === 'docs:change-tracker').map((l: any) => l.verdict)).toEqual(['stood-down'])
  })

  test('ports "no findings.file key anywhere": the off line, nothing filed', async ($, on) => {
    world(on)
    const block = blockOf(await stop($))
    expect(block).toContain(FINDINGS_OFF)
    expect(block).not.toContain('Filed')
  })

  test('ports "findings.file true in the global file": the status:inbox line with the Filed trail', async ($, on) => {
    world(on, { files: { '/w/home/.workkit/settings.json': JSON.stringify({ findings: { file: true } }) } })
    expect(blockOf(await stop($))).toContain(FINDINGS_ON)
  })

  test('ports "PROGRESS.md present: the board reminder rides along" and "no PROGRESS.md: no board reminder"', async ($, on) => {
    const w = world(on)
    expect(blockOf(await stop($))).not.toContain('BOARD:')
    w.files.set(`${REPO}/PROGRESS.md`, '# PROGRESS\n')
    w.diffs[REPO] = DIFF('six')
    expect(blockOf(await stop($))).toContain(BOARD)
  })

  test('ports "clean tree + unfiled INBOX entries" and "clean tree + header-only INBOX": the entries counted', async ($, on) => {
    const w = world(on, { status: {}, diff: {}, files: { [`${REPO}/INBOX.md`]: '# INBOX\n> header line\n\nan idea\nanother note\n' } })
    const block = blockOf(await stop($))
    expect(block).toContain(ENTRIES)
    expect(block).toContain(INBOX(2))
    w.files.set(`${REPO}/INBOX.md`, '# INBOX\n> Dump anything here.\n\n')
    expect(blockOf(await stop($))).toBeNull()
  })

  test('ports "clean tree + scratch entries" and "clean tree + header-only capture file": the entries counted', async ($, on) => {
    const capture = `${REPO}/.workkit/capture.md`
    const w = world(on, { status: {}, diff: {}, files: { [capture]: '# capture\n> header\n\na finding\nan idea\n' } })
    const block = blockOf(await stop($))
    expect(block).toContain(ENTRIES)
    expect(block).toContain(SCRATCH(2))
    w.files.set(capture, '# capture\n> dump anything here\n\n')
    expect(blockOf(await stop($))).toBeNull()
  })

  test('ports "the hook never calls gh"', async ($, on) => {
    const w = world(on)
    expect(blockOf(await stop($))).toContain(CODE)
    expect(w.ghCalls()).toHaveLength(0)
  })

  test('ports "a missing prompt file fails loudly, never a built-in string": no block, the missing path said', async ($, on) => {
    const w = world(on, { kit: { 'hooks/mods/change-tracker/prompt.md': null } })
    expect(blockOf(await stop($))).toBeNull()
    expect(w.logs.some((l: string) => l.includes('prompt missing at'))).toBe(true)
  })
})
