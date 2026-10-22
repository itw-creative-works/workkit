// classic.UserPromptSubmit through the hooks module: manager:profile,
// workflow:reload-guard, docs:checkpoint and workflow:feature, the opt-in
// gate and its log verdicts, and the per-session markers kept in $.store.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, contextOf, REPO, SID, MODELS, OPTED_OUT } from '../lib/mod-world.ts'

const prompt = ($: any, text: string | undefined, extra: any = {}) => $.classic.UserPromptSubmit({
  ...(text === undefined ? {} : { prompt: text }), session_id: SID, cwd: REPO, ...extra,
})
const sessionStart = ($: any, extra: any = {}) => $.classic.SessionStart({ source: 'startup', session_id: SID, cwd: REPO, ...extra })
const GATED = ['manager:profile', 'docs:checkpoint', 'workflow:feature']
const BOTH = 'compact the chat, then work on #12'
const LINE = '[Issue work detected (#374): load the workkit:feature skill before working the issue.]'
const noticed = (r: any) => contextOf(r).includes('/reload-plugins')

describe('classic.UserPromptSubmit: the Contract cases', () => {
  for (const [name, settings] of [['"enabled": false', OPTED_OUT], ['no .workkit/settings.json', null]] as const) {
    test(`a repo with ${name}: no handler adds context and the gated lines read stood-down`, async ($, on) => {
      const w = mkWorld(on, { model: MODELS.fable, repos: { [REPO]: settings } })
      const r = await prompt($, BOTH)
      expect(contextOf(r)).toBe('')
      for (const hook of GATED) {
        const lines = hooksLog(w).filter((l: any) => l.hook === hook)
        expect(lines).toHaveLength(1)
        expect(lines[0]).toMatchObject({ event: 'UserPromptSubmit', sid: SID, cwd: REPO, verdict: 'stood-down' })
      }
    })
  }

  test('an opted-in repo: the contexts arrive in the order profile, reload-guard, checkpoint, feature, each line reading run', async ($, on) => {
    const w = mkWorld(on, { model: MODELS.fable })
    await sessionStart($)
    w.touchKit('agents/scout.md', '# scout\n')
    const text = contextOf(await prompt($, BOTH))
    const at = [
      text.indexOf('MANAGER'),
      text.indexOf('/reload-plugins'),
      text.indexOf('workkit:checkpoint skill'),
      text.indexOf('load the workkit:feature skill'),
    ]
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    for (const hook of [...GATED, 'workflow:reload-guard']) {
      const lines = hooksLog(w).filter((l: any) => l.hook === hook && l.event === 'UserPromptSubmit')
      expect(lines).toHaveLength(1)
      expect(lines[0].verdict).toBe('run')
    }
  })

  test('HOOK_DISABLE=1 makes every handler pass the prompt on (manager-profile "HOOK_DISABLE=1 is a silent no-op")', async ($, on) => {
    mkWorld(on, { model: MODELS.fable, env: { HOOK_DISABLE: '1' } })
    expect(contextOf(await prompt($, BOTH))).toBe('')
  })
})

describe('classic.UserPromptSubmit: manager:profile (manager-profile suite)', () => {
  test('ports "transcript fallback drives the tier too": the tier now comes from $.session.model()', async ($, on) => {
    mkWorld(on, { model: MODELS.haiku })
    expect(contextOf(await prompt($, 'hello'))).not.toContain('MANAGER')
  })
})

