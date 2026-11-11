// tool.call then classic.PostToolUse (Bash) through the hooks module, POST_BASH_GUARDS, which never
// blocks: tool.call marks every journal of the gh journal folder (a path line and a length line each, in
// name order), and the Post hook, or PostToolUseFailure for a call that failed, reads the lines each
// journal gained past its mark, oldest first, never the command text. workflow:snapshot's take, add
// and drop through the snapshot.sh entry, and workflow:public-mirror's public/mirror.js after a status
// edit in a paired repo, each through $.process.run. The plans' own cases:
// test/hooks/workflow-snapshot.test.js and public-mirror.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, REPO, HOME, SID, OPTED_IN, OPTED_OUT } from '../lib/mod-world.ts'
import { ghEntry, journalText } from '../lib/mod-fixtures.mjs'

const TMP = '/w/tmp'
// The snapshot folder of the session repo: the workflow home's markers, the folder, the SHA-1 of the root.
const SNAP = `${HOME}/.workkit/markers/claude-red-snapshot/2d98e56dc36b7431b8f668bf4d7715c564698d73`
const LIVE = { [`${SNAP}/tree/src/x.js`]: 'module.exports = 1;\n', [`${SNAP}/head`]: `${'c'.repeat(40)}\n`, [`${SNAP}/issues`]: '5\n' }
// The session repo's gh journal, keyed the same way, and the mark of tool use toolu_1.
const JOURNAL = `${HOME}/.workkit/markers/claude-gh-journal/2d98e56dc36b7431b8f668bf4d7715c564698d73`
const OTHER = '/w/other'
// The second repo's gh journal, keyed by the SHA-1 of its root.
const OTHER_JOURNAL = `${HOME}/.workkit/markers/claude-gh-journal/733f07a1e1c6941aaa32abd5c1fa4661beb0e6cd`
const MARK = `${HOME}/.workkit/markers/claude-gh-journal-mark/040bc3d6655defe8b366356995d3883a209b0561`
const issue = (number: number, ...labels: string[]) => ({ number, labels: labels.map((name) => ({ name })) })

// The journal line each gh write leaves.
const CLAIM = (n: number) => ghEntry({ numbers: [n], add: ['status:building'] })
// A Bash call whose gh writes no command parser sees: a script runs them.
const SCRIPTED = 'bash scripts/flip.sh'

const call = ($: any, command: string) => $.tool.call({ tool: 'Bash', command, description: 'x', tool_use_id: 'toolu_1' })
const journaledAt = (w: any, path: string, ...entries: any[]) => w.files.set(path, `${w.files.get(path) ?? ''}${journalText(...entries)}`)
const journaled = (w: any, ...entries: any[]) => journaledAt(w, JOURNAL, ...entries)
const after = ($: any, command: string, extra: any = {}) => $.classic.PostToolUse({
  tool_name: 'Bash', tool_input: { command }, tool_response: {}, tool_use_id: 'toolu_1', session_id: SID, cwd: REPO, ...extra,
})

/**
 * One Bash call as a session makes it: tool.call with `command`, the call's gh writes appending
 * `entries` to the journal, then classic.PostToolUse for the same tool use.
 */
const ran = async ($: any, w: any, command: string, ...entries: any[]) => {
  await call($, command)
  journaled(w, ...entries)
  return after($, command)
}
// Every `tail` the module ran, as the file it read.
const tailed = (w: any) => w.calls.filter((c: any) => c.argv[0].split('/').pop() === 'tail').map((c: any) => c.argv[c.argv.length - 1])
const world = (on: any, opts: any = {}) => mkWorld(on, { env: { TMPDIR: TMP }, ...opts })

// Each snapshot.sh run as [mode, root, ...args], with its init.
const snapshotRuns = (w: any) => w.runs('snapshot.sh').map((c: any) => {
  const at = c.argv.findIndex((a: string) => a.endsWith('snapshot.sh'))
  return { args: c.argv.slice(at + 1), init: c.init }
})
const modes = (w: any) => snapshotRuns(w).map((r: any) => r.args[0])
// The `--label` of each `gh issue list` the module ran, in order.
const listed = (w: any) => w.ghCalls().filter((c: any) => c.argv[2] === 'list').map((c: any) => c.argv[c.argv.indexOf('--label') + 1])

