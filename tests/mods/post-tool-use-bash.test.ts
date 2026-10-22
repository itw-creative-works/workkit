// classic.PostToolUse (Bash) through the hooks module: workflow:snapshot on
// POST_BASH_GUARDS, which never blocks: a claim runs the snapshot.sh entry's
// take (an add, while a live snapshot is not stale), a release leaving none
// building runs its drop, each through $.process.run. The plan's own cases
// and the copy are tests/hooks/workflow-snapshot.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, kitLogs, contextOf, REPO, HOME, SID, OPTED_IN } from '../lib/mod-world.ts'

const TMP = '/w/tmp'
const OTHER = '/w/other'
// The snapshot folder of the session repo: TMPDIR, the folder, the SHA-1 of the root.
const SNAP = `${TMP}/claude-red-snapshot/2d98e56dc36b7431b8f668bf4d7715c564698d73`
const OTHER_SNAP = `${TMP}/claude-red-snapshot/733f07a1e1c6941aaa32abd5c1fa4661beb0e6cd`
const LIVE = { [`${SNAP}/tree/src/x.js`]: 'module.exports = 1;\n', [`${SNAP}/head`]: `${'c'.repeat(40)}\n`, [`${SNAP}/issues`]: '5\n' }
const issue = (number: number, ...labels: string[]) => ({ number, labels: labels.map((name) => ({ name })) })

const CLAIM = (n: number) => `gh issue edit ${n} --add-label status:building`
const QA = (n: number) => `gh issue edit ${n} --remove-label status:building --add-label status:qa`

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

describe('classic.PostToolUse Bash: workflow:snapshot, every clause in order', () => {
  const rostered = {
    repos: { [REPO]: OPTED_IN, [OTHER]: OPTED_IN },
    origins: { [OTHER]: 'git@github.com:owner/other.git' },
    files: { [`${HOME}/.workkit/.repos.json`]: JSON.stringify({ version: 1, repos: { [REPO]: 'enabled', [OTHER]: 'enabled' } }) },
  }

  test('two claims in one command record issues [5, 6] in the snapshot', async ($, on) => {
    const w = world(on, { snapshotDirs: { [REPO]: SNAP }, snapshot: { stale: { exitCode: 1 } }, gh: { issues: [issue(5, 'status:building'), issue(6, 'status:building')] } })
    const r = await posted($, `${CLAIM(5)} && ${CLAIM(6)}`)
    expect(r?.block).toBeUndefined()
    expect(w.files.get(`${SNAP}/issues`)).toBe('5\n6\n')
  })

  test('two claims in two repos, --repo owner/other on the second, take a snapshot of each repo', async ($, on) => {
    const w = world(on, { ...rostered, snapshotDirs: { [REPO]: SNAP, [OTHER]: OTHER_SNAP } })
    await posted($, `${CLAIM(5)} && gh issue edit 6 --repo owner/other --add-label status:building`)
    expect(snapshotRuns(w).filter((x: any) => x.args[0] === 'take').map((x: any) => x.args[1])).toEqual([REPO, OTHER])
    expect(w.files.get(`${SNAP}/issues`)).toBe('5\n')
    expect(w.files.get(`${OTHER_SNAP}/issues`)).toBe('6\n')
  })

  test('an unreadable --repo clause followed by a claim gives the note AND takes the snapshot', async ($, on) => {
    const w = world(on)
    const r = await posted($, `gh issue edit 4 --repo "$R" --add-label status:building && ${CLAIM(5)}`)
    expect(r?.block).toBeUndefined()
    expect(`${contextOf(r)}\n${kitLogs(w).join('\n')}`).toContain('a --repo value could not be read')
    const takes = snapshotRuns(w).filter((x: any) => x.args[0] === 'take')
    expect(takes.map((x: any) => x.args[1])).toEqual([REPO])
    expect(takes[0].args.slice(2)).toContain('5')
  })
})

describe('classic.PostToolUse Bash: workflow:snapshot, the claim and the release', () => {
  test('ports "the qa flip with another issue still building leaves the snapshot"', async ($, on) => {
    const w = world(on, { files: LIVE, gh: { issues: [issue(6, 'status:building')] } })
    await posted($, QA(5))
    expect(modes(w)).toEqual([])
  })

  test('ports "a flip off building that adds neither qa nor complete leaves the snapshot and calls no gh"', async ($, on) => {
    const w = world(on, { files: LIVE, gh: { issues: [] } })
    await posted($, 'gh issue edit 5 --remove-label status:building --add-label status:blocked')
    expect(modes(w)).toEqual([])
    expect(w.ghCalls()).toHaveLength(0)
  })

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

  test('ports "a claim naming another repo snapshots its roster folder, not the session repo"', async ($, on) => {
    const w = world(on, {
      repos: { [REPO]: OPTED_IN, [OTHER]: OPTED_IN },
      origins: { [OTHER]: 'git@github.com:owner/other.git' },
      files: { [`${HOME}/.workkit/.repos.json`]: JSON.stringify({ version: 1, repos: { [REPO]: 'enabled', [OTHER]: 'enabled' } }) },
    })
    await posted($, 'gh issue edit 5 --repo owner/other --add-label status:building')
    const runs = snapshotRuns(w)
    expect(runs.map((x: any) => x.args[0])).toEqual(['take'])
    expect(runs[0].args[1]).toBe(OTHER)
  })

  test('ports "a claim naming a repo off the roster: the notice names it, no snapshot", never a block', async ($, on) => {
    const w = world(on)
    const r = await posted($, `true && gh issue edit 5 --repo owner/other --add-label status:building`)
    expect(r?.block).toBeUndefined()
    expect(modes(w)).toEqual([])
    expect(`${contextOf(r)}\n${kitLogs(w).join('\n')}`).toContain('owner/other is not opted in')
  })

  test('ports "no claim and no park does nothing and calls no gh"', async ($, on) => {
    const w = world(on, { gh: { issues: [issue(5, 'status:building')] } })
    for (const command of ['git status --short', 'gh issue view 5', 'gh issue comment 5 --body "moving to status:building next"']) {
      await posted($, command)
    }
    expect(modes(w)).toEqual([])
    expect(w.ghCalls()).toHaveLength(0)
  })
})