describe('classic.UserPromptSubmit: docs:checkpoint markers (checkpoint suite)', () => {
  const full = 'run the workkit:checkpoint skill before anything else'

  test('ports "the first fire writes the marker and asks for the full pass"', async ($, on) => {
    const w = mkWorld(on)
    await prompt($, 'hello')
    const before = w.sessionKeys(SID).length
    const ctx = contextOf(await prompt($, 'lets compact'))
    expect(ctx).toContain(full)
    expect(ctx).not.toContain('already issued')
    expect(w.sessionKeys(SID).length).toBeGreaterThan(before)
  })

  test('ports "the second fire in the same session asks for a delta, naming the time"', async ($, on) => {
    mkWorld(on)
    await prompt($, 'compact')
    const ctx = contextOf(await prompt($, 'compact'))
    expect(ctx).toMatch(/already issued this session at \d\d:\d\d\./)
    expect(ctx).toContain('delta')
  })

  test('ports "two session ids do not share a marker"', async ($, on) => {
    mkWorld(on)
    await prompt($, 'compact', { session_id: 'sess-1' })
    expect(contextOf(await prompt($, 'compact', { session_id: 'sess-2' }))).toContain(full)
  })

  test('ports "an empty session id fires the full line and writes no marker"', async ($, on) => {
    const w = mkWorld(on)
    expect(contextOf(await prompt($, 'compact', { session_id: '' }))).toContain(full)
    expect(contextOf(await prompt($, 'compact', { session_id: '' }))).toContain(full)
    expect([...w.store.keys()].some((k: string) => k.startsWith('workkit::'))).toBe(false)
  })

  test('ports "silent on <unrelated prompt>": a silent run writes no marker', async ($, on) => {
    const w = mkWorld(on, { model: MODELS.haiku })
    await prompt($, 'hello')
    const before = [...w.store.keys()].sort().join(',')
    expect(contextOf(await prompt($, 'ship the release when CI is green'))).toBe('')
    expect([...w.store.keys()].sort().join(',')).toBe(before)
  })

  test('ports "a payload with no prompt key is silent" (checkpoint and feature)', async ($, on) => {
    mkWorld(on)
    const ctx = contextOf(await prompt($, undefined))
    expect(ctx).not.toContain('workkit:checkpoint')
    expect(ctx).not.toContain('workkit:feature')
  })
})

describe('classic.UserPromptSubmit: workflow:feature markers (workflow-feature suite)', () => {
  const feature = (r: any) => (r.additionalContext || []).filter((c: string) => c.includes('Issue work detected'))

  test('ports "a bare number fires and leaves no marker"', async ($, on) => {
    mkWorld(on)
    expect(feature(await prompt($, 'port 8080'))).toEqual([LINE])
    expect(feature(await prompt($, 'continue'))).toEqual([LINE])
  })

  test('ports "a bare number then a strong line in one session fires twice"', async ($, on) => {
    mkWorld(on)
    expect(feature(await prompt($, 'port 8080'))).toEqual([LINE])
    expect(feature(await prompt($, 'work on #374'))).toEqual([LINE])
    expect(feature(await prompt($, 'continue'))).toEqual([])
  })

  test('ports "an issue number with `#` is strong on its own: it writes the marker"', async ($, on) => {
    mkWorld(on)
    expect(feature(await prompt($, '#42'))).toEqual([LINE])
    expect(feature(await prompt($, 'work on #43'))).toEqual([])
  })

  test('ports "a task notification holding "work on #12" prints nothing; the owner\'s line fires"', async ($, on) => {
    mkWorld(on)
    const notice = '<task-notification>\n<task-id>b1</task-id>\n<summary>the worker said: work on #12</summary>\n</task-notification>'
    expect(feature(await prompt($, notice))).toEqual([])
    expect(feature(await prompt($, 'work on #12'))).toEqual([LINE])
  })

  test('ports "the first fire writes one marker keyed by the session id" and "the second fire in the same session prints nothing"', async ($, on) => {
    mkWorld(on)
    expect(feature(await prompt($, 'work on #12'))).toEqual([LINE])
    expect(feature(await prompt($, 'continue'))).toEqual([])
  })

  test('ports "a different session id fires again"', async ($, on) => {
    mkWorld(on)
    await prompt($, 'work on #12', { session_id: 'sess-1' })
    expect(feature(await prompt($, 'work on #12', { session_id: 'sess-2' }))).toEqual([LINE])
  })

  test('ports "an empty session id fires the full line every time and writes no marker"', async ($, on) => {
    const w = mkWorld(on)
    for (let i = 0; i < 2; i++) expect(feature(await prompt($, 'work on #12', { session_id: '' }))).toEqual([LINE])
    expect([...w.store.keys()].some((k: string) => k.startsWith('workkit::'))).toBe(false)
  })
})