describe('classic.PostToolUse Bash: workflow:snapshot, the Contract cases', () => {
  test('given a claim of #5 journaled by the call, then bash snapshot.sh take <root> 5 ran and nothing was denied: the loader routes workflow:snapshot, its 600s timeout', async ($, on) => {
    const w = world(on, { gh: { issues: [issue(5, 'status:building')] } })
    const r = await ran($, w, SCRIPTED, CLAIM(5))
    expect(r?.block).toBeUndefined()
    const runs = snapshotRuns(w)
    expect(runs.map((x: any) => x.args[0])).toEqual(['take'])
    expect(runs[0].args[1]).toBe(REPO)
    expect(runs[0].args.slice(2)).toContain('5')
    expect(runs[0].init.timeoutMs).toBe(600000)
    expect(hooksLog(w).filter((l: any) => l.hook === 'workflow:snapshot').map((l: any) => l.verdict)).toEqual(['run'])
  })

  test('case 1: a claim journaled before this call\'s mark is not read again: the mark holds the journal and its length, the take records #5 alone', async ($, on) => {
    const before = journalText(CLAIM(4))
    const w = world(on, { gh: { issues: [issue(4, 'status:building'), issue(5, 'status:building')] }, files: { [JOURNAL]: before } })
    await call($, SCRIPTED)
    expect(w.files.get(MARK)).toBe(`${JOURNAL}\n${before.length}`)
    journaled(w, CLAIM(5))
    await after($, SCRIPTED)
    expect(w.files.has(MARK)).toBe(false)
    const runs = snapshotRuns(w)
    expect(runs.map((x: any) => x.args[0])).toEqual(['take'])
    expect(runs[0].args.slice(2)).toEqual(['5'])
  })

  test('case 1: a claim in the command whose gh write journaled nothing (the write failed), the journal folder empty: the mark is empty, no snapshot run', async ($, on) => {
    const w = world(on, { gh: { issues: [issue(5, 'status:building')] } })
    const command = 'gh issue edit 5 --add-label status:building'
    await call($, command)
    expect(w.files.get(MARK)).toBe('')
    const r = await after($, command)
    expect(r?.block).toBeUndefined()
    expect(snapshotRuns(w)).toEqual([])
  })

  test('a call that cd\'d into another repo: the Post reads the journal that grew, the session repo\'s, not the Post cwd\'s', async ($, on) => {
    const w = world(on, { repos: { [REPO]: OPTED_IN, [OTHER]: OPTED_IN }, gh: { issues: [issue(5, 'status:building')] } })
    await call($, `cd ${OTHER} && ${SCRIPTED}`)
    journaled(w, CLAIM(5))
    await after($, `cd ${OTHER} && ${SCRIPTED}`, { cwd: OTHER })
    expect(tailed(w)).toEqual([JOURNAL])
    expect(snapshotRuns(w).map((x: any) => x.args)).toEqual([['take', REPO, '5']])
  })

  test('classic.PostToolUseFailure: a Bash call that failed after its gh write landed still takes the write\'s claim, and its mark is removed', async ($, on) => {
    const w = world(on, { gh: { issues: [issue(5, 'status:building')] } })
    const command = `${SCRIPTED} && false`
    await call($, command)
    journaled(w, CLAIM(5))
    const r = await $.classic.PostToolUseFailure({
      tool_name: 'Bash', tool_input: { command }, tool_use_id: 'toolu_1', error: 'Exit code 1', session_id: SID, cwd: REPO,
    })
    expect(r?.block).toBeUndefined()
    const runs = snapshotRuns(w)
    expect(runs.map((x: any) => x.args[0])).toEqual(['take'])
    expect(runs[0].args.slice(2)).toEqual(['5'])
    expect(w.files.has(MARK)).toBe(false)
  })

  test('given a close journaled with no issue still building or at qa, then drop ran for the root', async ($, on) => {
    const w = world(on, { files: LIVE, gh: { issues: [] } })
    const r = await ran($, w, SCRIPTED, ghEntry({ sub: 'close', numbers: [5] }))
    expect(r?.block).toBeUndefined()
    const runs = snapshotRuns(w)
    expect(runs.map((x: any) => x.args[0])).toEqual(['drop'])
    expect(runs[0].args[1]).toBe(REPO)
  })

  test('given a close journaled with none building and #6 at qa, then gh lists building then qa and the snapshot stays', async ($, on) => {
    const w = world(on, { files: LIVE, gh: { issues: [issue(6, 'status:qa')] } })
    const r = await ran($, w, SCRIPTED, ghEntry({ sub: 'close', numbers: [5] }))
    expect(r?.block).toBeUndefined()
    // The fake answers every list alike, so the labels asked are what proves the qa read ran.
    expect(listed(w)).toEqual(['status:building', 'status:qa'])
    expect(modes(w)).toEqual([])
  })

  test('given a complete flip journaled while #6 is still building, then gh lists building alone and the snapshot stays', async ($, on) => {
    const w = world(on, { files: LIVE, gh: { issues: [issue(6, 'status:building')] } })
    const r = await ran($, w, SCRIPTED, ghEntry({ numbers: [5], add: ['status:complete'] }))
    expect(r?.block).toBeUndefined()
    expect(listed(w)).toEqual(['status:building'])
    expect(modes(w)).toEqual([])
  })

  test('given a close journaled with none building and the qa list failing, then gh lists building then qa and the snapshot stays', async ($, on) => {
    const w = world(on, { files: LIVE, gh: { issues: [], offlineAt: ['status:qa'] } })
    const r = await ran($, w, SCRIPTED, ghEntry({ sub: 'close', numbers: [5] }))
    expect(r?.block).toBeUndefined()
    expect(listed(w)).toEqual(['status:building', 'status:qa'])
    expect(modes(w)).toEqual([])
  })

  test('given a close journaled with the building list failing, then qa is never asked and the snapshot stays', async ($, on) => {
    const w = world(on, { files: LIVE, gh: { issues: [], offlineAt: ['status:building'] } })
    const r = await ran($, w, SCRIPTED, ghEntry({ sub: 'close', numbers: [5] }))
    expect(r?.block).toBeUndefined()
    expect(listed(w)).toEqual(['status:building'])
    expect(modes(w)).toEqual([])
  })
})

