// classic.SessionStart through the hooks module: docs:state-check, then
// workflow:standards, then workflow:reload-guard's stamp, then docs:session. The
// state-check cache and the standards daily marker are files under ~/.claude/logs.

import { test, expect, describe } from 'claude-code/testing'
import {
  mkWorld, contextOf, hooksLog, HOME, REPO, PLAIN, SID, OPTED_OUT, OPT_IN_SHAPES, SESSION_NOW as NOW, daysBefore, briefMarker,
} from '../lib/mod-world.ts'

const start = ($: any, cwd: string, extra: any = {}) => $.classic.SessionStart({ source: 'startup', session_id: SID, cwd, ...extra })
const HEAL = { exitCode: 0, stdout: '', stderr: '  ✓ issue forms: installed\n  ✓ gitignore: added .workkit/*\n' }
// A heal is the engine run with no mode flag (--state and --announce only read).
const heals = (w: any) => w.runs('standards.js').filter((c: any) => !c.argv.some((a: string) => a.startsWith('--')))
// The engine the world is built with: the plugin these suites run, two folders above this one, then workflow.
const ENGINE = `${import.meta.dir.replace(/[\\/]test[\\/]mods$/, '')}/workflow`
// Every start of a program named bash, by name or by path.
const bashStarts = (w: any) => w.calls.filter((c: any) => c.argv[0].split('/').pop() === 'bash')
// The setup line the pester hands over: `node <engine>/workkit.js setup`, the cloud's with `--cloud`.
const SETUP_RUN = /`node [^`]+\/workflow\/workkit\.js setup`/
const CLOUD_RUN = /`node [^`]+\/workflow\/workkit\.js setup --cloud`/
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const markerPath = (w: any) => [...w.files.keys()].find((p: string) => p.startsWith(`${HOME}/.claude/logs/`) && w.files.get(p) === today())

describe('classic.SessionStart: the Contract case', () => {
  test('outside any git repo: standards returns the setup line only, reload-guard stamps, state-check adds nothing', async ($, on) => {
    const w = mkWorld(on, { setup: false, gh: { issues: [{ number: 1 }] }, standards: { state: 'nogit' } })
    const r = await start($, PLAIN)
    expect(r.additionalContext).toHaveLength(1)
    expect(r.additionalContext[0]).toContain('SETUP:')
    expect(r.additionalContext[0]).toMatch(SETUP_RUN)
    expect(w.sessionKeys(SID).length).toBeGreaterThan(0)
    expect(w.ghCalls()).toHaveLength(0)
  })
})

describe('classic.SessionStart: docs:state-check (state-check suite)', () => {
  test('a non-git directory: silent, gh is never called', async ($, on) => {
    const w = mkWorld(on, { gh: { issues: [{ number: 1 }] }, standards: { state: 'nogit' } })
    expect(contextOf(await start($, PLAIN))).toBe('')
    expect(w.ghCalls()).toHaveLength(0)
  })

  test('a repo with no inbox issues: silent', async ($, on) => {
    mkWorld(on, { gh: { issues: [] } })
    expect(contextOf(await start($, REPO))).toBe('')
  })

  test('the query is read-only, open, and label-scoped', async ($, on) => {
    const w = mkWorld(on, { gh: { issues: [{ number: 1 }] } })
    await start($, REPO)
    const calls = w.ghCalls()
    expect(calls).toHaveLength(1)
    const argv = calls[0].argv
    const hasFlag = (flag: string, value: string) => argv.some((a: string, i: number) => a === flag && argv[i + 1] === value)
    expect(hasFlag('--state', 'open')).toBe(true)
    expect(hasFlag('--label', 'status:inbox')).toBe(true)
    expect(argv.some((a: string) => /^(create|edit|close|comment|delete)$/.test(a))).toBe(false)
  })

  test('no gh on PATH: silent skip, everything else still checked', async ($, on) => {
    mkWorld(on, { gh: 'absent', files: { [`${REPO}/CLAUDE.md`]: '# Big Doc\n\nrules\nmore rules\nand more\n' } })
    const ctx = contextOf(await start($, REPO))
    expect(ctx).not.toContain('status:inbox')
    expect(ctx).toContain('git mv CLAUDE.md AGENTS.md')
  })

  test('gh failing (offline / unauthenticated): silent skip', async ($, on) => {
    mkWorld(on, { gh: 'offline' })
    expect(contextOf(await start($, REPO))).toBe('')
  })

  test('output is valid JSON when announcing: the count arrives as one context entry', async ($, on) => {
    mkWorld(on, { gh: { issues: [{ number: 9 }] } })
    const r = await start($, REPO)
    expect(r.additionalContext.some((c: string) => c.includes('1 open status:inbox issue.'))).toBe(true)
  })

  test('the user-level ~/.claude/CLAUDE.md is out of scope: silent', async ($, on) => {
    const claude = `${HOME}/.claude`
    mkWorld(on, { repos: { [claude]: OPT_IN_SHAPES.current }, files: { [`${claude}/CLAUDE.md`]: '@AGENTS.md\n' } })
    expect(contextOf(await start($, claude))).not.toContain('CLAUDE.md')
  })

  test('empty cwd in input: exit 0', async ($, on) => {
    const w = mkWorld(on, { gh: { issues: [{ number: 1 }] }, standards: { state: 'nogit' } })
    expect(contextOf(await start($, ''))).not.toContain('status:inbox')
    expect(w.ghCalls()).toHaveLength(0)
  })

  test('an empty queue is cached: a second session inside 30 minutes makes no gh call', async ($, on) => {
    const w = mkWorld(on, { gh: { issues: [] } })
    expect(contextOf(await start($, REPO))).toBe('')
    expect(w.ghCalls()).toHaveLength(1)
    expect(contextOf(await start($, REPO, { session_id: 'sess-2' }))).toBe('')
    expect(w.ghCalls()).toHaveLength(1)
  })

  test('a count worth announcing is never cached: the next session asks again', async ($, on) => {
    const w = mkWorld(on, { gh: { issues: [{ number: 1 }, { number: 2 }] } })
    expect(contextOf(await start($, REPO))).toContain('2 open status:inbox')
    expect(contextOf(await start($, REPO, { session_id: 'sess-2' }))).toContain('2 open status:inbox')
    expect(w.ghCalls()).toHaveLength(2)
  })

  test('triage drains the inbox and the very next session goes quiet', async ($, on) => {
    const w = mkWorld(on, { gh: { issues: [{ number: 1 }, { number: 2 }] } })
    expect(contextOf(await start($, REPO))).toContain('2 open status:inbox')
    w.gh = { issues: [] }
    expect(contextOf(await start($, REPO, { session_id: 'sess-2' }))).toBe('')
  })

  test('a cached silence older than 30 minutes re-queries', async ($, on) => {
    const w = mkWorld(on, { gh: { issues: [] } })
    const before = new Set(w.files.keys())
    await start($, REPO)
    const cache = [...w.files.keys()].filter((p: string) => !before.has(p) && p.startsWith(`${HOME}/.claude/logs/`) && w.files.get(p) !== today())
    expect(cache.length).toBeGreaterThan(0)
    for (const p of cache) w.mtimes.set(p, Date.now() - 90 * 60 * 1000)
    w.gh = { issues: [{ number: 1 }] }
    expect(contextOf(await start($, REPO, { session_id: 'sess-2' }))).toContain('1 open status:inbox')
    expect(w.ghCalls()).toHaveLength(2)
  })
})

describe('classic.SessionStart: workflow:standards (workflow-standards suites)', () => {
  test('second session the same day: no re-run, no output', async ($, on) => {
    const w = mkWorld(on, { standards: { heal: HEAL } })
    expect(contextOf(await start($, REPO))).toContain('issue forms')
    expect(contextOf(await start($, REPO, { session_id: 'sess-2' }))).toBe('')
    expect(heals(w)).toHaveLength(1)
  })

  test('the marker is dated, one file per repo', async ($, on) => {
    const other = '/w/other'
    const w = mkWorld(on, { repos: { [REPO]: OPT_IN_SHAPES.current, [other]: OPT_IN_SHAPES.current }, standards: { heal: HEAL } })
    await start($, REPO)
    expect(markerPath(w)).toBeDefined()
    expect(contextOf(await start($, other, { session_id: 'sess-2' }))).toContain('issue forms')
    expect(heals(w)).toHaveLength(2)
  })

  test('a stale marker re-arms the run', async ($, on) => {
    const w = mkWorld(on, { standards: { heal: HEAL } })
    await start($, REPO)
    w.files.set(markerPath(w), '2000-01-01')
    expect(contextOf(await start($, REPO, { session_id: 'sess-2' }))).toContain('issue forms')
    expect(heals(w)).toHaveLength(2)
  })

  test('no WORKFLOW_DIR: resolves the engine beside the hook and heals', async ($, on) => {
    const w = mkWorld(on, { standards: { heal: HEAL } })
    await start($, REPO)
    const script = heals(w)[0].argv.find((a: string) => a.endsWith('standards.js'))
    expect(script.endsWith('/workflow/standards.js')).toBe(true)
    expect(script.startsWith('/w/')).toBe(false)
  })

  test('the state and the heal are each node on <engine>/standards.js', async ($, on) => {
    const w = mkWorld(on, { standards: { heal: HEAL } })
    await start($, REPO)
    expect(w.runs('standards.js').map((c: any) => c.argv)).toEqual([
      ['node', `${ENGINE}/standards.js`, '--state', REPO],
      ['node', `${ENGINE}/standards.js`, REPO],
    ])
  })

  test('the offer is node on standards.js --announce, and the session starts no bash', async ($, on) => {
    const w = mkWorld(on, { setup: false, repos: { [REPO]: null }, standards: { state: 'undecided' } })
    expect(contextOf(await start($, REPO))).toContain('not in the issue workflow')
    const announce = w.runs('standards.js').filter((c: any) => c.argv.includes('--announce'))
    expect(announce).toHaveLength(1)
    expect(announce[0].argv[0]).toBe('node')
    expect(announce[0].argv.slice(2)).toEqual(['--announce', REPO])
    expect(bashStarts(w)).toEqual([])
  })

  test('an enabled repo\'s state, heal and update start no bash', async ($, on) => {
    const w = mkWorld(on, { standards: { heal: HEAL } })
    expect(contextOf(await start($, REPO))).toContain('issue forms')
    expect(bashStarts(w)).toEqual([])
  })

  test('a missing engine: says where it looked, exit 0', async ($, on) => {
    const w = mkWorld(on, { standards: { heal: HEAL } })
    w.touchKit('workflow/standards.js', null)
    const ctx = contextOf(await start($, REPO))
    expect(ctx).toMatch(/\/workflow\/standards\.js/)
    expect(ctx).toContain('plugin')
    expect(heals(w)).toHaveLength(0)
  })

  test('an engine without labels.json is announced for an opted-in repo', async ($, on) => {
    const w = mkWorld(on, { standards: { heal: HEAL } })
    w.touchKit('workflow/labels.json', null)
    const ctx = contextOf(await start($, REPO))
    expect(ctx).toContain('labels.json')
    expect(ctx).toContain('plugin')
    expect(heals(w)).toHaveLength(0)
  })

  for (const [name, settings, rel] of [
    ['a missing manifest stays silent on a repo that never opted in', null, 'workflow/labels.json'],
    ['a missing engine stays silent on a repo that never opted in', null, 'workflow/standards.js'],
    ['a missing engine stays silent on a deliberately disabled repo', OPTED_OUT, 'workflow/standards.js'],
  ] as const) {
    test(`${name}`, async ($, on) => {
      const w = mkWorld(on, { repos: { [REPO]: settings }, standards: { state: settings ? 'disabled' : 'undecided' } })
      w.touchKit(rel, null)
      expect(contextOf(await start($, REPO))).toBe('')
    })
  }

  test('non-git cwd: silent exit 0, creates nothing', async ($, on) => {
    const w = mkWorld(on, { standards: { state: 'nogit', heal: HEAL } })
    expect(contextOf(await start($, PLAIN))).toBe('')
    expect(heals(w)).toHaveLength(0)
  })

  test('empty cwd in input: exit 0 (standards)', async ($, on) => {
    const w = mkWorld(on, { standards: { state: 'nogit', heal: HEAL } })
    expect(contextOf(await start($, ''))).toBe('')
    expect(heals(w)).toHaveLength(0)
  })

  for (const [name, settings] of [
    ['no .workkit/settings.json: offers to enable, writes nothing', null],
    ['a .workkit/settings.json with no enabled key: offers to enable, writes nothing', '{ "version": 1 }\n'],
    ['an empty .workkit/settings.json: offers to enable, writes nothing', ''],
  ] as const) {
    test(`${name}`, async ($, on) => {
      const w = mkWorld(on, { repos: { [REPO]: settings }, standards: { state: 'undecided', heal: HEAL } })
      const ctx = contextOf(await start($, REPO))
      expect(ctx).toContain('not in the issue workflow')
      expect(ctx).toContain('--enable')
      expect(ctx).toContain('--decline')
      expect(heals(w)).toHaveLength(0)
    })
  }

  for (const [name, state] of [['enabled: false: silent, and no offer either', 'disabled'], ['a declined repo is never mentioned again', 'declined']]) {
    test(`${name}`, async ($, on) => {
      const w = mkWorld(on, { repos: { [REPO]: state === 'disabled' ? OPTED_OUT : null }, standards: { state, heal: HEAL } })
      expect(contextOf(await start($, REPO))).toBe('')
      expect(heals(w)).toHaveLength(0)
    })
  }

  test('the offer repeats every session: it is not daily-cached', async ($, on) => {
    const w = mkWorld(on, { repos: { [REPO]: null }, standards: { state: 'undecided' } })
    expect(contextOf(await start($, REPO))).toContain('not in the issue workflow')
    expect(contextOf(await start($, REPO, { session_id: 'sess-2' }))).toContain('not in the issue workflow')
    expect(markerPath(w)).toBeUndefined()
  })

  test('a subdirectory session resolves to the repo root', async ($, on) => {
    const w = mkWorld(on, { standards: { heal: HEAL }, dirs: [`${REPO}/src/deep`] })
    await start($, `${REPO}/src/deep`)
    const heal = heals(w)[0]
    expect(heal.argv.includes(REPO) || heal.init.cwd === REPO).toBe(true)
  })

  test('a machine that never ran setup is told to, every session', async ($, on) => {
    const w = mkWorld(on, { setup: false, standards: { heal: HEAL } })
    const first = contextOf(await start($, REPO))
    expect(first).toContain('SETUP:')
    expect(first).toMatch(SETUP_RUN)
    expect(first).toContain('issue forms')
    const second = contextOf(await start($, REPO, { session_id: 'sess-2' }))
    expect(second).toMatch(SETUP_RUN)
    expect(second).not.toContain('issue forms')
    expect(heals(w)).toHaveLength(1)
  })

  test('setup is a machine question: the pester reaches a non-git cwd too', async ($, on) => {
    mkWorld(on, { setup: false, standards: { state: 'nogit' } })
    expect(contextOf(await start($, PLAIN))).toMatch(SETUP_RUN)
  })

  test('a declined repo still hears the setup pester and nothing else', async ($, on) => {
    mkWorld(on, { setup: false, repos: { [REPO]: null }, standards: { state: 'declined' } })
    const ctx = contextOf(await start($, REPO))
    expect(ctx).toMatch(SETUP_RUN)
    expect(ctx).not.toContain('not in the issue workflow')
  })

  // The engine answers whether it is the plugin cache's copy: `standards.js --in-cache`.
  const IN_CACHE = ['node', `${ENGINE}/standards.js`, '--in-cache']
  const inCacheAsks = (w: any) => w.runs('standards.js').filter((c: any) => c.argv.includes('--in-cache')).map((c: any) => c.argv)
  const setupLineOf = async ($: any) => contextOf(await start($, REPO)).split('\n').find((l: string) => l.startsWith('SETUP:')) || ''

  test('an engine the engine itself calls the plugin cache\'s copy: the pester says so', async ($, on) => {
    const w = mkWorld(on, { setup: false, standards: { inCache: { exitCode: 0, stdout: 'yes\n' } } })
    const line = await setupLineOf($)
    expect(line).toMatch(SETUP_RUN)
    expect(line).toContain('yourself (the engine in the plugin cache) before other work')
    expect(inCacheAsks(w)).toEqual([IN_CACHE])
  })

  test('an engine anywhere else: the pester never mentions the plugin cache', async ($, on) => {
    const w = mkWorld(on, { setup: false, standards: { inCache: { exitCode: 0, stdout: 'no\n' } } })
    const line = await setupLineOf($)
    expect(line).toMatch(SETUP_RUN)
    expect(line).toMatch(/setup` yourself/)
    expect(line).not.toMatch(/tell the user/i)
    expect(line).not.toContain('plugin cache')
    expect(inCacheAsks(w)).toEqual([IN_CACHE])
  })

  test('an --in-cache run that fails is no answer: the pester never mentions the plugin cache', async ($, on) => {
    // A yes beside the failed exit, so only the exit code keeps the cache out of the line.
    const w = mkWorld(on, { setup: false, standards: { inCache: { exitCode: 1, stdout: 'yes\n', stderr: 'workkit: cannot read HOME\n' } } })
    const line = await setupLineOf($)
    expect(line).toMatch(SETUP_RUN)
    expect(line).not.toContain('plugin cache')
    expect(inCacheAsks(w)).toEqual([IN_CACHE])
  })

  test('a set-up machine never asks the engine about the plugin cache', async ($, on) => {
    const w = mkWorld(on, { standards: { inCache: { exitCode: 0, stdout: 'yes\n' } } })
    await start($, REPO)
    expect(inCacheAsks(w)).toEqual([])
  })

  test('a cloud session (CLAUDE_CODE_REMOTE=true): the pester names setup --cloud, never the wizard', async ($, on) => {
    mkWorld(on, { setup: false, env: { CLAUDE_CODE_REMOTE: 'true' } })
    const line = contextOf(await start($, REPO)).split('\n').find((l: string) => l.startsWith('SETUP:')) || ''
    expect(line).toMatch(CLOUD_RUN)
    expect(line).not.toMatch(/workkit\.js setup`/)
  })

  test('a machine with no schedule installed never gets one: the daily run calls workkit update --auto', async ($, on) => {
    const w = mkWorld(on)
    await start($, REPO)
    expect(w.runs('workkit.js').map((c: any) => c.argv)).toEqual([['node', `${ENGINE}/workkit.js`, 'update', '--auto']])
  })

  test('a machine with no sign-in hears it at session start', async ($, on) => {
    mkWorld(on, { standards: { update: { exitCode: 0, stdout: '', stderr: '  ⚠ identity: not signed in\n' } } })
    expect(contextOf(await start($, REPO))).toContain('identity: not signed in')
  })

  test("a repo's daily run corrects a schedule left by another checkout: the upkeep line arrives with no indent and no glyph", async ($, on) => {
    mkWorld(on, { standards: { update: { exitCode: 0, stdout: '  ✓ schedule: re-rendered com.workkit.claude-daily\n', stderr: '' } } })
    const relayed = contextOf(await start($, REPO)).split('\n').find((l: string) => l.includes('schedule:'))
    expect(relayed).toMatch(/^schedule: /)
  })

  test('no gh on PATH: local heals still reported, no failure: the heal runs under QUIET=1', async ($, on) => {
    const w = mkWorld(on, { gh: 'absent', standards: { heal: HEAL } })
    expect(contextOf(await start($, REPO))).toContain('issue forms')
    expect(heals(w)[0].init.env?.QUIET).toBe('1')
  })
})

// docs:session: .workkit/agents/session.md handed back with its closing lines,
// the carried-over line the owner sees, and the stale cloud brief line.
const STATE = `${REPO}/.workkit/agents/session.md`
const CARRIED = 'workkit: state carried over. Say "continue" to resume the session queue'
const marker = (n: number) => JSON.stringify(briefMarker(n))
const filled = (n: number) => ['# Session', '', '## Active', ...Array.from({ length: n }, (_, i) => `- #${i}: a queued entry.`), '', '## Queue', ''].join('\n')
const carried = (w: any) => w.logs.filter((l: string) => l === CARRIED)

describe('classic.SessionStart: docs:session (the Contract cases)', () => {
  test('a 10-line session.md: SESSION STATE with the body and both closing lines, and the carried-over line', async ($, on) => {
    const w = mkWorld(on, { now: NOW, files: { [STATE]: filled(10) } })
    const ctx = contextOf(await start($, REPO))
    expect(ctx).toContain('SESSION STATE: ')
    expect(ctx).toContain('.workkit/agents/session.md')
    expect(ctx).toContain('- #9: a queued entry.')
    expect(ctx).toContain('Manager: open your first reply after a restart or compaction with this state in plain words.')
    expect(ctx).toContain('Owner: state carried over. Say "continue" and this session resumes the queue above.')
    expect(carried(w)).toHaveLength(1)
    expect(hooksLog(w).some((l: any) => l.hook === 'docs:session' && l.verdict === 'run')).toBe(true)
  })

  test('no session.md: no SESSION STATE and no carried-over line', async ($, on) => {
    const w = mkWorld(on, { now: NOW })
    expect(contextOf(await start($, REPO))).not.toContain('SESSION STATE')
    expect(carried(w)).toHaveLength(0)
  })

  test('41 content lines: the NOTE: line', async ($, on) => {
    mkWorld(on, { now: NOW, files: { [STATE]: filled(41) } })
    const ctx = contextOf(await start($, REPO))
    expect(ctx.split('\n').some((l: string) => l.startsWith('NOTE:'))).toBe(true)
    expect(ctx).toContain('41 content lines')
  })

  test('brief-status.json three days old and site.repo set: the stale-brief line first, with the gh run list check', async ($, on) => {
    mkWorld(on, {
      now: NOW,
      files: {
        [STATE]: filled(3),
        [`${HOME}/.workkit/brief-status.json`]: marker(3),
        [`${HOME}/.workkit/settings.json`]: JSON.stringify({ version: 1, site: { repo: 'owner/private-home' } }),
      },
    })
    const ctx = contextOf(await start($, REPO))
    expect(ctx.startsWith(`cloud brief: last posted ${daysBefore(3)} (3 days ago)`)).toBe(true)
    expect(ctx).toContain('gh run list --repo owner/private-home --workflow brief.yml')
    expect(ctx.indexOf('cloud brief:')).toBeLessThan(ctx.indexOf('SESSION STATE'))
  })
})

describe('classic.SessionStart: docs:session (session suite)', () => {
  test('every source, a compaction included, gets the session state', async ($, on) => {
    mkWorld(on, { now: NOW, files: { [STATE]: filled(2) } })
    for (const source of ['startup', 'resume', 'clear', 'compact']) {
      expect(contextOf(await start($, REPO, { source }))).toContain('- #1: a queued entry.')
    }
  })

  test('a session opened in a subdirectory finds the repo root', async ($, on) => {
    mkWorld(on, { now: NOW, files: { [STATE]: filled(2) }, dirs: [`${REPO}/src/deep`] })
    expect(contextOf(await start($, `${REPO}/src/deep`))).toContain('- #1: a queued entry.')
  })

  for (const [name, settings] of [
    ['a repo that never opted in: silent, even with content', null],
    ['a repo that turned the workflow off: silent', OPTED_OUT],
  ] as const) {
    test(`${name}`, async ($, on) => {
      const w = mkWorld(on, { now: NOW, repos: { [REPO]: settings }, standards: { state: settings ? 'disabled' : 'undecided' }, files: { [STATE]: filled(2) } })
      expect(contextOf(await start($, REPO))).not.toContain('SESSION STATE')
      expect(carried(w)).toHaveLength(0)
      expect(hooksLog(w).some((l: any) => l.hook === 'docs:session' && l.verdict === 'stood-down')).toBe(true)
    })
  }

  test('no cwd in the payload: silent', async ($, on) => {
    const w = mkWorld(on, { now: NOW, cwd: PLAIN, standards: { state: 'nogit' }, files: { [STATE]: filled(2) } })
    expect(contextOf(await start($, ''))).not.toContain('SESSION STATE')
    expect(carried(w)).toHaveLength(0)
  })

  test('the marker is read from WORKFLOW_HOME, the folder the 9am job writes it to', async ($, on) => {
    mkWorld(on, { now: NOW, env: { WORKFLOW_HOME: '/w/moved' }, files: { '/w/moved/brief-status.json': marker(10) } })
    expect(contextOf(await start($, REPO)).startsWith('cloud brief: last posted')).toBe(true)
  })

  test('a marker that does not parse: silent', async ($, on) => {
    mkWorld(on, { now: NOW, files: { [`${HOME}/.workkit/brief-status.json`]: '{ "version": 1, "lastBrief": ' } })
    expect(contextOf(await start($, REPO))).toBe('')
  })

  test('the hook reaches no network: the marker is the only source', async ($, on) => {
    const w = mkWorld(on, {
      now: NOW,
      files: {
        [`${HOME}/.workkit/brief-status.json`]: marker(10),
        [`${HOME}/.workkit/settings.json`]: JSON.stringify({ version: 1, site: { repo: 'owner/private-home' } }),
      },
    })
    expect(contextOf(await start($, REPO))).toContain('gh run list')
    const base = (c: any) => c.argv[0].split('/').pop()
    expect(w.calls.filter((c: any) => base(c) === 'curl' || c.argv.includes('ls-remote'))).toHaveLength(0)
    expect(w.ghCalls().filter((c: any) => c.argv.includes('run'))).toHaveLength(0)
  })
})

// The engine floor: the Claude Code release the kit's hooks are proved on, 2.1.328.
const belowFloor = (base: string) => `workkit: this Claude Code is ${base}; the kit's hooks need 2.1.328 or newer`
const OLDER_THAN = "workkit: this Claude Code is older than 2.1.328; the kit's hooks need 2.1.328 or newer"
// The floor lines a session start's additional context holds.
const floorLines = async ($: any) => contextOf(await start($, REPO)).split('\n').filter((l: string) => l.includes("the kit's hooks need"))

describe('classic.SessionStart: the engine floor (the Contract cases)', () => {
  test('28a. base 2.1.327: the context holds the line once, naming 2.1.327', async ($, on) => {
    mkWorld(on, { version: { version: '2.1.327', base: '2.1.327' } })
    expect(await floorLines($)).toEqual([belowFloor('2.1.327')])
  })

  test('a repo that never opted in, base 2.1.327: no floor line', async ($, on) => {
    mkWorld(on, { repos: { [REPO]: null }, standards: { state: 'undecided' }, version: { version: '2.1.327', base: '2.1.327' } })
    expect(await floorLines($)).toEqual([])
  })

  for (const base of ['2.1.328', '2.2.0']) {
    test(`28b. base ${base}: no floor line`, async ($, on) => {
      mkWorld(on, { version: { version: base, base } })
      expect(await floorLines($)).toEqual([])
    })
  }

  test('28c. base 2.1.99, below by number though above by text: the line', async ($, on) => {
    mkWorld(on, { version: { version: '2.1.99', base: '2.1.99' } })
    expect(await floorLines($)).toEqual([belowFloor('2.1.99')])
  })

  test('28d. base 2.1.300-dev: the line, naming the base as the engine gave it', async ($, on) => {
    mkWorld(on, { version: { version: '2.1.300-dev', base: '2.1.300-dev' } })
    expect(await floorLines($)).toEqual([belowFloor('2.1.300-dev')])
  })

  test('28d. base 2.1.328-dev: no floor line, the suffix dropped before comparing', async ($, on) => {
    mkWorld(on, { version: { version: '2.1.328-dev', base: '2.1.328-dev' } })
    expect(await floorLines($)).toEqual([])
  })

  test('28e. a build whose version call throws: the "older than" line', async ($, on) => {
    mkWorld(on, { versionFails: true })
    expect(await floorLines($)).toEqual([OLDER_THAN])
  })

  test('28f. an answer with no base: no floor line', async ($, on) => {
    mkWorld(on, { version: { version: '2.1.327' } })
    expect(await floorLines($)).toEqual([])
  })
})
