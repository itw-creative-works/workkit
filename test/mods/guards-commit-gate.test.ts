// tool.call Bash through the hooks module: safety:commit-gate first in the
// module's Bash chain, its facts gathered through git, npm and $.fs (the
// review marker under the workflow home, a stat), its denies, the heal pass, its
// stand-downs as the result's `context` plus one $.ui.log line, and the
// chain's .catch when it throws. The verdict's own cases are test/hooks/commit-gate/*.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, kitLogs, TOOL_SPY, REPO, HOME, bash, answered, denyOf } from '../lib/mod-world.ts'

const PREFIX = 'commit-gate: BLOCKED this commit: '
const NO_REVIEW = `${PREFIX}the commit contains code and no review has run. Run the workkit:review skill on the diff first (it records a marker), then commit.`
const STALE = `${PREFIX}the review marker predates the last commit. This commit's code has not been reviewed. Run the workkit:review skill again, then commit.`
const FIXES = `${PREFIX}the message closes an issue (Fixes/Closes/Resolves #N) but no CHANGELOG.md is staged. An issue closes against its CHANGELOG entry (docs/project-state.md): add the entry under [Unreleased], stage CHANGELOG.md, then commit.`
const NO_CODE = 'commit-gate: suite not run: the commit carries no code (docs-only or version-stamp-only).'

// The review marker for /w/repo under the workflow home: the folder plus the SHA-1 of the root.
const TMP = '/w/tmp'
const MARKER = `${HOME}/.workkit/markers/claude-review-marker/2d98e56dc36b7431b8f668bf4d7715c564698d73`

const verdicts = (w: any, hook: string) => hooksLog(w).filter((l: any) => l.hook === hook).map((l: any) => l.verdict)
const world = (on: any, opts: any = {}) => mkWorld(on, { env: { TMPDIR: TMP }, ...opts })

const pkg = (version: string, extra: any = {}) => `${JSON.stringify({ name: 'fixture', version, scripts: { test: 'exit 1' }, ...extra }, null, 2)}\n`

describe('tool.call Bash: safety:commit-gate', () => {
  test('ports "loader routes safety:commit-gate to the script (colon spelling)": commit-gate runs first, denies, and no later guard runs', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, { files: { [`${REPO}/app.js`]: 'const x = 1;\n' }, git: { staged: ['app.js'], added: ['app.js'] } })
    await bash($, 'git commit -m "kill the server"')
    expect(denyOf(w)).toBe(NO_REVIEW)
    expect(w.toolRan).toBeUndefined()
    expect(verdicts(w, 'safety:commit-gate')).toEqual(['run'])
    for (const hook of ['safety:commit-language', 'safety:release-taken', 'safety:tree-guard']) expect(verdicts(w, hook)).not.toContain('run')
  })

  test('the chain order: safety:commit-gate logs the first line of a plain command\'s fires', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on)
    await bash($, 'ls')
    expect(hooksLog(w)[0]?.hook).toBe('safety:commit-gate')
    expect(verdicts(w, 'safety:commit-gate')).toEqual(['run'])
    expect(w.toolRan?.command).toBe('ls')
  })

  test('given a review marker older than the newest staged code file: the stale-marker deny', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, {
      files: { [`${REPO}/app.js`]: 'const x = 1;\n', [MARKER]: '' },
      git: { staged: ['app.js'] },
    })
    w.mtimes.set(MARKER, w.now - 3600e3)
    w.mtimes.set(`${REPO}/app.js`, w.now - 120e3)
    await bash($, 'git commit -m "feat: thing"')
    expect(denyOf(w)).toBe(STALE)
    expect(w.toolRan).toBeUndefined()
  })

  test('given Fixes #N with no CHANGELOG staged: that deny', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, {
      files: { [`${REPO}/app.js`]: 'const x = 1;\n', [`${REPO}/CHANGELOG.md`]: '# Changelog\n\n## [Unreleased]\n', [MARKER]: '' },
      git: { staged: ['app.js'] },
    })
    w.mtimes.set(MARKER, w.now)
    await bash($, 'git commit -m "feat: a thing\n\nFixes #4"')
    expect(denyOf(w)).toBe(FIXES)
  })

  test('given a version-only bump with lockstep pins: the heal passes, its stand-down the result\'s context and one $.ui.log line', { plugins: [TOOL_SPY] }, async ($, on) => {
    const next = pkg('1.0.1', { dependencies: { '@fixture/other': '1.0.1', lodash: '^4.0.0' } })
    const w = world(on, {
      files: { [`${REPO}/package.json`]: next },
      git: {
        staged: ['package.json'],
        blobs: { 'HEAD:package.json': pkg('1.0.0', { dependencies: { '@fixture/other': '1.0.0', lodash: '^4.0.0' } }), ':package.json': next },
      },
    })
    await bash($, 'git commit -m "chore(release): 1.0.1"')
    const r = answered(w)
    expect(r?.deny).toBeUndefined()
    expect(w.toolRan?.command).toBe('git commit -m "chore(release): 1.0.1"')
    expect((r?.context || []).join('\n')).toContain(NO_CODE)
    const logged = kitLogs(w)
    expect(logged).toHaveLength(1)
    expect(logged[0]).toContain(NO_CODE)
  })

  test('ports "version stamp alone, no marker: exit 0": the heal\'s settings stamp passes', { plugins: [TOOL_SPY] }, async ($, on) => {
    const stamp = '{ "version": 7, "enabled": true }\n'
    const w = world(on, {
      repos: { [REPO]: stamp },
      git: { staged: ['.workkit/settings.json'], blobs: { 'HEAD:.workkit/settings.json': '{ "version": 6, "enabled": true }\n', ':.workkit/settings.json': stamp } },
    })
    await bash($, 'git commit -m "chore(workflow): stamp"')
    expect(answered(w)?.deny).toBeUndefined()
    expect(w.toolRan?.command).toBe('git commit -m "chore(workflow): stamp"')
  })
})

describe('tool.call Bash: commit-gate fails closed', () => {
  test('given the gate throwing on a read that answers nothing: the call is denied ending with the kind, and the hooks log holds crashed', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, { git: { broken: true } })
    await bash($, 'git commit -m "feat: thing"')
    const deny = answered(w)?.deny
    expect(typeof deny).toBe('string')
    expect(deny.endsWith('throw')).toBe(true)
    expect(w.toolRan).toBeUndefined()
    expect(verdicts(w, 'safety:commit-gate')).toEqual(['crashed'])
  })
})
