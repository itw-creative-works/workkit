// classic.PostToolUse (Bash) through the hooks module: workflow:snapshot on
// POST_BASH_GUARDS, which never blocks: a claim runs the snapshot.sh entry's
// take (an add, while a live snapshot is not stale), a release leaving none
// building runs its drop, each through $.process.run. The plan's own cases
// and the copy are tests/hooks/workflow-snapshot.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, REPO, SID } from '../lib/mod-world.ts'

const TMP = '/w/tmp'
// The snapshot folder of the session repo: TMPDIR, the folder, the SHA-1 of the root.
const SNAP = `${TMP}/claude-red-snapshot/2d98e56dc36b7431b8f668bf4d7715c564698d73`
const LIVE = { [`${SNAP}/tree/src/x.js`]: 'module.exports = 1;\n', [`${SNAP}/head`]: `${'c'.repeat(40)}\n`, [`${SNAP}/issues`]: '5\n' }
const issue = (number: number, ...labels: string[]) => ({ number, labels: labels.map((name) => ({ name })) })

const CLAIM = (n: number) => `gh issue edit ${n} --add-label status:building`

const posted = ($: any, command: string) => $.classic.PostToolUse({
  tool_name: 'Bash', tool_input: { command }, tool_response: {}, tool_use_id: 'toolu_1', session_id: SID, cwd: REPO,
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
