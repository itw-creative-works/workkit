// tool.call Edit/Write and Read/Grep through the hooks module: FILE_GUARDS on
// Edit and Write (safety:vendor-guard, then safety:capture-guard) and
// READ_GUARDS on Read and Grep (safety:capture-guard), the first deny ending
// the chain. The event is the tool's input with `tool`, no `cwd`: a relative
// path is the session's.
// The verdicts' own cases are tests/hooks/vendor-guard.test.js and capture-guard/.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, toolSpied, TOOL_SPY, REPO, HOME, OPTED_IN } from '../lib/mod-world.ts'

const NOW = 1800000000000
const TMPDIR = '/w/tmp'
const CAPTURE = `${REPO}/.workkit/capture.md`

const TAIL = 'Edit the SOURCE, not the output; a bug in a dependency gets fixed upstream, never patched in place.'
const VENDOR = (file: string, why: string) => `vendor-guard: BLOCKED edit to ${file}: ${why} ${TAIL}`
const NODE_MODULES = 'node_modules/ is installed output.'
const OUTPUT_DIR = 'a dist/ or build/ directly under a package root is generated output.'
const IGNORED = 'the file is gitignored: generated/runtime files are not hand-edited (designed exceptions: _attic/, .workkit/, .env*).'
const READ = "capture-guard: BLOCKED reading .workkit/capture.md: it is the owner's capture surface, and its contents are read only during a triage run.\nRun the workkit:triage skill, which records the marker this guard checks, and read it there. Counting the entries (wc -l) stays open."
const REWRITE = (route: string) => `capture-guard: BLOCKED rewriting .workkit/capture.md: its entries are cleared only by the triage drain, and no drain is running.\nRun the workkit:triage skill, which records the marker this guard checks, and clear it there. Adding entries is never the agent's at all: ${route}`
const ROUTE_OFF = 'say findings in chat under 🧭 Findings instead, one bullet each, for the owner to answer file or drop; file nothing on your own.'

const call = ($: any, tool: string, input: any) => $.tool.call({ tool, ...input } as any)
const writeFile = ($: any, file: string) => call($, 'Write', { file_path: file, content: 'x' })
const editFile = ($: any, file: string) => call($, 'Edit', { file_path: file, old_string: 'a', new_string: 'b' })
const readFile = ($: any, file: string) => call($, 'Read', { file_path: file })
const denyOf = (w: any, i = 0) => (typeof toolSpied(w)[i]?.deny === 'string' ? toolSpied(w)[i].deny.replace(/\n$/, '') : null)
const fired = (w: any, hook: string) => hooksLog(w).filter((l: any) => l.hook === hook).map((l: any) => l.verdict)

// A world with the clock fixed and the markers' TMPDIR.
const world = (on: any, opts: any = {}) => {
  const files = { [CAPTURE]: '# capture\n\n- a private thought\n', ...(opts.files || {}) }
  return mkWorld(on, { now: NOW, ...opts, env: { TMPDIR, ...(opts.env || {}) }, files })
}

