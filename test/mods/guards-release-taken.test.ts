// tool.call Bash through the hooks module: safety:release-taken in the module's
// Bash chain, its providers run as `npm view` and `gh release view` through
// $.process.run, the slug read off the origin through git, and the stand-downs
// as `context`.
// The verdict's own cases are test/hooks/release-taken/*.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, kitLogs, TOOL_SPY, REPO, bash, answered, denyOf } from '../lib/mod-world.ts'

const PKG = JSON.stringify({ name: 'widget', version: '1.2.3', private: false, files: ['dist'] })
const RELEASE = 'git commit -m "chore(release): 1.2.3"'
const TAKEN = (what: string, hit: string) => `release-taken: BLOCKED ${what}: ${hit}`

// The deny's lines; above its last line, and that line, the override every bounce ends on.
const bounceOf = (w: any) => denyOf(w)?.split('\n') ?? null
const hitsOf = (w: any) => bounceOf(w)?.slice(0, -1).join('\n') ?? null
const overrideOf = (w: any) => bounceOf(w)?.at(-1) ?? null
const world = (on: any, opts: any = {}) => mkWorld(on, { files: { [`${REPO}/package.json`]: PKG }, ...opts })
const calls = (w: any, tool: string, sub: string) => w.calls.filter((c: any) => c.argv[0].split('/').pop() === tool && c.argv[1] === sub)

describe('tool.call Bash: safety:release-taken', () => {
  test('ports "a version npm already has bounces, naming the provider and the pair": asked at the root, 15 seconds at most', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, { npm: { taken: ['widget@1.2.3'], known: [] } })
    await bash($, RELEASE)
    expect(hitsOf(w)).toBe(TAKEN('this release commit', 'npm already has widget@1.2.3'))
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

  test('ports "a tag the repo already carries bounces, naming the release and the repo": the slug off the origin', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, { releases: { tags: ['v1.2.3'] }, origins: { [REPO]: 'https://github.com/acme/widgets.git' } })
    await bash($, RELEASE)
    expect(hitsOf(w)).toBe(TAKEN('this release commit', 'github-release already has v1.2.3 at acme/widgets'))
    const gh = calls(w, 'gh', 'release')
    expect(gh).toHaveLength(1)
    expect(gh[0].argv).toContain('v1.2.3')
    expect(gh[0].init.timeoutMs).toBe(15000)
  })

  test('ports "a provider that cannot tell stands down out loud, and the commit stands": the lines in context, one $.ui.log line', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, { npm: 'offline', releases: 'offline' })
    await bash($, RELEASE)
    const r = answered(w)
    expect(r?.deny).toBeUndefined()
    expect(w.toolRan?.command).toBe(RELEASE)
    const said = (r?.context || []).join('\n')
    expect(said).toContain('release-taken: the npm check stood down for widget@1.2.3: npm error code ENOTFOUND request to https://registry.npmjs.org failed')
    expect(said).toContain('release-taken: the github-release check stood down for v1.2.3: gh: To get started with GitHub CLI, please run: gh auth login')
    expect(kitLogs(w)).toHaveLength(1)
  })
})
