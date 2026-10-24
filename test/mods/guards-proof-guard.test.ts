// tool.call Bash through the hooks module: safety:proof-guard in the Bash
// chain, its issue read through gh, the qa flip's touched list read through git
// (the working diff, the untracked files, the committed leg), its records read
// from the workflow home, the repo a --repo names found on the roster, and the chain's
// order. The verdict's own cases are test/hooks/proof-guard/*.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, kitLogs, TOOL_SPY, REPO, HOME, OPTED_IN, bash, answered, denyOf } from '../lib/mod-world.ts'

const TMP = '/w/tmp'
const OTHER = '/w/other'
const TREE = 'a'.repeat(40)
// The package record's file for each root: the workflow home's markers, the folder, the SHA-1 of the root.
const PKG_RECORD = { [REPO]: `${HOME}/.workkit/markers/claude-package-marker/2d98e56dc36b7431b8f668bf4d7715c564698d73`, [OTHER]: `${HOME}/.workkit/markers/claude-package-marker/733f07a1e1c6941aaa32abd5c1fa4661beb0e6cd` }
const SUITE_RECORD = `${HOME}/.workkit/markers/claude-suite-marker/2d98e56dc36b7431b8f668bf4d7715c564698d73`
const PKG = JSON.stringify({ name: 'fixture', scripts: { test: 'node --test' } })
const RED = 'process.exit(1);\n'
const QA = 'gh issue edit 3 --remove-label status:building --add-label status:qa'

const BLOCK = (n: number, what: string) => `proof-guard: BLOCKED this command. Issue #${n} carries no comment whose line starts with "Proof:", so it cannot ${what} (docs/project-state.md, "The proof": the proof is a hard gate).\nThe proof is written at the PARK by the agent that built the item, from the layers it actually ran (skills/feature/SKILL.md section 6): comment the Proof: line on the issue first, one entry per layer with the command or the reason that layer was skipped, then run this again. It is never invented at ship time and never written on the owner's behalf.`
const QA_BLOCK = (count: number, ...lines: string[]) => `proof-guard: BLOCKED this flip to status:qa: the ${count} touched test file(s) below have no green test run recorded on this tree. In each package named, run its own tests narrowed to those files (\`npm test -- <files>\` from that folder, with the paths in the form its runner takes), then flip again.\n${lines.join('\n')}`
const SPAN = (names: string) => `proof-guard: BLOCKED this command. Its flips to status:qa span more than one repo (${names}), and the park's test-record check reads one repo per command. Run one command per repo, then each flip is proved in its own repo.`
const OFF_ROSTER = (slug: string) => `proof-guard: ${slug} is not opted in on this machine's workkit roster (absent or declined), so the park's test-record check did not run.`
const NOT_READ = 'Commits since the default branch were not read'

const said = (w: any, i = 0) => (answered(w, i)?.context || []).join('\n')
const issueViews = (w: any) => w.ghCalls().filter((c: any) => c.argv[1] === 'issue' && c.argv[2] === 'view')
const roster = (entries: Record<string, string>) => ({ [`${HOME}/.workkit/.repos.json`]: JSON.stringify({ version: 1, repos: entries }) })

// The session repo with a test script, its touched files given as `git status
// --porcelain` lines over files the world holds; `opts` adds to the world.
const qaWorld = (on: any, status: string, files: Record<string, string> = {}, opts: any = {}) => mkWorld(on, {
  env: { TMPDIR: TMP },
  ...opts,
  status: { [REPO]: status, ...(opts.status || {}) },
  files: { [`${REPO}/package.json`]: PKG, ...files, ...(opts.files || {}) },
})

describe('tool.call Bash: safety:proof-guard, the proof gate', () => {
  test('given gh issue edit 12 --add-label status:complete with no Proof: comment in the gh answer, then the deny: ports "the read runs from the session\'s directory"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { gh: { issues: [], views: { 12: { comments: [{ body: 'looks good' }] } } } })
    await bash($, 'gh issue edit 12 --add-label status:complete')
    expect(denyOf(w)).toBe(BLOCK(12, 'move to status:complete'))
    expect(w.toolRan).toBeUndefined()
    const views = issueViews(w)
    expect(views).toHaveLength(1)
    expect(views[0].argv).toEqual(expect.arrayContaining(['12', '--json', 'comments']))
    expect(views[0].init.cwd).toBe(REPO)
    expect(hooksLog(w).filter((l: any) => l.hook === 'safety:proof-guard').map((l: any) => l.verdict)).toEqual(['run'])
  })

  test('a Proof: comment passes the close', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { gh: { issues: [], views: { 7: { comments: [{ body: 'Proof: unit: node tests/x.test.js' }] } } } })
    await bash($, 'gh issue close 7')
    expect(answered(w)?.deny).toBeUndefined()
    expect(w.toolRan?.command).toBe('gh issue close 7')
  })

  test('ports "gh not on PATH: exit 0, and says the gate did not run": the notice in context, one $.ui.log line', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { gh: 'absent' })
    await bash($, 'gh issue close 9')
    expect(answered(w)?.deny).toBeUndefined()
    expect(w.toolRan?.command).toBe('gh issue close 9')
    expect(said(w)).toContain('proof-guard: could not read issue #9')
    expect(said(w)).toContain('so the proof gate did not run on this command.')
    expect(kitLogs(w)).toHaveLength(1)
  })

  test('ports "escaped quotes and a backtick inside single quotes: exit 0 through the loader, no parse error": the guard ran', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on)
    const command = "gh issue comment 3 --body 'say \\\"hi\\\" `foo` \\\"bye\\\"'"
    await bash($, command)
    expect(answered(w)?.deny).toBeUndefined()
    expect(w.toolRan?.command).toBe(command)
    expect(hooksLog(w).filter((l: any) => l.hook === 'safety:proof-guard').map((l: any) => l.verdict)).toEqual(['run'])
  })
})