// Session folder in REPO (A); OTHER (B) a second opted-in repo; DECLINED (C) a repo whose settings do not opt in.
// Each journal is keyed by the SHA-1 of its repo's root, as the shim writes it.
const TWO = { repos: { [REPO]: OPTED_IN, [OTHER]: OPTED_IN } }
const DECLINED = '/w/declined'
const DECLINED_JOURNAL = `${HOME}/.workkit/markers/claude-gh-journal/7e6d42fc08b693d805752f4fd83db71b66490cd7`
const CLAIM_B = (n: number, over: any = {}) => ghEntry({ numbers: [n], add: ['status:building'], repo: 'acme/other', cwd: OTHER, ...over })
const INTO_B = `cd ${OTHER} && gh issue edit 7 --add-label status:building`
const takes = (w: any) => snapshotRuns(w).map((x: any) => x.args)

describe('classic.PostToolUse Bash: every journal of the gh journal folder', () => {
  test('case 1: cd <B> && gh issue edit 7, B\'s journal gaining the claim: the take runs for B with #7, from B\'s root', async ($, on) => {
    const w = world(on, { ...TWO, files: { [OTHER_JOURNAL]: '' } })
    await call($, INTO_B)
    journaledAt(w, OTHER_JOURNAL, CLAIM_B(7))
    const r = await after($, INTO_B)
    expect(r?.block).toBeUndefined()
    expect(takes(w)).toEqual([['take', OTHER, '7']])
    expect(snapshotRuns(w)[0].init.cwd).toBe(OTHER)
  })

  test('case 2: A\'s and B\'s journals each gaining a claim in one call, B\'s the older: both are read, B\'s first, and the mark is removed', async ($, on) => {
    const w = world(on, TWO)
    const command = `gh issue edit 5 --add-label status:building && ${INTO_B}`
    await call($, command)
    journaled(w, CLAIM(5))
    journaledAt(w, OTHER_JOURNAL, CLAIM_B(7, { ms: CLAIM(5).ms - 1000 }))
    await after($, command)
    expect(takes(w)).toEqual([['take', OTHER, '7'], ['take', REPO, '5']])
    expect(w.files.has(MARK)).toBe(false)
  })

  test('case 3: B\'s claim of #6 held before the call is not read, the take records #7 alone, and A\'s journal, which did not grow, is never tailed', async ($, on) => {
    const w = world(on, { ...TWO, files: { [JOURNAL]: journalText(CLAIM(4)), [OTHER_JOURNAL]: journalText(CLAIM_B(6)) } })
    await call($, INTO_B)
    journaledAt(w, OTHER_JOURNAL, CLAIM_B(7))
    await after($, INTO_B)
    expect(takes(w)).toEqual([['take', OTHER, '7']])
    expect(tailed(w)).toEqual([OTHER_JOURNAL])
  })

  test('case 4: bash scripts/flip.sh, no cd in the text, its write landing in B\'s journal: the take runs for B with #7', async ($, on) => {
    const w = world(on, TWO)
    await call($, SCRIPTED)
    journaledAt(w, OTHER_JOURNAL, CLAIM_B(7))
    await after($, SCRIPTED)
    expect(takes(w)).toEqual([['take', OTHER, '7']])
  })

  test('case 5: B\'s journal, absent before the call and the mark holding A\'s alone, holds one claim after it: the line is read from its start', async ($, on) => {
    const w = world(on, { ...TWO, files: { [JOURNAL]: journalText(CLAIM(4)) } })
    await call($, INTO_B)
    journaledAt(w, OTHER_JOURNAL, CLAIM_B(7))
    await after($, INTO_B)
    expect(takes(w)).toEqual([['take', OTHER, '7']])
  })

  test('case 6: C\'s journal gaining a claim of #3 from C\'s root, C a repo that has not opted in: the line is dropped and no snapshot run is made', async ($, on) => {
    const w = world(on, { repos: { [REPO]: OPTED_IN, [DECLINED]: OPTED_OUT } })
    const command = `cd ${DECLINED} && gh issue edit 3 --add-label status:building`
    await call($, command)
    journaledAt(w, DECLINED_JOURNAL, ghEntry({ numbers: [3], add: ['status:building'], repo: 'acme/declined', cwd: DECLINED }))
    await after($, command)
    expect(snapshotRuns(w)).toEqual([])
  })

  test('case 7: a folder of two journals: the mark names A\'s then B\'s, each with its length, and no git call runs before the mark is written', async ($, on) => {
    const w = world(on, { ...TWO, files: { [OTHER_JOURNAL]: journalText(CLAIM_B(6)), [JOURNAL]: journalText(CLAIM(4)) } })
    await call($, INTO_B)
    expect(w.files.get(MARK)).toBe(`${JOURNAL}\n62\n${OTHER_JOURNAL}\n64`)
    const written = w.fsOps.find((o: any) => o.op === 'write' && o.path === MARK)
    expect(w.calls.slice(0, written.runs).filter((c: any) => c.argv[0].split('/').pop() === 'git')).toEqual([])
  })

  test('case 8: the session folder in C, bash scripts/flip.sh landing a claim from B\'s root in B\'s journal: the take runs for B with #7', async ($, on) => {
    const w = world(on, { repos: { [OTHER]: OPTED_IN, [DECLINED]: OPTED_OUT }, cwd: DECLINED })
    await call($, SCRIPTED)
    journaledAt(w, OTHER_JOURNAL, CLAIM_B(7))
    await after($, SCRIPTED, { cwd: DECLINED })
    expect(takes(w)).toEqual([['take', OTHER, '7']])
  })
})

