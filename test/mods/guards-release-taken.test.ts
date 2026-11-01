// tool.call Bash through the hooks module: safety:release-taken's publish half in
// the module's Bash chain, its provider run as `npm view` through $.process.run,
// and the stand-down as `context`. The release commit is judged in commit-msg.
// The verdict's own cases are test/hooks/release-taken/*.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, kitLogs, TOOL_SPY, REPO, bash, answered, denyOf } from '../lib/mod-world.ts'

const PKG = JSON.stringify({ name: 'widget', version: '1.2.3', private: false, files: ['dist'] })
const PUBLISH = 'npm publish'
const TAKEN = (what: string, hit: string) => `release-taken: BLOCKED ${what}: ${hit}`

// The deny's lines; above its last line, and that line, the override every bounce ends on.
const bounceOf = (w: any) => denyOf(w)?.split('\n') ?? null
const hitsOf = (w: any) => bounceOf(w)?.slice(0, -1).join('\n') ?? null
const overrideOf = (w: any) => bounceOf(w)?.at(-1) ?? null
const world = (on: any, opts: any = {}) => mkWorld(on, { files: { [`${REPO}/package.json`]: PKG }, ...opts })
const calls = (w: any, tool: string, sub: string) => w.calls.filter((c: any) => c.argv[0].split('/').pop() === tool && c.argv[1] === sub)

describe('tool.call Bash: safety:release-taken', () => {
  test('a version npm already has bounces, naming the provider and the pair: asked at the root, 15 seconds at most', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, { npm: { taken: ['widget@1.2.3'], known: [] } })
    await bash($, PUBLISH)
    expect(hitsOf(w)).toBe(TAKEN('this npm publish', 'npm already has widget@1.2.3'))
    expect(overrideOf(w)).toContain('HOOK_DISABLE=1')
    expect(overrideOf(w)).not.toContain('loader kill switch')
    expect(overrideOf(w)).not.toMatch(/loader/i)
    expect(w.toolRan).toBeUndefined()
    const npm = calls(w, 'npm', 'view')
    expect(npm).toHaveLength(1)
    expect(npm[0].argv).toContain('widget@1.2.3')
    expect(npm[0].init.cwd).toBe(REPO)
    expect(npm[0].init.timeoutMs).toBe(15000)
    expect(hooksLog(w).filter((l: any) => l.hook === 'safety:release-taken').map((l: any) => l.verdict)).toEqual(['run'])
  })

  test('a provider that cannot tell stands down out loud, and the commit stands: the publish stands: the line in context, one $.ui.log line', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, { npm: 'offline' })
    await bash($, PUBLISH)
    const r = answered(w)
    expect(r?.deny).toBeUndefined()
    expect(w.toolRan?.command).toBe(PUBLISH)
    const said = (r?.context || []).join('\n')
    expect(said).toContain('release-taken: the npm check stood down for widget@1.2.3: npm error code ENOTFOUND request to https://registry.npmjs.org failed')
    expect(kitLogs(w)).toHaveLength(1)
  })
})
