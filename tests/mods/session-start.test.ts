// classic.SessionStart through the hooks module: docs:state-check, then
// workflow:standards, then workflow:reload-guard's stamp, then docs:session. The
// state-check cache and the standards daily marker are files under ~/.claude/logs.

import { test, expect, describe } from 'claude-code/testing'
import {
  mkWorld, contextOf, hooksLog, HOME, REPO, PLAIN, SID, OPTED_OUT, SESSION_NOW as NOW, daysBefore, briefMarker,
} from '../lib/mod-world.ts'

const start = ($: any, cwd: string, extra: any = {}) => $.classic.SessionStart({ source: 'startup', session_id: SID, cwd, ...extra })
const HEAL = { exitCode: 0, stdout: '', stderr: '  ✓ issue forms: installed\n  ✓ gitignore: added .workkit/*\n' }
// A heal is the engine run with no mode flag (--state and --announce only read).
const heals = (w: any) => w.runs('standards.sh').filter((c: any) => !c.argv.some((a: string) => a.startsWith('--')))
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
    expect(r.additionalContext[0]).toContain('workkit.sh setup')
    expect(w.sessionKeys(SID).length).toBeGreaterThan(0)
    expect(w.ghCalls()).toHaveLength(0)
  })
})

describe('classic.SessionStart: docs:state-check (state-check suite)', () => {
  test('ports "bare directory: silent exit 0" and "non-git directory: gh is never called"', async ($, on) => {
    const w = mkWorld(on, { gh: { issues: [{ number: 1 }] }, standards: { state: 'nogit' } })
    expect(contextOf(await start($, PLAIN))).toBe('')
    expect(w.ghCalls()).toHaveLength(0)
  })

  test('ports "a repo with no inbox issues: silent"', async ($, on) => {
    mkWorld(on, { gh: { issues: [] } })
    expect(contextOf(await start($, REPO))).toBe('')
  })

  test('ports "the query is read-only, open, and label-scoped"', async ($, on) => {
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

  test('ports "no gh on PATH: silent skip, everything else still checked"', async ($, on) => {
    mkWorld(on, { gh: 'absent', files: { [`${REPO}/CLAUDE.md`]: '# Big Doc\n\nrules\nmore rules\nand more\n' } })
    const ctx = contextOf(await start($, REPO))
    expect(ctx).not.toContain('status:inbox')
    expect(ctx).toContain('git mv CLAUDE.md AGENTS.md')
  })

  test('ports "gh failing (offline / unauthenticated): silent skip"', async ($, on) => {
    mkWorld(on, { gh: 'offline' })
    expect(contextOf(await start($, REPO))).toBe('')
  })

  test('ports "output is valid JSON when announcing": the count arrives as one context entry', async ($, on) => {
    mkWorld(on, { gh: { issues: [{ number: 9 }] } })
    const r = await start($, REPO)
    expect(r.additionalContext.some((c: string) => c.includes('1 open status:inbox issue.'))).toBe(true)
  })

  test("ports \"a PROGRESS.md is no longer the hook's business\"", async ($, on) => {
    mkWorld(on, { files: { [`${REPO}/PROGRESS.md`]: '# Project Progress Tracker\n\n## Current Focus\n* stuff\n' } })
    expect(contextOf(await start($, REPO))).toBe('')
  })

  test('ports "an INBOX.md is no longer counted"', async ($, on) => {
    mkWorld(on, { files: { [`${REPO}/INBOX.md`]: '# INBOX\n\nfix the thing\nidea: new skill\n' } })
    expect(contextOf(await start($, REPO))).toBe('')
  })

  test('ports "the user-level ~/.claude/CLAUDE.md is out of scope: silent"', async ($, on) => {
    const claude = `${HOME}/.claude`
    mkWorld(on, { repos: { [claude]: '{ "version": 1, "enabled": true }\n' }, files: { [`${claude}/CLAUDE.md`]: '@AGENTS.md\n' } })
    expect(contextOf(await start($, claude))).not.toContain('CLAUDE.md')
  })

  test('ports "empty cwd in input: exit 0"', async ($, on) => {
    const w = mkWorld(on, { gh: { issues: [{ number: 1 }] }, standards: { state: 'nogit' } })
    expect(contextOf(await start($, ''))).not.toContain('status:inbox')
    expect(w.ghCalls()).toHaveLength(0)
  })

  test('ports "an empty queue is cached: a second session inside 30 minutes makes no gh call"', async ($, on) => {
    const w = mkWorld(on, { gh: { issues: [] } })
    expect(contextOf(await start($, REPO))).toBe('')
    expect(w.ghCalls()).toHaveLength(1)
    expect(contextOf(await start($, REPO, { session_id: 'sess-2' }))).toBe('')
    expect(w.ghCalls()).toHaveLength(1)
  })

  test('ports "a count worth announcing is never cached: the next session asks again"', async ($, on) => {
    const w = mkWorld(on, { gh: { issues: [{ number: 1 }, { number: 2 }] } })
    expect(contextOf(await start($, REPO))).toContain('2 open status:inbox')
    expect(contextOf(await start($, REPO, { session_id: 'sess-2' }))).toContain('2 open status:inbox')
    expect(w.ghCalls()).toHaveLength(2)
  })

  test('ports "triage drains the inbox and the very next session goes quiet"', async ($, on) => {
    const w = mkWorld(on, { gh: { issues: [{ number: 1 }, { number: 2 }] } })
    expect(contextOf(await start($, REPO))).toContain('2 open status:inbox')
    w.gh = { issues: [] }
    expect(contextOf(await start($, REPO, { session_id: 'sess-2' }))).toBe('')
  })

  test('ports "a cached silence older than 30 minutes re-queries"', async ($, on) => {
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
  test('ports "second session the same day: no re-run, no output"', async ($, on) => {
    const w = mkWorld(on, { standards: { heal: HEAL } })
    expect(contextOf(await start($, REPO))).toContain('issue forms')
    expect(contextOf(await start($, REPO, { session_id: 'sess-2' }))).toBe('')
    expect(heals(w)).toHaveLength(1)
  })

  test('ports "the marker is dated, one file per repo"', async ($, on) => {
    const other = '/w/other'
    const w = mkWorld(on, { repos: { [REPO]: '{ "enabled": true }', [other]: '{ "enabled": true }' }, standards: { heal: HEAL } })
    await start($, REPO)
    expect(markerPath(w)).toBeDefined()
    expect(contextOf(await start($, other, { session_id: 'sess-2' }))).toContain('issue forms')
    expect(heals(w)).toHaveLength(2)
  })

  test('ports "a stale marker re-arms the run"', async ($, on) => {
    const w = mkWorld(on, { standards: { heal: HEAL } })
    await start($, REPO)
    w.files.set(markerPath(w), '2000-01-01')
    expect(contextOf(await start($, REPO, { session_id: 'sess-2' }))).toContain('issue forms')
    expect(heals(w)).toHaveLength(2)
  })

  test('ports "no WORKFLOW_DIR: resolves the engine beside the hook and heals"', async ($, on) => {
    const w = mkWorld(on, { standards: { heal: HEAL } })
    await start($, REPO)
    const script = heals(w)[0].argv.find((a: string) => a.endsWith('standards.sh'))
    expect(script.endsWith('/workflow/standards.sh')).toBe(true)
    expect(script.startsWith('/w/')).toBe(false)
  })

  test('ports "a missing engine: says where it looked, exit 0"', async ($, on) => {
    const w = mkWorld(on, { standards: { heal: HEAL } })
    w.touchKit('workflow/standards.sh', null)
    const ctx = contextOf(await start($, REPO))
    expect(ctx).toMatch(/\/workflow\/standards\.sh/)
    expect(ctx).toContain('plugin')
    expect(heals(w)).toHaveLength(0)
  })

  test('ports "an engine without labels.json is announced for an opted-in repo"', async ($, on) => {
    const w = mkWorld(on, { standards: { heal: HEAL } })
    w.touchKit('workflow/labels.json', null)
    const ctx = contextOf(await start($, REPO))
    expect(ctx).toContain('labels.json')
    expect(ctx).toContain('plugin')
    expect(heals(w)).toHaveLength(0)
  })

  for (const [name, settings, rel] of [
    ['a missing manifest stays silent on a repo that never opted in', null, 'workflow/labels.json'],
    ['a missing engine stays silent on a repo that never opted in', null, 'workflow/standards.sh'],
    ['a missing engine stays silent on a deliberately disabled repo', OPTED_OUT, 'workflow/standards.sh'],
  ] as const) {
    test(`ports "${name}"`, async ($, on) => {
      const w = mkWorld(on, { repos: { [REPO]: settings }, standards: { state: settings ? 'disabled' : 'undecided' } })
      w.touchKit(rel, null)
      expect(contextOf(await start($, REPO))).toBe('')
    })
  }

  test('ports "non-git cwd: silent exit 0, creates nothing"', async ($, on) => {
    const w = mkWorld(on, { standards: { state: 'nogit', heal: HEAL } })
    expect(contextOf(await start($, PLAIN))).toBe('')
    expect(heals(w)).toHaveLength(0)
  })

  test('ports "empty cwd in input: exit 0" (standards)', async ($, on) => {
    const w = mkWorld(on, { standards: { state: 'nogit', heal: HEAL } })
    expect(contextOf(await start($, ''))).toBe('')
    expect(heals(w)).toHaveLength(0)
  })

  for (const [name, files] of [
    ['no .workkit/settings.json: offers to enable, writes nothing', {}],
    ['a .workkit/ directory without settings.json is not an opt-in', { [`${REPO}/.workkit/capture.md`]: '- a note\n' }],
    ['settings.json in a subdirectory does not opt the repo in', { [`${REPO}/packages/app/.workkit/settings.json`]: '{ "version": 1 }\n' }],
  ] as const) {
    test(`ports "${name}"`, async ($, on) => {
      const w = mkWorld(on, { repos: { [REPO]: null }, files, standards: { state: 'undecided', heal: HEAL } })
      const ctx = contextOf(await start($, REPO))
      expect(ctx).toContain('not in the issue workflow')
      expect(ctx).toContain('--enable')
      expect(ctx).toContain('--decline')
      expect(heals(w)).toHaveLength(0)
    })
  }

  for (const [name, state] of [['enabled: false: silent, and no offer either', 'disabled'], ['a declined repo is never mentioned again', 'declined']]) {
    test(`ports "${name}"`, async ($, on) => {
      const w = mkWorld(on, { repos: { [REPO]: state === 'disabled' ? OPTED_OUT : null }, standards: { state, heal: HEAL } })
      expect(contextOf(await start($, REPO))).toBe('')
      expect(heals(w)).toHaveLength(0)
    })
  }

  test('ports "the offer repeats every session: it is not daily-cached"', async ($, on) => {
    const w = mkWorld(on, { repos: { [REPO]: null }, standards: { state: 'undecided' } })
    expect(contextOf(await start($, REPO))).toContain('not in the issue workflow')
    expect(contextOf(await start($, REPO, { session_id: 'sess-2' }))).toContain('not in the issue workflow')
    expect(markerPath(w)).toBeUndefined()
  })

  test('ports "a subdirectory session resolves to the repo root"', async ($, on) => {
    const w = mkWorld(on, { standards: { heal: HEAL }, dirs: [`${REPO}/src/deep`] })
    await start($, `${REPO}/src/deep`)
    const run = heals(w)[0]
    expect(run.argv.includes(REPO) || run.init.cwd === REPO).toBe(true)
  })

  test('ports "a machine that never ran setup is told to, every session"', async ($, on) => {
    const w = mkWorld(on, { setup: false, standards: { heal: HEAL } })
    const first = contextOf(await start($, REPO))
    expect(first).toContain('SETUP:')
    expect(first).toContain('workkit.sh setup')
    expect(first).toContain('issue forms')
    const second = contextOf(await start($, REPO, { session_id: 'sess-2' }))
    expect(second).toContain('workkit.sh setup')
    expect(second).not.toContain('issue forms')
    expect(heals(w)).toHaveLength(1)
  })

  test('ports "a set-up machine hears nothing about setup"', async ($, on) => {
    mkWorld(on, { standards: { heal: HEAL } })
    expect(contextOf(await start($, REPO))).not.toContain('SETUP:')
    expect(contextOf(await start($, REPO, { session_id: 'sess-2' }))).toBe('')
  })

  test('ports "setup is a machine question: the pester reaches a non-git cwd too"', async ($, on) => {
    mkWorld(on, { setup: false, standards: { state: 'nogit' } })
    expect(contextOf(await start($, PLAIN))).toContain('workkit.sh setup')
  })

  test('ports "a declined repo still hears the setup pester and nothing else"', async ($, on) => {
    mkWorld(on, { setup: false, repos: { [REPO]: null }, standards: { state: 'declined' } })
    const ctx = contextOf(await start($, REPO))
    expect(ctx).toContain('workkit.sh setup')
    expect(ctx).not.toContain('not in the issue workflow')
  })

  test('ports "an engine anywhere else: the pester never mentions the plugin cache"', async ($, on) => {
    mkWorld(on, { setup: false })
    const line = contextOf(await start($, REPO)).split('\n').find((l: string) => l.startsWith('SETUP:')) || ''
    expect(line).toContain('workkit.sh setup')
    expect(line).toMatch(/setup` yourself/)
    expect(line).not.toMatch(/tell the user/i)
    expect(line).not.toContain('plugin cache')
  })

  test('ports "a machine with no schedule installed never gets one": the daily run calls workkit update --auto', async ($, on) => {
    const w = mkWorld(on)
    await start($, REPO)
    const update = w.runs('workkit.sh')
    expect(update).toHaveLength(1)
    expect(update[0].argv).toContain('update')
    expect(update[0].argv).toContain('--auto')
  })

  test('ports "an all-current machine stays silent"', async ($, on) => {
    mkWorld(on)
    expect(contextOf(await start($, REPO))).toBe('')
  })

  test('ports "a machine with no sign-in hears it at session start"', async ($, on) => {
    mkWorld(on, { standards: { update: { exitCode: 0, stdout: '', stderr: '  ⚠ identity: not signed in\n' } } })
    expect(contextOf(await start($, REPO))).toContain('identity: not signed in')
  })

  test("ports \"a repo's daily run corrects a schedule left by another checkout\": the upkeep line arrives with no indent and no glyph", async ($, on) => {
    mkWorld(on, { standards: { update: { exitCode: 0, stdout: '  ✓ schedule: re-rendered com.workkit.claude-daily\n', stderr: '' } } })
    const relayed = contextOf(await start($, REPO)).split('\n').find((l: string) => l.includes('schedule:'))
    expect(relayed).toMatch(/^schedule: /)
  })

  test('ports "no gh on PATH: local heals still reported, no failure": the heal runs under QUIET=1', async ($, on) => {
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
  test('ports "a compaction gets it too: every source, not just startup" and "hooks.json registers the hook under SessionStart, for every source"', async ($, on) => {
    mkWorld(on, { now: NOW, files: { [STATE]: filled(2) } })
    for (const source of ['startup', 'resume', 'clear', 'compact']) {
      expect(contextOf(await start($, REPO, { source }))).toContain('- #1: a queued entry.')
    }
  })

  test('ports "a session opened in a subdirectory finds the repo root"', async ($, on) => {
    mkWorld(on, { now: NOW, files: { [STATE]: filled(2) }, dirs: [`${REPO}/src/deep`] })
    expect(contextOf(await start($, `${REPO}/src/deep`))).toContain('- #1: a queued entry.')
  })

  test('ports "the owner hears it: the resume line rides the visible channel too"', async ($, on) => {
    const w = mkWorld(on, { now: NOW, files: { [STATE]: filled(2) } })
    await start($, REPO)
    expect(w.logs).toContain(CARRIED)
  })

  for (const [name, settings] of [
    ['a repo that never opted in: silent, even with content', null],
    ['a repo that turned the workflow off: silent', OPTED_OUT],
  ] as const) {
    test(`ports "${name}"`, async ($, on) => {
      const w = mkWorld(on, { now: NOW, repos: { [REPO]: settings }, standards: { state: settings ? 'disabled' : 'undecided' }, files: { [STATE]: filled(2) } })
      expect(contextOf(await start($, REPO))).not.toContain('SESSION STATE')
      expect(carried(w)).toHaveLength(0)
      expect(hooksLog(w).some((l: any) => l.hook === 'docs:session' && l.verdict === 'stood-down')).toBe(true)
    })
  }

  test('ports "a settings file in a cwd that is no git repo: silent"', async ($, on) => {
    const w = mkWorld(on, {
      now: NOW,
      standards: { state: 'nogit' },
      files: { [`${PLAIN}/.workkit/settings.json`]: '{ "version": 1, "site": {} }\n', [`${PLAIN}/.workkit/agents/session.md`]: filled(2) },
    })
    expect(contextOf(await start($, PLAIN))).not.toContain('SESSION STATE')
    expect(carried(w)).toHaveLength(0)
  })

  test('ports "no cwd in the payload: silent"', async ($, on) => {
    const w = mkWorld(on, { now: NOW, cwd: PLAIN, standards: { state: 'nogit' }, files: { [STATE]: filled(2) } })
    expect(contextOf(await start($, ''))).not.toContain('SESSION STATE')
    expect(carried(w)).toHaveLength(0)
  })

  test('ports "the marker is read from WORKFLOW_HOME, the folder the 9am job writes it to"', async ($, on) => {
    mkWorld(on, { now: NOW, env: { WORKFLOW_HOME: '/w/moved' }, files: { '/w/moved/brief-status.json': marker(10) } })
    expect(contextOf(await start($, REPO)).startsWith('cloud brief: last posted')).toBe(true)
  })

  test('ports "a marker that does not parse: silent"', async ($, on) => {
    mkWorld(on, { now: NOW, files: { [`${HOME}/.workkit/brief-status.json`]: '{ "version": 1, "lastBrief": ' } })
    expect(contextOf(await start($, REPO))).toBe('')
  })

  test('ports "a repo that never opted in hears nothing about the brief either"', async ($, on) => {
    mkWorld(on, { now: NOW, repos: { [REPO]: null }, standards: { state: 'undecided' }, files: { [`${HOME}/.workkit/brief-status.json`]: marker(9) } })
    expect(contextOf(await start($, REPO))).not.toContain('cloud brief')
  })

  test('ports "the hook reaches no network: the marker is the only source"', async ($, on) => {
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
