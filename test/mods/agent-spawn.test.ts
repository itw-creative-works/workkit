// agent.spawn through the hooks module: manager:resolver supplies a crew
// spawn's model from the ladder, the class and the session cap read off
// e.parentModel, passes everything else on, and refuses in advise mode.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, LADDER, DEFAULTS, HOME, REPO, PLAIN, MODELS, OPTED_IN } from '../lib/mod-world.ts'

const FAST = LADDER.ladder[DEFAULTS.manager.tiers.fast as keyof typeof LADDER.ladder]
const settings = (manager: unknown) => JSON.stringify({ version: 1, enabled: true, manager })

const spawn = ($: any, subagentType: string, extra: any = {}) => $.agent.spawn({
  tool_use_id: 'toolu_1',
  prompt: 'do the thing',
  description: 'a task',
  subagentType,
  parentModel: MODELS.fable,
  background: false,
  fork: false,
  ...extra,
})

describe('agent.spawn: the Contract cases', () => {
  test('workkit:worker with no model under a sonnet parent gets the sonnet alias (the session cap)', async ($, on) => {
    const w = mkWorld(on)
    await spawn($, 'workkit:worker', { parentModel: MODELS.sonnet })
    expect(w.spawned).toHaveLength(1)
    expect(w.spawned[0].model).toBe('sonnet')
    expect(hooksLog(w).some((l: any) => l.hook === 'manager:resolver' && l.verdict === 'run')).toBe(true)
  })

  test('workkit:scout under a fable parent gets the fast tier alias', async ($, on) => {
    const w = mkWorld(on)
    await spawn($, 'workkit:scout', { parentModel: MODELS.fable })
    expect(w.spawned[0].model).toBe(FAST)
  })

  test('a spawn already carrying a model passes on unchanged', async ($, on) => {
    const w = mkWorld(on)
    await spawn($, 'workkit:worker', { model: 'haiku' })
    expect(w.spawned[0].model).toBe('haiku')
  })

  test('mode advise refuses a class spawn with the re-issue text naming the model and the class', async ($, on) => {
    const w = mkWorld(on, { files: { [`${HOME}/.workkit/settings.json`]: settings({ mode: 'advise' }) } })
    const r = await spawn($, 'workkit:scout')
    expect(typeof r.deny).toBe('string')
    expect(r.deny).toContain(FAST)
    expect(r.deny).toContain('scout')
    expect(w.spawned).toHaveLength(0)
  })
})

describe('agent.spawn: pass-through (manager-resolver suite)', () => {
  test('updatedInput preserves prompt and subagent_type, and allows', async ($, on) => {
    const w = mkWorld(on)
    const r = await spawn($, 'workkit:scout')
    expect(r.deny).toBeUndefined()
    expect(w.spawned[0].prompt).toBe('do the thing')
  })

  for (const type of ['Explore']) {
    test(`subagent_type ${type} spawns untouched`, async ($, on) => {
      const w = mkWorld(on)
      await spawn($, type)
      expect(w.spawned[0].model).toBeUndefined()
    })
  }

  test('missing ladder file fails open', async ($, on) => {
    const w = mkWorld(on)
    w.touchKit('hooks/manager/resources/ladder.json', null)
    await spawn($, 'workkit:worker')
    expect(w.spawned).toHaveLength(1)
    expect(w.spawned[0].model).toBeUndefined()
  })

  test('unparseable ladder fails open', async ($, on) => {
    const w = mkWorld(on, { kit: { 'hooks/manager/resources/ladder.json': 'not json {' } })
    await spawn($, 'workkit:worker')
    expect(w.spawned[0].model).toBeUndefined()
  })

  test('HOOK_DISABLE=1 is a silent no-op', async ($, on) => {
    const w = mkWorld(on, { env: { HOOK_DISABLE: '1' } })
    await spawn($, 'workkit:worker')
    expect(w.spawned[0].model).toBeUndefined()
  })
})

describe('agent.spawn: advise mode (manager-resolver suite)', () => {
  const advise = { [`${HOME}/.workkit/settings.json`]: settings({ mode: 'advise' }) }

  test('class spawn with the WRONG model blocks', async ($, on) => {
    const w = mkWorld(on, { files: advise })
    const r = await spawn($, 'workkit:scout', { model: 'opus' })
    expect(typeof r.deny).toBe('string')
    expect(w.spawned).toHaveLength(0)
  })

  test('class spawn already carrying the resolved model allows silently', async ($, on) => {
    const w = mkWorld(on, { files: advise })
    const r = await spawn($, 'workkit:scout', { model: FAST })
    expect(r.deny).toBeUndefined()
    expect(w.spawned[0].model).toBe(FAST)
  })

  test('non-class spawns still pass through in advise mode', async ($, on) => {
    const w = mkWorld(on, { files: advise })
    const r = await spawn($, 'Explore')
    expect(r.deny).toBeUndefined()
    expect(w.spawned[0].model).toBeUndefined()
  })

  test('a repo mode override switches the resolver to advise', async ($, on) => {
    const w = mkWorld(on, { repos: { [REPO]: settings({ mode: 'advise' }) } })
    const r = await spawn($, 'workkit:scout')
    expect(r.deny).toContain(FAST)
    expect(w.spawned).toHaveLength(0)
  })
})