describe('tool.call Bash: safety:proof-guard at the qa flip', () => {
  test('given the flip to status:qa with a touched test file whose package has no green record, then the deny, and no issue is read', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = qaWorld(on, ' M tests/a.test.js\n', { [`${REPO}/tests/a.test.js`]: RED })
    await bash($, QA)
    expect(denyOf(w)).toBe(QA_BLOCK(1, 'the repo root: tests/a.test.js'))
    expect(issueViews(w)).toHaveLength(0)
  })

  test('ports "the flip writes no record": a record on the tree passes, heard once, and the records are as they were', { plugins: [TOOL_SPY] }, async ($, on) => {
    const record = `${TREE}\n.\n`
    const w = qaWorld(on, ' M tests/a.test.js\n', { [`${REPO}/tests/a.test.js`]: RED, [PKG_RECORD[REPO]]: record })
    await bash($, QA)
    expect(answered(w)?.deny).toBeUndefined()
    expect(said(w)).toContain('proof-guard: every touched test file has a green npm test recorded on this tree: the repo root (1 file(s)).')
    expect(kitLogs(w)).toHaveLength(1)
    expect(w.files.get(PKG_RECORD[REPO])).toBe(record)
    expect(w.files.has(SUITE_RECORD)).toBe(false)
  })

  test('ports "a whole root suite record on the tree": the suite record covers the files', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = qaWorld(on, ' M tests/a.test.js\n', { [`${REPO}/tests/a.test.js`]: RED, [SUITE_RECORD]: `${TREE}\n` })
    await bash($, QA)
    expect(answered(w)?.deny).toBeUndefined()
    expect(said(w)).toContain('proof-guard: the whole root suite is green on this tree, which covers the 1 touched test file(s).')
  })

  test('ports "a new untracked test file counts: no record blocks naming it"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = qaWorld(on, '?? tests/new.test.js\n', { [`${REPO}/tests/new.test.js`]: RED })
    await bash($, QA)
    expect(denyOf(w)).toBe(QA_BLOCK(1, 'the repo root: tests/new.test.js'))
  })

  test('ports "a deleted test file is excluded: no touched test file"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = qaWorld(on, ' D tests/a.test.js\n')
    await bash($, QA)
    expect(answered(w)?.deny).toBeUndefined()
    expect(said(w)).toContain('proof-guard: no touched test files in the working diff, so the qa flip needs no test record.')
  })

  test('ports "the commits since the default branch count, with nothing uncommitted"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = qaWorld(on, '', { [`${REPO}/tests/b.test.js`]: RED },
      { branch: { [REPO]: { originHead: 'origin/main', base: 'c'.repeat(40), committed: ['tests/b.test.js'] } } })
    await bash($, QA)
    expect(denyOf(w)).toBe(QA_BLOCK(1, 'the repo root: tests/b.test.js'))
  })

  test('ports "no origin/HEAD and no upstream: exit 0, the notice names the unread commits"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = qaWorld(on, '', {}, { branch: { [REPO]: {} } })
    await bash($, QA)
    expect(answered(w)?.deny).toBeUndefined()
    expect(said(w)).toContain(NOT_READ)
  })

  test('ports "no origin/HEAD, but an upstream: the committed file with no record blocks"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = qaWorld(on, '', { [`${REPO}/tests/b.test.js`]: RED },
      { branch: { [REPO]: { upstream: 'origin/main', base: 'c'.repeat(40), committed: ['tests/b.test.js'] } } })
    await bash($, QA)
    expect(denyOf(w)).toBe(QA_BLOCK(1, 'the repo root: tests/b.test.js'))
  })

  test('ports "a default branch with no merge base: exit 0, the notice names the unread commits"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = qaWorld(on, '', {}, { branch: { [REPO]: { originHead: 'origin/main' } } })
    await bash($, QA)
    expect(answered(w)?.deny).toBeUndefined()
    expect(said(w)).toContain(NOT_READ)
  })
})

