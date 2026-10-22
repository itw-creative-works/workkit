// tool.call Bash through the hooks module, reached the way a session reaches
// it, through $.tool.call: the gate (optinRepo, the roster read through git),
// then BASH_GUARDS in order, safety:commit-language first of the module's.
// The verdict's own cases are tests/hooks/commit-language.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, kitLogs, TOOL_SPY, REPO, PLAIN, HOME, OPTED_IN, bash, answered, denyOf } from '../lib/mod-world.ts'

const VOCAB = 'commit-language: BLOCKED this commit: the message uses non-neutral vocabulary: kill \nReword per the AGENTS.md neutral-language rule (terminate not kill, remove not destroy, stale not dead) and commit again. If a listed word is a literal file/identifier name, keep it unquoted in the command or rephrase around it.'
const GUARDS = ['safety:commit-language', 'safety:release-taken', 'safety:tree-guard']

const verdicts = (w: any, hook: string) => hooksLog(w).filter((l: any) => l.hook === hook).map((l: any) => l.verdict)

describe('tool.call Bash: safety:commit-language', () => {
  test('a commit saying "kill the server" in an opted-in repo is denied with the hook\'s text, and no later guard runs', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on)
    await bash($, 'git commit -m "kill the server"')
    expect(denyOf(w)).toBe(VOCAB)
    expect(w.toolRan).toBeUndefined()
    expect(verdicts(w, 'safety:commit-language')).toEqual(['run'])
    expect(verdicts(w, 'safety:release-taken')).not.toContain('run')
    expect(verdicts(w, 'safety:tree-guard')).not.toContain('run')
  })

  test('ports "cwd in a repo with no origin, bad subject: exit 0 and silent": the origin is read through git', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { origins: { [REPO]: null } })
    await bash($, 'git commit -m "pub 1"')
    expect(answered(w)?.deny).toBeUndefined()
    expect(w.toolRan?.command).toBe('git commit -m "pub 1"')
  })

  test('ports "cwd in a repo with an origin, bad subject: exit 2 as today"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on)
    await bash($, 'git commit -m "pub 1"')
    expect(denyOf(w)).toBe('commit-language: BLOCKED this commit: the subject line is not Conventional Commits: pub 1\nWrite it as <type>(<scope>): <subject> with type one of feat/fix/docs/chore/refactor/test and a lowercase first word, e.g. fix(hooks): bounce the empty span.')
  })

  test('ports "HOOK_DISABLE=1 no-ops a hook that would block": next(e) unchanged and no hooks-log line', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { env: { HOOK_DISABLE: '1' } })
    await bash($, 'git commit -m "kill the server"')
    expect(answered(w)?.deny).toBeUndefined()
    expect(w.toolRan?.tool).toBe('Bash')
    expect(w.toolRan?.command).toBe('git commit -m "kill the server"')
    expect(hooksLog(w)).toHaveLength(0)
  })

  test('ports "a fire in an opted-in repo appends one six-field line ending in run": one line per guard', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on)
    await bash($, 'ls')
    for (const hook of GUARDS) expect(verdicts(w, hook)).toEqual(['run'])
    for (const l of hooksLog(w)) expect(l.line.split('\t')).toHaveLength(6)
    expect(w.toolRan?.command).toBe('ls')
    expect(kitLogs(w)).toHaveLength(0)
  })

  test('ports "a fire in a repo that has not opted in appends one line ending in stood-down": and the commit is not judged', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { repos: { [REPO]: null } })
    await bash($, 'git commit -m "kill the server"')
    expect(answered(w)?.deny).toBeUndefined()
    for (const hook of GUARDS) expect(verdicts(w, hook)).toEqual(['stood-down'])
  })
})

// The loader's opt-in cases whose --repo names a ROSTERED repo: its folder is
// found by reading each roster entry's origin. acme/tools is on the roster and
// opted in; acme/other is off it.
const TOOLS = '/w/tools'
const ON = 'gh issue edit 5 --repo acme/tools --add-label status:qa'
const OFF = 'gh issue view 1 --repo acme/other'
const rostered = (on: any, cwd: string) => mkWorld(on, {
  cwd,
  repos: { [REPO]: OPTED_IN, [TOOLS]: OPTED_IN },
  files: { [`${HOME}/.workkit/.repos.json`]: JSON.stringify({ version: 1, repos: { [TOOLS]: 'enabled' } }) },
})
const gate = (w: any) => verdicts(w, 'safety:commit-language')

describe('tool.call Bash: the gate reads the roster', () => {
  test('ports "gh --repo is judged by the named repo, found through the roster"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = rostered(on, PLAIN)
    await bash($, 'gh issue edit 3 --repo acme/tools --body x')
    await bash($, 'gh issue edit 3 -R acme/tools --body x')
    await bash($, 'gh issue edit 3 --repo acme/other --body x')
    expect(gate(w)).toEqual(['run', 'run', 'stood-down'])
  })

  test('ports "a --repo or -R inside quoted text names no repo; an issue URL does": the rostered half', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = rostered(on, REPO)
    await bash($, 'gh issue edit https://github.com/acme/tools/issues/3 --add-label x')
    await bash($, 'gh issue edit https://github.com/acme/other/issues/3 --add-label x')
    expect(gate(w)).toEqual(['run', 'stood-down'])
  })

  test('ports "an off-roster repo then a rostered opted-in one runs the hook, from no repo and from an opted-in repo"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = rostered(on, PLAIN)
    await bash($, ON)
    await bash($, `${OFF}; ${ON}`)
    w.cwd = TOOLS
    await bash($, `${OFF}; ${ON}`)
    expect(gate(w)).toEqual(['run', 'run', 'run'])
  })

  test('ports "a rostered opted-in repo then an off-roster one runs the hook, from no repo and from an opted-in repo"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = rostered(on, PLAIN)
    await bash($, `${ON}; ${OFF}`)
    w.cwd = TOOLS
    await bash($, `${ON}; ${OFF}`)
    expect(gate(w)).toEqual(['run', 'run'])
  })
})