// The session repo paired with a public issue repo in its committed settings.
const PAIRED = { [REPO]: '{ "enabled": true, "public": "acme/public" }\n' }
const mirrorRuns = (w: any) => w.runs('public/mirror.js')

describe('classic.PostToolUse Bash: workflow:public-mirror', () => {
  test('given a paired repo and a journaled edit adding status:qa to #12, then node public/mirror.js 12 ran from the root and nothing was denied', async ($, on) => {
    const w = world(on, { repos: PAIRED })
    const r = await ran($, w, SCRIPTED, ghEntry({ numbers: [12], add: ['status:qa'] }))
    expect(r?.block).toBeUndefined()
    const runs = mirrorRuns(w)
    expect(runs.length).toBe(1)
    expect(runs[0].argv.slice(-1)).toEqual(['12'])
    expect(runs[0].init.cwd).toBe(REPO)
  })
})

describe('classic.PostToolUse Bash: workflow:snapshot, the claim and the release', () => {
  test('a second claim while the snapshot is live adds its number and leaves the tree alone: stale answers live, add runs', async ($, on) => {
    const w = world(on, { files: LIVE, snapshot: { stale: { exitCode: 1 } } })
    await ran($, w, SCRIPTED, CLAIM(6))
    expect(modes(w)).not.toContain('take')
    const add = snapshotRuns(w).find((x: any) => x.args[0] === 'add')
    expect(add?.args.slice(1)).toEqual([REPO, '6'])
  })

  test('a claim after every recorded issue left building replaces the snapshot: stale answers stale, take runs', async ($, on) => {
    const w = world(on, { files: LIVE, snapshot: { stale: { exitCode: 0 } } })
    await ran($, w, SCRIPTED, CLAIM(6))
    expect(modes(w)).toContain('take')
    expect(modes(w)).not.toContain('add')
  })

  test('a failed GitHub read at a claim keeps the live snapshot and adds the number', async ($, on) => {
    const w = world(on, { files: LIVE, snapshot: { stale: { exitCode: 2 } } })
    await ran($, w, SCRIPTED, CLAIM(6))
    expect(modes(w)).not.toContain('take')
    expect(modes(w)).toContain('add')
  })

  test('a re-claim of a recorded issue after a block keeps the first tree, the number once', async ($, on) => {
    const w = world(on, { files: LIVE, snapshot: { stale: { exitCode: 0 } } })
    await ran($, w, SCRIPTED, CLAIM(5))
    expect(modes(w)).not.toContain('take')
  })
})
