// classic.SessionStart through the hooks module: the session's PATH gets the kit's git shim folder
// (workflow/gitshim) first through $.env.set, on every source, so only a Claude session's shell sees the shim.
// The PATH rule's own cases are test/hooks/markers.test.js (sessionPath); the shim itself is
// test/scripts/gitshim.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, REPO, SID } from '../lib/mod-world.ts'

// The kit is the plugin these suites run, two folders above this one.
const KIT = import.meta.dir.replace(/[\\/]test[\\/]mods$/, '')
const SHIM = `${KIT}/workflow/gitshim`
const BASE = '/usr/bin:/bin'

const start = ($: any, source = 'startup') => $.classic.SessionStart({ source, session_id: SID, cwd: REPO })
const pathSets = (w: any) => w.envSets.filter((s: any) => s.name === 'PATH').map((s: any) => s.value)

describe('classic.SessionStart: the session PATH', () => {
  test('a session start with the shim folder absent from PATH: PATH starts with the folder, on every source', async ($, on) => {
    const w = mkWorld(on, { env: { PATH: BASE } })
    for (const source of ['startup', 'resume', 'compact', 'clear']) await start($, source)
    const sets = pathSets(w)
    expect(sets).toHaveLength(4)
    for (const value of sets) expect(value).toBe(`${SHIM}:${BASE}`)
  })

  test('a second start in the same session, PATH already starting with the folder: PATH is unchanged', async ($, on) => {
    const current = `${SHIM}:${BASE}`
    const w = mkWorld(on, { env: { PATH: current } })
    await start($, 'resume')
    for (const value of pathSets(w)) expect(value).toBe(current)
    expect(w.env.PATH).toBe(current)
  })

  test('given HOOK_DISABLE=1, a session start leaves PATH unchanged', async ($, on) => {
    const w = mkWorld(on, { env: { PATH: BASE, HOOK_DISABLE: '1' } })
    await start($)
    expect(pathSets(w)).toEqual([])
    expect(w.env.PATH).toBe(BASE)
  })
})