describe('classic.SessionStart + UserPromptSubmit: workflow:reload-guard (reload-guard suite)', () => {
  const stamped = async ($: any, on: any, opts: any = {}) => {
    const w = mkWorld(on, opts)
    await sessionStart($)
    return w
  }

  test('ports "SessionStart writes the stamp and says nothing"', async ($, on) => {
    const w = mkWorld(on)
    expect(contextOf(await sessionStart($))).toBe('')
    expect(w.sessionKeys(SID).length).toBeGreaterThan(0)
  })

  test('ports "a second SessionStart re-stamps the current state"', async ($, on) => {
    const w = await stamped($, on)
    w.touchKit('agents/worker.md')
    await sessionStart($)
    expect(noticed(await prompt($, 'hello'))).toBe(false)
  })

  test('ports "rewriting hooks.json with identical wiring is not a change"', async ($, on) => {
    const w = await stamped($, on)
    w.touchKit('hooks/hooks.json')
    expect(noticed(await prompt($, 'hello'))).toBe(false)
  })

  test('ports "editing an existing hook script is not a change: those edits are already live"', async ($, on) => {
    const w = await stamped($, on, { kit: { 'hooks/docs/state-check/run.sh': '#!/bin/bash\nexit 0\n' } })
    w.touchKit('hooks/docs/state-check/run.sh', '#!/bin/bash\n# rewritten\nexit 0\n')
    expect(noticed(await prompt($, 'hello'))).toBe(false)
  })

  test('ports "rewired hooks.json: one notice, then silence"', async ($, on) => {
    const w = await stamped($, on)
    w.touchKit('hooks/hooks.json', JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'x' }] }] } }))
    const first = await prompt($, 'hello')
    expect(noticed(first)).toBe(true)
    expect(contextOf(first)).toContain('already live')
    expect(noticed(await prompt($, 'hello'))).toBe(false)
    expect(noticed(await prompt($, 'hello'))).toBe(false)
  })

  test('ports "a FURTHER change nags again"', async ($, on) => {
    const w = await stamped($, on)
    w.touchKit('hooks/hooks.json', '{ "hooks": { "Stop": [] } }\n')
    expect(noticed(await prompt($, 'hello'))).toBe(true)
    expect(noticed(await prompt($, 'hello'))).toBe(false)
    w.touchKit('hooks/hooks.json', '{ "hooks": { "Stop": [], "PreToolUse": [] } }\n')
    expect(noticed(await prompt($, 'hello'))).toBe(true)
  })

  for (const [name, change] of [
    ['a new agent file is a change, even though it has no previous mtime', (w: any) => w.touchKit('agents/scout.md', '# scout\n')],
    ['a new skill directory is a change', (w: any) => w.touchKit('skills/triage/SKILL.md', '# triage\n')],
    ['an edited agent file is a change', (w: any) => w.touchKit('agents/worker.md')],
    ['a removed agent file is a change', (w: any) => w.touchKit('agents/worker.md', null)],
  ] as const) {
    test(`ports "${name}"`, async ($, on) => {
      const w = await stamped($, on)
      change(w)
      expect(noticed(await prompt($, 'hello'))).toBe(true)
    })
  }

  // The module's files at any depth are load-time surfaces, a mods subfolder's included.
  for (const rel of ['hooks/mods/commit-gate/checks.js', 'hooks/mods/change-tracker/prompt.md']) {
    test(`an edited ${rel} triggers the reload notice`, async ($, on) => {
      const w = await stamped($, on, { kit: { [rel]: '// one\n' } })
      w.touchKit(rel, '// two\n')
      expect(noticed(await prompt($, 'hello'))).toBe(true)
    })
  }

  test('ports "a second session started after the change is current, and hears nothing"', async ($, on) => {
    const w = await stamped($, on)
    w.touchKit('agents/advisor.md', '# advisor\n')
    await sessionStart($, { session_id: 'sess-later' })
    expect(noticed(await prompt($, 'hello', { session_id: 'sess-later' }))).toBe(false)
    expect(noticed(await prompt($, 'hello'))).toBe(true)
  })

  test('ports "no stamp at all: re-stamped silently, no phantom change"', async ($, on) => {
    const w = mkWorld(on)
    expect(noticed(await prompt($, 'hello'))).toBe(false)
    expect(w.sessionKeys(SID).length).toBeGreaterThan(0)
    expect(noticed(await prompt($, 'hello'))).toBe(false)
  })

  test('ports "no session id: exit 0, and nothing is written"', async ($, on) => {
    const w = mkWorld(on)
    expect(noticed(await prompt($, 'hello', { session_id: '' }))).toBe(false)
    expect([...w.store.keys()].some((k: string) => k.startsWith('workkit::'))).toBe(false)
  })

  test('ports "a checkout missing every surface: exit 0, silent"', async ($, on) => {
    await stamped($, on, { kit: { 'hooks/hooks.json': null, 'agents/worker.md': null, 'skills/ship/SKILL.md': null } })
    expect(noticed(await prompt($, 'hello'))).toBe(false)
  })

  test('ports "HOOK_DISABLE=1 silences it entirely"', async ($, on) => {
    const w = mkWorld(on, { env: { HOOK_DISABLE: '1' } })
    await sessionStart($)
    w.touchKit('agents/scout.md', '# scout\n')
    expect(contextOf(await prompt($, 'hello'))).toBe('')
  })
})
