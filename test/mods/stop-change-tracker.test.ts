// classic.Stop through the hooks module: docs:change-tracker after manager:close-guard, its `{ block }` carrying
// the nag on uncommitted code or unfiled entries at a turn that parked, blocked or closed an issue (a gh journal line
// past the offset the turn's UserPromptSubmit stored as `turn-journal`, read with `tail`), the fingerprint's SHA-1 kept in
// .workkit/agents/.change-tracker where .workkit/ is gitignored, and silence on a state already nagged about.
// The verdict's own cases are test/hooks/change-tracker.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, row, REPO, PLAIN, HOME, SID, SESSION_NOW } from '../lib/mod-world.ts'
import { ghEntry, journalText } from '../lib/mod-fixtures.mjs'

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

const TURN = SESSION_NOW - 120e3
const COMMAND = 'gh issue edit 12 --add-label status:qa'

// The session repo's gh journal, and a park in it.
const JOURNAL = `${HOME}/.workkit/markers/claude-gh-journal/2d98e56dc36b7431b8f668bf4d7715c564698d73`
const PARKED = journalText(ghEntry({ ms: TURN + 1500, numbers: [12], add: ['status:qa'] }))

const stop = ($: any, extra: any = {}) => $.classic.Stop({
  hook_event_name: 'Stop', session_id: SID, cwd: REPO, stop_hook_active: false, ...extra,
})
// The turn's owner prompt, which stores the journal's length as the turn's offset.
const prompt = ($: any, extra: any = {}) => $.classic.UserPromptSubmit({
  hook_event_name: 'UserPromptSubmit', prompt: 'do the thing', session_id: SID, cwd: REPO, ...extra,
})
// A turn that parked: the prompt, then the park appended to the journal past its offset.
const parkedTurn = async ($: any, w: any, extra: any = {}) => {
  await prompt($, extra)
  w.files.set(JOURNAL, `${w.files.get(JOURNAL) ?? ''}${PARKED}`)
}

// A turn: the owner's prompt, then one Bash tool use and its answer.
const turn = (command: string) => [row.user(), row.tool('Bash', { command }), row.result()]
const PARK = turn(COMMAND)

// An opted-in repo whose .workkit/ is gitignored, the prompt in the kit, app.js edited, and a turn that parked.
const world = (on: any, opts: any = {}) => mkWorld(on, {
  now: SESSION_NOW,
  messages: PARK,
  status: { [REPO]: ' M app.js\n' },
  diff: { [REPO]: DIFF('two') },
  ignored: [`${REPO}/.workkit/`],
  ...opts,
  kit: { 'hooks/mods/change-tracker/prompt.md': PROMPT, ...(opts.kit || {}) },
  files: { [`${REPO}/app.js`]: 'two\n', ...(opts.files || {}) },
})
const blockOf = (r: any) => (typeof r?.block === 'string' ? r.block : null)

describe('classic.Stop: docs:change-tracker, the Contract cases', () => {
  test('given uncommitted code, a journal line adding status:qa to #12 this turn and no previous fingerprint: { block } with the nag, the state file holds the sha1', async ($, on) => {
    const w = world(on)
    await parkedTurn($, w)
    const r = await stop($)
    const block = blockOf(r)
    expect(block).toContain(CODE)
    expect(block).toContain(PROMPT)
    expect(w.files.get(STATE)).toBe(`${SHA1}\n`)
    expect(hooksLog(w).filter((l: any) => l.hook === 'docs:change-tracker').map((l: any) => l.verdict)).toEqual(['run'])
  })

  test('the same tree again: no block, the state file stands', async ($, on) => {
    const w = world(on)
    await parkedTurn($, w)
    expect(blockOf(await stop($))).toContain(CODE)
    const kept = w.files.get(STATE)
    expect(blockOf(await stop($))).toBeNull()
    expect(w.files.get(STATE)).toBe(kept)
  })

  test('stop_hook_active=true: exits 0 (prevents recursion): no block, nothing written', async ($, on) => {
    const w = world(on)
    await parkedTurn($, w)
    expect(blockOf(await stop($, { stop_hook_active: true }))).toBeNull()
    expect(w.files.has(STATE)).toBe(false)
  })
})

