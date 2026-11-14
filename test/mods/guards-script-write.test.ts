// tool.call then classic.PostToolUse (Bash) through the hooks module: safety:script-write, now a disk check
// after the call on POST_BASH_GUARDS. Nothing is refused before the call; after it, each file the call changed
// (the world's files dated at or after the call began) in the repo it started in and the one it ended in, each
// only where that repo opted in, gets the write checks an Edit gets; the chain runs when either opted in. A
// failed check is a notice naming the file and the check, the file left as written. The check over a real repo
// and real shell spellings is test/hooks/script-write.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, contextOf, hooksLog, kitLogs, REPO, PLAIN, HOME, SID, OPTED_IN } from '../lib/mod-world.ts'

const OTHER = '/w/other'
const LINK = '[#4](https://github.com/o/r/issues/4)'
const DOC = `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- ${LINK} - A good entry.\n`
const BAD = `${DOC}\n- An entry with no issue link.\n`
const LINT_FAILS = { exitCode: 1, stdout: '', stderr: 'issue-link: no issue link\n' }

const call = ($: any, command: string) => $.tool.call({ tool: 'Bash', command, description: 'x', tool_use_id: 'toolu_1' } as any)
const post = ($: any, command: string, cwd = REPO) => $.classic.PostToolUse({
  tool_name: 'Bash', tool_input: { command }, tool_response: {}, tool_use_id: 'toolu_1', session_id: SID, cwd,
})
const postFailed = ($: any, command: string, cwd = REPO) => $.classic.PostToolUseFailure({
  tool_name: 'Bash', tool_input: { command }, tool_use_id: 'toolu_1', error: 'Exit code 1', session_id: SID, cwd,
})

/**
 * The call wrote `text` to `rel` under `root`: the world's file, dated after the call began, and git's status
 * line, which a .workkit file never gets, since git ignores the folder.
 */
const wrote = (w: any, root: string, rel: string, text: string) => {
  const file = `${root}/${rel}`
  const tracked = w.files.has(file)
  w.files.set(file, text)
  w.mtimes.set(file, Date.now() + 1000)
  if (!rel.startsWith('.workkit/')) w.status[root] = `${w.status[root] ?? ''}${tracked ? ' M' : '??'} ${rel}\n`
}
const lintRuns = (w: any) => w.runs('changelog/lint.js').map((c: any) => c.argv.find((a: string) => a.endsWith('CHANGELOG.md')))
const verdicts = (w: any) => hooksLog(w).filter((l: any) => l.hook === 'safety:script-write').map((l: any) => l.verdict)

