// classic.PostToolUse and PostToolUseFailure (Bash) through the hooks module, POST_BASH_GUARDS, which
// never blocks: workflow:snapshot's take, add and drop through the snapshot.sh entry, and
// workflow:public-mirror's public/mirror.js after a status edit in a paired repo, each through
// $.process.run. The plans' own cases: test/hooks/workflow-snapshot.test.js and public-mirror.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, REPO, HOME, SID } from '../lib/mod-world.ts'

const TMP = '/w/tmp'
// The snapshot folder of the session repo: the workflow home's markers, the folder, the SHA-1 of the root.
const SNAP = `${HOME}/.workkit/markers/claude-red-snapshot/2d98e56dc36b7431b8f668bf4d7715c564698d73`
const LIVE = { [`${SNAP}/tree/src/x.js`]: 'module.exports = 1;\n', [`${SNAP}/head`]: `${'c'.repeat(40)}\n`, [`${SNAP}/issues`]: '5\n' }
const issue = (number: number, ...labels: string[]) => ({ number, labels: labels.map((name) => ({ name })) })

const CLAIM = (n: number) => `gh issue edit ${n} --add-label status:building`

const posted = ($: any, command: string) => $.classic.PostToolUse({
  tool_name: 'Bash', tool_input: { command }, tool_response: {}, tool_use_id: 'toolu_1', session_id: SID, cwd: REPO,
})
const failed = ($: any, command: string) => $.classic.PostToolUseFailure({
  tool_name: 'Bash', tool_input: { command }, tool_use_id: 'toolu_1', error: 'Exit code 1', session_id: SID, cwd: REPO,
})
const world = (on: any, opts: any = {}) => mkWorld(on, { env: { TMPDIR: TMP }, ...opts })

// Each snapshot.sh run as [mode, root, ...args], with its init.
const snapshotRuns = (w: any) => w.runs('snapshot.sh').map((c: any) => {
  const at = c.argv.findIndex((a: string) => a.endsWith('snapshot.sh'))
  return { args: c.argv.slice(at + 1), init: c.init }
})
const modes = (w: any) => snapshotRuns(w).map((r: any) => r.args[0])

describe('classic.PostToolUse Bash: workflow:snapshot, the Contract cases', () => {
  test('given a flip to status:building, then bash snapshot.sh take <root> ran and nothing was denied: ports "the loader routes workflow:snapshot", its 600s timeout', async ($, on) => {
    const w = world(on, { gh: { issues: [issue(5, 'status:building')] } })
    const r = await posted($, CLAIM(5))
    expect(r?.block).toBeUndefined()
    const runs = snapshotRuns(w)
    expect(runs.map((x: any) => x.args[0])).toEqual(['take'])
    expect(runs[0].args[1]).toBe(REPO)
    expect(runs[0].args.slice(2)).toContain('5')
    expect(runs[0].init.timeoutMs).toBe(600000)
    expect(hooksLog(w).filter((l: any) => l.hook === 'workflow:snapshot').map((l: any) => l.verdict)).toEqual(['run'])
  })

  test('given a close with no issue still building, then drop ran for the root', async ($, on) => {
    const w = world(on, { files: LIVE, gh: { issues: [] } })
    const r = await posted($, 'gh issue close 5')
    expect(r?.block).toBeUndefined()
    const runs = snapshotRuns(w)
    expect(runs.map((x: any) => x.args[0])).toEqual(['drop'])
    expect(runs[0].args[1]).toBe(REPO)
  })
})

describe('classic.PostToolUseFailure Bash: workflow:snapshot', () => {
  test('given a failed Bash call holding a claim of #10, GitHub listing #10 as building, then bash snapshot.sh take <root> 10 ran and nothing was denied', async ($, on) => {
    const w = world(on, { gh: { issues: [issue(10, 'status:building')] } })
    const r = await failed($, `${CLAIM(10)} && ls /w/nowhere`)
    expect(r?.block).toBeUndefined()
    const runs = snapshotRuns(w)
    expect(runs.map((x: any) => x.args[0])).toEqual(['take'])
    expect(runs[0].args.slice(1)).toEqual([REPO, '10'])
  })
})

// The session repo paired with a public issue repo in its committed settings.
const PAIRED = { [REPO]: '{ "version": 1, "enabled": true, "public": "acme/public" }\n' }
const mirrorRuns = (w: any) => w.runs('public/mirror.js')

describe('classic.PostToolUse Bash: workflow:public-mirror', () => {
  test('given a paired repo and gh issue edit 12 --add-label status:qa, then node public/mirror.js 12 ran from the root and nothing was denied', async ($, on) => {
    const w = world(on, { repos: PAIRED })
    const r = await posted($, 'gh issue edit 12 --add-label status:qa')
    expect(r?.block).toBeUndefined()
    const runs = mirrorRuns(w)
    expect(runs.length).toBe(1)
    expect(runs[0].argv.slice(-1)).toEqual(['12'])
    expect(runs[0].init.cwd).toBe(REPO)
  })
})

describe('classic.PostToolUseFailure Bash: workflow:public-mirror', () => {
  test('given a failed Bash call holding gh issue edit 12 --add-label status:qa in a paired repo, then no mirror ran', async ($, on) => {
    const w = world(on, { repos: PAIRED })
    const r = await failed($, 'gh issue edit 12 --add-label status:qa && ls /w/nowhere')
    expect(r?.block).toBeUndefined()
    expect(mirrorRuns(w)).toEqual([])
  })
})

describe('classic.PostToolUse Bash: workflow:snapshot, the claim and the release', () => {
  test('ports "a second claim while the snapshot is live adds its number and leaves the tree alone": stale answers live, add runs', async ($, on) => {
    const w = world(on, { files: LIVE, snapshot: { stale: { exitCode: 1 } } })
    await posted($, CLAIM(6))
    expect(modes(w)).not.toContain('take')
    const add = snapshotRuns(w).find((x: any) => x.args[0] === 'add')
    expect(add?.args.slice(1)).toEqual([REPO, '6'])
  })

  test('ports "a claim after every recorded issue left building replaces the snapshot": stale answers stale, take runs', async ($, on) => {
    const w = world(on, { files: LIVE, snapshot: { stale: { exitCode: 0 } } })
    await posted($, CLAIM(6))
    expect(modes(w)).toContain('take')
    expect(modes(w)).not.toContain('add')
  })

  test('ports "a failed GitHub read at a claim keeps the live snapshot and adds the number"', async ($, on) => {
    const w = world(on, { files: LIVE, snapshot: { stale: { exitCode: 2 } } })
    await posted($, CLAIM(6))
    expect(modes(w)).not.toContain('take')
    expect(modes(w)).toContain('add')
  })

  test('ports "a re-claim of a recorded issue after a block keeps the first tree, the number once"', async ($, on) => {
    const w = world(on, { files: LIVE, snapshot: { stale: { exitCode: 0 } } })
    await posted($, CLAIM(5))
    expect(modes(w)).not.toContain('take')
  })
})