describe('classic.Stop: docs:change-tracker, the endpoint gate', () => {
  test('a dirty tree and a turn with no park, block or close: no block, nothing written, the later park still nags', async ($, on) => {
    const claim = journalText(ghEntry({ ms: TURN + 1500, numbers: [12], add: ['status:building'] }))
    const w = world(on)
    await prompt($)
    w.files.set(JOURNAL, claim)
    expect(blockOf(await stop($))).toBeNull()
    expect(w.files.has(STATE)).toBe(false)
    w.files.set(JOURNAL, `${claim}${PARKED}`)
    expect(blockOf(await stop($))).toContain(CODE)
  })

  // Their stamps are later than the prompt, so the stored byte offset alone keeps them out of the turn.
  test('case 3: a park, block and close journaled before the turn\'s stored offset end no work: no block, nothing written', async ($, on) => {
    const older = (over: any) => ghEntry({ ms: SESSION_NOW + 60e3, numbers: [12], ...over })
    const w = world(on, { files: { [JOURNAL]: journalText(older({ add: ['status:qa'] }), older({ add: ['status:blocked'] }), older({ sub: 'close' })) } })
    await prompt($)
    expect(blockOf(await stop($))).toBeNull()
    expect(w.files.has(STATE)).toBe(false)
  })

  // A task notification is Claude Code's own frame (hooks/mods/frame.js), never the owner starting a turn.
  test('a harness frame delivered after the park moves no offset: the Stop still nags', async ($, on) => {
    const w = world(on)
    await parkedTurn($, w)
    await prompt($, { prompt: '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>' })
    expect(blockOf(await stop($))).toContain(CODE)
  })

  test('a session whose prompt stored no turn offset: the journaled park reads as no lines, no block, nothing written', async ($, on) => {
    const w = world(on, { files: { [JOURNAL]: PARKED } })
    expect(blockOf(await stop($))).toBeNull()
    expect(w.files.has(STATE)).toBe(false)
  })

  // The engine's $.fs.read refuses a file past 4 MiB; the test world's does not, so the reader is asserted.
  test('a journal past 4 MiB: the park past the offset still nags, read by tail from the stored offset, never by fs.read', async ($, on) => {
    const claim = journalText(ghEntry({ numbers: [11], add: ['status:building'] }))
    const big = claim.repeat(Math.ceil((5 * 1024 * 1024) / claim.length))
    const w = world(on, { files: { [JOURNAL]: big } })
    await parkedTurn($, w)
    expect(blockOf(await stop($))).toContain(CODE)
    const tails = w.runs(JOURNAL).filter((c: any) => c.argv[0].split('/').pop() === 'tail')
    expect(tails.map((c: any) => c.argv.slice(1))).toEqual([['-c', `+${big.length + 1}`, JOURNAL]])
    expect(w.fsOps.filter((o: any) => o.op === 'read' && o.path === JOURNAL)).toEqual([])
  })
})