describe('tool.call Bash: safety:proof-guard, the repo a qa flip names', () => {
  const TOUCHED = { [`${REPO}/tests/a.test.js`]: RED }

  test('ports "<flag> naming this repo\'s origin: the touched file with no record blocks", every spelling and letter case', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = qaWorld(on, ' M tests/a.test.js\n', TOUCHED, { files: roster({ [REPO]: 'enabled' }) })
    const flags = ['--repo acme/REPO', '--repo=acme/REPO', '-R acme/REPO', '-Racme/REPO', '-R "acme/REPO"', "--repo='acme/REPO'"]
    for (const flag of flags) await bash($, `gh issue edit 3 ${flag} --add-label status:qa`)
    flags.forEach((flag, i) => expect([flag, denyOf(w, i)]).toEqual([flag, QA_BLOCK(1, 'the repo root: tests/a.test.js')]))
  })

  test('ports "--repo naming a repo with no roster at all" and "-R naming another repo than the origin, with no roster": says it has not opted in', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = qaWorld(on, ' M tests/a.test.js\n', TOUCHED)
    await bash($, 'true && gh issue edit 3 -R owner/other --add-label status:qa')
    expect(answered(w)?.deny).toBeUndefined()
    expect(said(w)).toContain(OFF_ROSTER('owner/other'))
  })

  // The session repo holds a touched file with no record, so a check there
  // would block; the other repo is the one the flip names.
  const crossWorld = (on: any, entries: Record<string, string>, extra: Record<string, string> = {}) => qaWorld(on, ' M tests/a.test.js\n',
    { ...TOUCHED, [`${OTHER}/package.json`]: PKG, [`${OTHER}/tests/b.test.js`]: RED, ...extra }, {
      repos: { [REPO]: OPTED_IN, [OTHER]: OPTED_IN },
      origins: { [OTHER]: 'git@github.com:Owner/Other.git' },
      status: { [OTHER]: ' M tests/b.test.js\n' },
      files: roster(entries),
    })

  test('ports "a touched test with no record in the named roster repo blocks", in every spelling of the flip', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = crossWorld(on, { [REPO]: 'enabled', [OTHER]: 'enabled' })
    const flips = [
      'gh issue edit 3 --repo OWNER/other --add-label status:qa',
      'gh issue edit 3 -R owner/OTHER --add-label status:qa',
      'gh issue edit https://github.com/owner/other/issues/3 --add-label status:qa',
    ]
    for (const flip of flips) await bash($, flip)
    flips.forEach((flip, i) => expect([flip, denyOf(w, i)]).toEqual([flip, QA_BLOCK(1, 'the repo root: tests/b.test.js')]))
  })

  test('ports "a record in the named roster repo passes, and the record is that folder\'s"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = crossWorld(on, { [REPO]: 'enabled', [OTHER]: 'enabled' }, { [PKG_RECORD[OTHER]]: `${TREE}\n.\n` })
    await bash($, 'gh issue edit 3 --repo owner/other --add-label status:qa')
    expect(answered(w, 0)?.deny).toBeUndefined()
    await bash($, QA)
    expect(denyOf(w, 1)).toBe(QA_BLOCK(1, 'the repo root: tests/a.test.js'))
  })

  test('ports "a repo off a roster that lists others" and "a declined roster entry is never matched": says it has not opted in', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = crossWorld(on, { [REPO]: 'enabled', [OTHER]: 'declined' })
    await bash($, 'true && gh issue edit 3 --repo owner/other --add-label status:qa')
    expect(answered(w)?.deny).toBeUndefined()
    expect(said(w)).toContain(OFF_ROSTER('owner/other'))
  })

  test('ports "the cwd repo and a roster repo in one command: exit 2, naming both"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = crossWorld(on, { [REPO]: 'enabled', [OTHER]: 'enabled' })
    await bash($, 'gh issue edit 3 --add-label status:qa && gh issue edit 4 --repo owner/other --add-label status:qa')
    expect(denyOf(w)).toBe(SPAN('acme/repo, owner/other'))
  })

  test('ports "two other repos in one command, one off the roster: exit 2, naming both"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = crossWorld(on, { [REPO]: 'enabled', [OTHER]: 'enabled' })
    await bash($, 'gh issue edit 3 --repo owner/absent --add-label status:qa && gh issue edit 4 --repo owner/other --add-label status:qa')
    expect(denyOf(w)).toBe(SPAN('owner/absent, owner/other'))
  })
})

describe('tool.call Bash: the gh guards keep hooks.json\'s order', () => {
  test('each guard fires once per command, after tree-guard: proof-guard, spec-guard, suite-guard, then findings-guard', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on)
    await bash($, 'ls')
    const order = hooksLog(w).map((l: any) => l.hook)
    const at = (hook: string) => order.indexOf(hook)
    for (const hook of ['safety:proof-guard', 'safety:spec-guard', 'safety:suite-guard', 'safety:findings-guard']) {
      expect(order.filter((h: string) => h === hook)).toHaveLength(1)
    }
    expect(at('safety:tree-guard')).toBeLessThan(at('safety:proof-guard'))
    expect(at('safety:proof-guard')).toBeLessThan(at('safety:spec-guard'))
    expect(at('safety:spec-guard')).toBeLessThan(at('safety:suite-guard'))
    expect(at('safety:suite-guard')).toBeLessThan(at('safety:findings-guard'))
  })
})