describe('agent.spawn: the layers read off disk (manager-resolver suite)', () => {
  test('a repo tiers override moves the worker rung (git-resolved root)', async ($, on) => {
    const w = mkWorld(on, { repos: { [REPO]: settings({ tiers: { workhorse: 'sonnet' } }) } })
    await spawn($, 'workkit:worker')
    expect(w.spawned[0].model).toBe('sonnet')
  })

  test('a subdirectory cwd resolves to the repo root', async ($, on) => {
    const w = mkWorld(on, { repos: { [REPO]: settings({ tiers: { workhorse: 'sonnet' } }) }, cwd: `${REPO}/src/deep` })
    await spawn($, 'workkit:worker')
    expect(w.spawned[0].model).toBe('sonnet')
  })

  test('a plain (non-git) cwd carries no repo layer: outside a repo the resolver stands down', async ($, on) => {
    const w = mkWorld(on, { cwd: PLAIN, files: { [`${PLAIN}/.workkit/settings.json`]: settings({ tiers: { workhorse: 'haiku' } }) } })
    await spawn($, 'workkit:worker')
    expect(w.spawned[0].model).toBeUndefined()
    expect(hooksLog(w).some((l: any) => l.hook === 'manager:resolver' && l.verdict === 'stood-down')).toBe(true)
  })

  test('the user layer applies when the repo carries no settings', async ($, on) => {
    const w = mkWorld(on, { files: { [`${HOME}/.workkit/settings.json`]: settings({ tiers: { workhorse: 'haiku' } }) } })
    await spawn($, 'workkit:worker')
    expect(w.spawned[0].model).toBe('haiku')
  })

  test('with no MANAGER_USER_SETTINGS the user layer is the machine folder, WORKFLOW_HOME first', async ($, on) => {
    const w = mkWorld(on, {
      env: { WORKFLOW_HOME: '/w/wh' },
      files: {
        '/w/wh/settings.json': settings({ tiers: { workhorse: 'haiku' } }),
        [`${HOME}/.workkit/settings.json`]: settings({ tiers: { workhorse: 'sonnet' } }),
      },
    })
    await spawn($, 'workkit:worker')
    expect(w.spawned[0].model).toBe('haiku')
  })

  test('the repo layer beats the user layer', async ($, on) => {
    const w = mkWorld(on, {
      repos: { [REPO]: settings({ tiers: { workhorse: 'sonnet' } }) },
      files: { [`${HOME}/.workkit/settings.json`]: settings({ tiers: { workhorse: 'haiku' } }) },
    })
    await spawn($, 'workkit:worker')
    expect(w.spawned[0].model).toBe('sonnet')
  })

  test('enabled: false passes a class spawn through untouched', async ($, on) => {
    const w = mkWorld(on, { repos: { [REPO]: settings({ enabled: false }) } })
    await spawn($, 'workkit:worker')
    expect(w.spawned[0].model).toBeUndefined()
  })

  test('enabled: false in the user layer is overridable by the repo', async ($, on) => {
    const w = mkWorld(on, {
      repos: { [REPO]: settings({ enabled: true }) },
      files: { [`${HOME}/.workkit/settings.json`]: settings({ enabled: false }) },
    })
    await spawn($, 'workkit:worker')
    expect(w.spawned[0].model).toBe('opus')
  })

  test('unparseable repo settings decline the repo: the resolver stands down and the spawn passes through untouched', async ($, on) => {
    const w = mkWorld(on, { repos: { [REPO]: 'not json {' } })
    await spawn($, 'workkit:worker')
    expect(w.spawned[0].model).toBeUndefined()
  })

  test('settings without a manager block contribute nothing', async ($, on) => {
    const w = mkWorld(on, { repos: { [REPO]: OPTED_IN } })
    await spawn($, 'workkit:worker')
    expect(w.spawned[0].model).toBe('opus')
  })

  test('a user settings file with a severed tail still lets the repo layer win', async ($, on) => {
    const user = `${settings({ tiers: { workhorse: 'haiku' } })}{`
    const w = mkWorld(on, {
      repos: { [REPO]: settings({ tiers: { workhorse: 'sonnet' } }) },
      files: { [`${HOME}/.workkit/settings.json`]: user },
    })
    await spawn($, 'workkit:worker')
    expect(w.spawned[0].model).toBe('sonnet')
  })
})