describe('safety:script-write: the disk check after a Bash call', () => {
  test('a call that rewrites a tracked CHANGELOG with a bad entry runs, then the notice names the file and docs:changelog-guard, the file left as written', async ($, on) => {
    const w = mkWorld(on, { lint: LINT_FAILS, files: { [`${REPO}/CHANGELOG.md`]: DOC } })
    const command = "sed -i.bak 's/A good entry./A good entry./' CHANGELOG.md"
    await call($, command)
    expect(w.toolRan?.command).toBe(command)
    wrote(w, REPO, 'CHANGELOG.md', BAD)
    const r = await post($, command)
    expect(r?.block).toBeUndefined()
    const said = contextOf(r)
    expect(said).toContain('CHANGELOG.md')
    expect(said).toContain('docs:changelog-guard')
    // The file changed during the call, which may not be the call's own write: the notice never claims it was.
    expect(said).toContain('changed during this Bash call')
    expect(said).not.toContain('a Bash call changed')
    expect(w.files.get(`${REPO}/CHANGELOG.md`)).toBe(BAD)
    expect(verdicts(w)).toEqual(['run'])
  })

  test('a call that writes CHANGELOG.md and stages it still gets the docs:changelog-guard line', async ($, on) => {
    const w = mkWorld(on, { lint: LINT_FAILS, files: { [`${REPO}/CHANGELOG.md`]: DOC } })
    const command = `printf '%s\\n' '- An entry with no issue link.' >> CHANGELOG.md && git add CHANGELOG.md`
    await call($, command)
    w.files.set(`${REPO}/CHANGELOG.md`, BAD)
    w.mtimes.set(`${REPO}/CHANGELOG.md`, Date.now() + 1000)
    // Staged whole: the index matches the working copy, so only a staged read lists it.
    w.status[REPO] = 'M  CHANGELOG.md\n'
    w.git.staged = ['CHANGELOG.md']
    w.git.changed = []
    const said = contextOf(await post($, command))
    expect(said).toContain('docs:changelog-guard')
    expect(lintRuns(w)).toEqual([`${REPO}/CHANGELOG.md`])
  })

  test('a start mark that fails to write: one line is logged and the call still runs', async ($, on) => {
    const w = mkWorld(on, { unwritable: [`${HOME}/.workkit/markers/claude-call-start`] })
    await call($, 'ls')
    expect(w.toolRan?.command).toBe('ls')
    expect(kitLogs(w)).toHaveLength(1)
  })

  test('classic.PostToolUseFailure: a failed call that wrote the same file gets the same notice', async ($, on) => {
    const w = mkWorld(on, { lint: LINT_FAILS, files: { [`${REPO}/CHANGELOG.md`]: DOC } })
    const command = 'bash scripts/entry.sh && false'
    await call($, command)
    wrote(w, REPO, 'CHANGELOG.md', BAD)
    const said = contextOf(await postFailed($, command))
    expect(said).toContain('CHANGELOG.md')
    expect(said).toContain('docs:changelog-guard')
  })

  test('a Bash call that changes no file: the disk check adds no notice and runs no write check', async ($, on) => {
    const w = mkWorld(on, { lint: LINT_FAILS, files: { [`${REPO}/CHANGELOG.md`]: DOC } })
    await call($, 'ls')
    expect(contextOf(await post($, 'ls'))).toBe('')
    expect(lintRuns(w)).toEqual([])
  })

  test('a call that starts in one opted-in repo, changes folder to a second and writes there: the file in the second repo is checked', async ($, on) => {
    const w = mkWorld(on, {
      lint: LINT_FAILS,
      repos: { [REPO]: OPTED_IN, [OTHER]: OPTED_IN },
      files: { [`${REPO}/CHANGELOG.md`]: DOC, [`${OTHER}/CHANGELOG.md`]: DOC },
    })
    const command = `cd ${OTHER} && printf '%s\\n' '- An entry with no issue link.' >> CHANGELOG.md`
    await call($, command)
    wrote(w, OTHER, 'CHANGELOG.md', BAD)
    const said = contextOf(await post($, command, OTHER))
    expect(said).toContain('docs:changelog-guard')
    expect(lintRuns(w)).toEqual([`${OTHER}/CHANGELOG.md`])
  })

  test('a call that starts in an opted-in repo, writes there and ends in a plain folder: the start repo\'s file is checked', async ($, on) => {
    const w = mkWorld(on, { lint: LINT_FAILS, files: { [`${REPO}/CHANGELOG.md`]: DOC } })
    const command = `printf '%s\\n' '- An entry with no issue link.' >> CHANGELOG.md && cd ${PLAIN}`
    await call($, command)
    wrote(w, REPO, 'CHANGELOG.md', BAD)
    const said = contextOf(await post($, command, PLAIN))
    expect(said).toContain('docs:changelog-guard')
    expect(lintRuns(w)).toEqual([`${REPO}/CHANGELOG.md`])
  })

  test('a call that starts in an opted-in repo, writes a new src/thing.js and a test missing the bar there, and ends in a plain folder: the test-reminder and test-bar lines for those files', async ($, on) => {
    const w = mkWorld(on, { files: { [`${REPO}/tests/other.test.js`]: "require('../src/other');\n" } })
    const command = `bash scripts/scaffold.sh && cd ${PLAIN}`
    await call($, command)
    wrote(w, REPO, 'src/thing.js', 'module.exports = 1;\n')
    wrote(w, REPO, 'tests/bar.test.js', "const fs = require('fs');\nconst dir = fs.mkdtempSync('bar-');\n")
    const said = contextOf(await post($, command, PLAIN))
    expect(said).toContain('src/thing.js has no test naming it.')
    expect(said).toContain('test-bar: tests/bar.test.js:2 ')
  })

  test('a call that starts in a plain folder and ends in an opted-in repo it wrote in: the end repo\'s file is checked', async ($, on) => {
    const w = mkWorld(on, { lint: LINT_FAILS, cwd: PLAIN, files: { [`${REPO}/CHANGELOG.md`]: DOC } })
    const command = `cd ${REPO} && printf '%s\\n' '- An entry with no issue link.' >> CHANGELOG.md`
    await call($, command)
    wrote(w, REPO, 'CHANGELOG.md', BAD)
    const said = contextOf(await post($, command, REPO))
    expect(said).toContain('docs:changelog-guard')
    expect(lintRuns(w)).toEqual([`${REPO}/CHANGELOG.md`])
  })

  test('a call that writes in a repo that has not opted in and ends in one that has: the write is not checked', async ($, on) => {
    const w = mkWorld(on, {
      lint: LINT_FAILS,
      cwd: OTHER,
      repos: { [REPO]: OPTED_IN, [OTHER]: null },
      files: { [`${REPO}/CHANGELOG.md`]: DOC, [`${OTHER}/CHANGELOG.md`]: DOC },
    })
    const command = `printf '%s\\n' '- An entry with no issue link.' >> CHANGELOG.md && cd ${REPO}`
    await call($, command)
    wrote(w, OTHER, 'CHANGELOG.md', BAD)
    await post($, command, REPO)
    expect(lintRuns(w)).toEqual([])
  })

  test('60 changed files: 50 are checked and the notice says 10 were not', async ($, on) => {
    const w = mkWorld(on, { lint: LINT_FAILS })
    await call($, 'bash scripts/many.sh')
    for (let i = 0; i < 60; i++) wrote(w, REPO, `pkg/p${String(i).padStart(2, '0')}/CHANGELOG.md`, BAD)
    const said = contextOf(await post($, 'bash scripts/many.sh'))
    expect(lintRuns(w)).toHaveLength(50)
    expect(said).toMatch(/\b10\b/)
  })

  test('a Bash call that runs workkit note outside a triage run: the notice says the capture file changed and is the owner\'s', async ($, on) => {
    const w = mkWorld(on, { files: { [`${REPO}/.workkit/capture.md`]: '# capture\n' } })
    const command = 'workkit note "a thought"'
    await call($, command)
    expect(w.toolRan?.command).toBe(command)
    wrote(w, REPO, '.workkit/capture.md', '# capture\n\n- a thought\n')
    const said = contextOf(await post($, command))
    expect(said).toContain('.workkit/capture.md')
    expect(said).toContain('owner')
  })
})