describe('classic.Stop: docs:change-tracker, the gathering', () => {
  test('a new edit behind an identical status line: blocks again: the diff is read', async ($, on) => {
    const w = world(on)
    await parkedTurn($, w)
    await stop($)
    const first = w.files.get(STATE)
    w.diffs[REPO] = DIFF('six')
    expect(blockOf(await stop($))).toContain(CODE)
    expect(w.files.get(STATE)).not.toBe(first)
  })

  test('an untracked file rewritten in place: blocks again: its content is read', async ($, on) => {
    const w = world(on, { status: { [REPO]: '?? lib.js\n' }, diff: {}, files: { [`${REPO}/lib.js`]: 'one\n' } })
    await parkedTurn($, w)
    expect(blockOf(await stop($))).toContain(CODE)
    w.files.set(`${REPO}/lib.js`, 'two\n')
    expect(blockOf(await stop($))).toContain(CODE)
  })

  test('a new capture entry: blocks again: the capture file read, its new entry re-arms the nudge', async ($, on) => {
    const capture = `${REPO}/.workkit/capture.md`
    const w = world(on, { status: {}, diff: {}, files: { [capture]: '# capture\n> header\n\na finding\n' } })
    await parkedTurn($, w)
    expect(blockOf(await stop($))).toContain(SCRATCH(1))
    expect(blockOf(await stop($))).toBeNull()
    w.files.set(capture, '# capture\n> header\n\na finding\nanother finding\n')
    expect(blockOf(await stop($))).toContain(SCRATCH(2))
  })

  test('the memory is the repo\'s, not the session\'s', async ($, on) => {
    const w = world(on)
    await prompt($, { session_id: 'sess-b' })
    await parkedTurn($, w, { session_id: 'sess-a' })
    expect(blockOf(await stop($, { session_id: 'sess-a' }))).toContain(CODE)
    expect(blockOf(await stop($, { session_id: 'sess-b' }))).toBeNull()
  })

  test('.workkit/ present but not gitignored: nudges every stop, writes nothing', async ($, on) => {
    const w = world(on, { ignored: [] })
    await parkedTurn($, w)
    for (let i = 0; i < 3; i++) expect(blockOf(await stop($))).toContain(CODE)
    expect(w.files.has(STATE)).toBe(false)
  })

  // `.workkit/` is ignored at every depth, so only its absence keeps the write out.
  test('no .workkit/: nudges every stop and writes nothing: a session in a subfolder with none of its own', async ($, on) => {
    const sub = `${REPO}/packages/api`
    const w = world(on, { cwd: sub, ignored: [`${REPO}/.workkit/`, `${sub}/.workkit/`], files: { [`${sub}/index.js`]: 'x\n' } })
    await parkedTurn($, w, { cwd: sub })
    for (let i = 0; i < 2; i++) expect(blockOf(await stop($, { cwd: sub }))).toContain(CODE)
    expect([...w.files.keys()].filter((p: string) => p.startsWith(`${sub}/.workkit`))).toEqual([])
  })

  test('non-git directory: exits 0 silently (fail open)', async ($, on) => {
    const w = world(on, { cwd: PLAIN })
    await parkedTurn($, w, { cwd: PLAIN })
    expect(blockOf(await stop($, { cwd: PLAIN }))).toBeNull()
  })

  test('a repo that has not opted in: no block, and the fire logs stood-down', async ($, on) => {
    const w = world(on, { repos: { [REPO]: null } })
    await parkedTurn($, w)
    expect(blockOf(await stop($))).toBeNull()
    expect(hooksLog(w).filter((l: any) => l.hook === 'docs:change-tracker').map((l: any) => l.verdict)).toEqual(['stood-down'])
  })

  test('no findings.file key anywhere: the off line, nothing filed', async ($, on) => {
    const w = world(on)
    await parkedTurn($, w)
    const block = blockOf(await stop($))
    expect(block).toContain(FINDINGS_OFF)
    expect(block).not.toContain('Filed')
  })

  test('findings.file true in the global file: the status:inbox line with the Filed trail', async ($, on) => {
    const w = world(on, { files: { '/w/home/.workkit/settings.json': JSON.stringify({ findings: { file: true } }) } })
    await parkedTurn($, w)
    expect(blockOf(await stop($))).toContain(FINDINGS_ON)
  })

  test('the board reminder rides along only while PROGRESS.md is present', async ($, on) => {
    const w = world(on)
    await parkedTurn($, w)
    expect(blockOf(await stop($))).not.toContain('BOARD:')
    w.files.set(`${REPO}/PROGRESS.md`, '# PROGRESS\n')
    w.diffs[REPO] = DIFF('six')
    expect(blockOf(await stop($))).toContain(BOARD)
  })

  test('a clean tree: unfiled INBOX entries counted, a header-only INBOX silent', async ($, on) => {
    const w = world(on, { status: {}, diff: {}, files: { [`${REPO}/INBOX.md`]: '# INBOX\n> header line\n\nan idea\nanother note\n' } })
    await parkedTurn($, w)
    const block = blockOf(await stop($))
    expect(block).toContain(ENTRIES)
    expect(block).toContain(INBOX(2))
    w.files.set(`${REPO}/INBOX.md`, '# INBOX\n> Dump anything here.\n\n')
    expect(blockOf(await stop($))).toBeNull()
  })

  test('a clean tree: scratch entries counted, a header-only capture file silent', async ($, on) => {
    const capture = `${REPO}/.workkit/capture.md`
    const w = world(on, { status: {}, diff: {}, files: { [capture]: '# capture\n> header\n\na finding\nan idea\n' } })
    await parkedTurn($, w)
    const block = blockOf(await stop($))
    expect(block).toContain(ENTRIES)
    expect(block).toContain(SCRATCH(2))
    w.files.set(capture, '# capture\n> dump anything here\n\n')
    expect(blockOf(await stop($))).toBeNull()
  })

  test('the hook never calls gh', async ($, on) => {
    const w = world(on)
    await parkedTurn($, w)
    expect(blockOf(await stop($))).toContain(CODE)
    expect(w.ghCalls()).toHaveLength(0)
  })

  test('a missing prompt file fails loudly, never a built-in string: no block, the missing path said', async ($, on) => {
    const w = world(on, { kit: { 'hooks/mods/change-tracker/prompt.md': null } })
    await parkedTurn($, w)
    expect(blockOf(await stop($))).toBeNull()
    expect(w.logs.some((l: string) => l.includes('prompt missing at'))).toBe(true)
  })
})
