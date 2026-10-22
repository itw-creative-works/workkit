// tool.call Bash through the hooks module: safety:suite-guard in the Bash
// chain, its record read from TMPDIR against the tree tree-hash.sh prints (the
// index's for `workkit prove`), its building read through gh from the root, no
// gh call in a repo with no origin, and a gh that cannot answer passing the
// run with one $.ui.log line. The verdict's own cases are tests/hooks/suite-guard.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, kitLogs, TOOL_SPY, REPO, bash, answered, denyOf } from '../lib/mod-world.ts'

const TMP = '/w/tmp'
const TREE = 'a'.repeat(40)
const SUITE_RECORD = `${TMP}/claude-suite-marker/2d98e56dc36b7431b8f668bf4d7715c564698d73`
const PKG = JSON.stringify({ name: 'fixture', scripts: { test: 'node tests/run.js' } })
const NARROW = "Run the narrowest test that proves the change (`npm test -- <file>` from the package's folder)"
const PROVED = `suite-guard: this tree is already proved: the full suite ran green on it and ${SUITE_RECORD} records it. ${NARROW}; the commit gate reads the same record for a commit whose staged tree matches it.`
const HOLD = (named: string) => `suite-guard: the full suite runs once, at the commit, after every item in the tree is parked and passed; still building: ${named}. That work has to finish first: its tests green and its Proof: comment posted, then its own park moves it to status:qa. Never relabel an item to get past this guard. ${NARROW}.`
const issue = (number: number, ...labels: string[]) => ({ number, labels: labels.map((name) => ({ name })) })
const BUILDING = [issue(12, 'status:qa', 'type:bug'), issue(7, 'status:building', 'type:feature')]

const issueLists = (w: any) => w.ghCalls().filter((c: any) => c.argv[1] === 'issue' && c.argv[2] === 'list')
const world = (on: any, opts: any = {}) => mkWorld(on, {
  env: { TMPDIR: TMP }, ...opts, files: { [`${REPO}/package.json`]: PKG, ...(opts.files || {}) },
})

describe('tool.call Bash: safety:suite-guard', () => {
  test('ports "the loader routes safety:suite-guard and propagates the bounce": a repeat on a proved tree is denied, naming the record', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, { files: { [SUITE_RECORD]: `${TREE}\n` } })
    await bash($, 'npm test')
    expect(denyOf(w)).toBe(PROVED)
    expect(w.toolRan).toBeUndefined()
    expect(w.runs('tree-hash.sh')).toHaveLength(1)
    expect(hooksLog(w).filter((l: any) => l.hook === 'safety:suite-guard').map((l: any) => l.verdict)).toEqual(['run'])
  })

  test('ports "workkit prove with the index tree proved bounces": prove is judged by the index tree, git write-tree', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on)
    await bash($, 'workkit prove')
    expect(w.calls.some((c: any) => c.argv[0].split('/').pop() === 'git' && c.argv.includes('write-tree'))).toBe(true)
    expect(w.runs('tree-hash.sh')).toHaveLength(0)
  })

  test('ports "a root run with an open issue at status:building bounces, naming it": filtered on the server by the stage label, read from the root', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, { gh: { issues: BUILDING } })
    await bash($, 'npm test')
    expect(denyOf(w)).toBe(HOLD('#7 (status:building)'))
    const lists = issueLists(w)
    expect(lists).toHaveLength(1)
    expect(lists[0].argv).toEqual(expect.arrayContaining(['--label', 'status:building']))
    expect(lists[0].init.cwd).toBe(REPO)
  })

  test('ports "a repo with no origin passes without calling gh"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, { gh: { issues: BUILDING }, origins: { [REPO]: null } })
    await bash($, 'npm test')
    expect(answered(w)?.deny).toBeUndefined()
    expect(w.toolRan?.command).toBe('npm test')
    expect(issueLists(w)).toHaveLength(0)
  })

  for (const gh of ['offline', 'absent']) {
    test(`given gh answering an error (${gh}), then suite-guard passes with a $.ui.log line: ports "gh failing" and "gh absent"`, { plugins: [TOOL_SPY] }, async ($, on) => {
      const w = world(on, { gh })
      await bash($, 'npm test')
      expect(answered(w)?.deny).toBeUndefined()
      expect(w.toolRan?.command).toBe('npm test')
      const logged = kitLogs(w)
      expect(logged).toHaveLength(1)
      expect(logged[0]).toContain('suite-guard')
    })
  }

  test('ports "a narrowed run passes while an issue is building": no gh read', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, { gh: { issues: BUILDING } })
    await bash($, 'npm test -- tests/hooks/suite-guard.test.js')
    expect(answered(w)?.deny).toBeUndefined()
    expect(issueLists(w)).toHaveLength(0)
    expect(kitLogs(w)).toHaveLength(0)
  })
})