describe('classic.PreToolUse Edit/Write: safety:vendor-guard, then safety:capture-guard', () => {
  test('given a Write to node_modules/x.js: the deny with vendor-guard\'s text, and capture-guard did not run', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on)
    await writeFile($, `${REPO}/node_modules/x.js`)
    expect(denyOf(w)).toBe(VENDOR(`${REPO}/node_modules/x.js`, NODE_MODULES))
    expect(w.toolRan).toBeUndefined()
    expect(fired(w, 'safety:vendor-guard')).toEqual(['run'])
    expect(fired(w, 'safety:capture-guard')).toEqual([])
  })

  test('ports "RELATIVE vendor paths blocked": a relative path is the session folder\'s', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on)
    await writeFile($, 'node_modules/foo/index.js')
    expect(denyOf(w)).toBe(VENDOR(`${REPO}/node_modules/foo/index.js`, NODE_MODULES))
  })

  test('ports "gitignored file in a repo: exit 2": git check-ignore asked in the file\'s repo', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, { ignored: [`${REPO}/generated.json`, `${REPO}/.env`] })
    await writeFile($, `${REPO}/generated.json`)
    expect(denyOf(w)).toBe(VENDOR(`${REPO}/generated.json`, IGNORED))
    expect(w.calls.some((c: any) => c.argv[0] === 'git' && c.argv.includes('check-ignore'))).toBe(true)
  })

  test('ports ".env is allowed even though gitignored" and "tracked file in a repo: exit 0"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, { ignored: [`${REPO}/generated.json`, `${REPO}/.env`] })
    await writeFile($, `${REPO}/.env`)
    await writeFile($, `${REPO}/src.js`)
    expect(denyOf(w, 0)).toBeNull()
    expect(denyOf(w, 1)).toBeNull()
    expect(w.toolRan?.file_path).toBe(`${REPO}/src.js`)
  })

  test('ports "src/test/suites/build/ is committed source" and "build/ at the repo root still bounces": the kinds read off the tree', { plugins: [TOOL_SPY] }, async ($, on) => {
    const suite = `${REPO}/packages/foo/src/test/suites/build/x.test.js`
    const w = world(on, {
      files: {
        [`${REPO}/package.json`]: '{}\n',
        [`${REPO}/build/keep.txt`]: '',
        [`${REPO}/packages/foo/package.json`]: '{}\n',
        [suite]: 'test()\n',
      },
    })
    await writeFile($, suite)
    expect(denyOf(w, 0)).toBeNull()
    await writeFile($, `${REPO}/build/out.js`)
    expect(denyOf(w, 1)).toBe(VENDOR(`${REPO}/build/out.js`, OUTPUT_DIR))
  })

  test('an Edit of the capture file with no marker: vendor-guard passes it, capture-guard refuses the rewrite', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on)
    await editFile($, CAPTURE)
    expect(denyOf(w)).toBe(REWRITE(ROUTE_OFF))
    expect(fired(w, 'safety:vendor-guard')).toEqual(['run'])
    expect(fired(w, 'safety:capture-guard')).toEqual(['run'])
  })

  // git cannot start in a folder that does not exist yet, so the gate asks from one that does.
  test('a Write into a dist/ that does not exist yet is still blocked by vendor-guard', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on)
    await writeFile($, `${REPO}/dist/new.js`)
    expect(denyOf(w)).toBe(VENDOR(`${REPO}/dist/new.js`, OUTPUT_DIR))
    expect(fired(w, 'safety:vendor-guard')).toEqual(['run'])
  })

  test('a Write into a new source folder still runs both guards', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on)
    await writeFile($, `${REPO}/src/new/file.js`)
    expect(denyOf(w)).toBeNull()
    expect(fired(w, 'safety:vendor-guard')).toEqual(['run'])
    expect(fired(w, 'safety:capture-guard')).toEqual(['run'])
  })

  test('a Write through a linked node_modules/ package is judged as typed: blocked, the typed path named', { plugins: [TOOL_SPY] }, async ($, on) => {
    const typed = `${REPO}/node_modules/p/index.js`
    const w = world(on, {
      files: { [`${REPO}/packages/p/index.js`]: 'module.exports = 1\n' },
      links: { [`${REPO}/node_modules/p`]: `${REPO}/packages/p` },
    })
    await writeFile($, typed)
    expect(denyOf(w)).toBe(VENDOR(typed, NODE_MODULES))
  })
})

describe('classic.PreToolUse Read/Grep: safety:capture-guard', () => {
  test('ports "reading the user capture file with no marker: exit 2": from an opted-in session folder', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on, { files: { [`${HOME}/.workkit/capture.md`]: '- a thought\n' } })
    await readFile($, `${HOME}/.workkit/capture.md`)
    expect(denyOf(w)).toBe(READ)
  })

  test('ports "a Grep whose path is the .workkit directory: exit 2"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on)
    await call($, 'Grep', { pattern: 'salary', path: `${REPO}/.workkit` })
    expect(denyOf(w)).toBe(READ)
  })

  test('ports "a .workkit Grep where no capture file exists: exit 0"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const bare = '/w/bare'
    const w = world(on, {
      repos: { [REPO]: OPTED_IN, [bare]: OPTED_IN },
      cwd: bare,
      files: { [`${bare}/.workkit/agents/session.md`]: '# Session\n' },
    })
    await call($, 'Grep', { pattern: 'salary', path: `${bare}/.workkit` })
    expect(denyOf(w)).toBeNull()
    expect(w.toolRan?.pattern).toBe('salary')
  })

  test('ports "a broad repo-wide Grep: exit 0": no path is the session folder', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = world(on)
    await call($, 'Grep', { pattern: 'salary' })
    expect(denyOf(w)).toBeNull()
    expect(w.toolRan?.pattern).toBe('salary')
  })
})
