// classic.PostToolUse (Edit/Write) through the hooks module: board-guard,
// changelog-guard, session-guard and test-reminder run in that order on the
// written file and the first block wins.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, contextOf, HOME, REPO, PLAIN, SID, OPTED_IN } from '../lib/mod-world.ts'

const write = ($: any, filePath: string | undefined, extra: any = {}) => $.classic.PostToolUse({
  tool_name: 'Write',
  tool_input: filePath === undefined ? {} : { file_path: filePath, content: '' },
  tool_response: {},
  tool_use_id: 'toolu_1',
  session_id: SID,
  cwd: REPO,
  ...extra,
})

const agentsLines = (n: number) => `# repo: overview\n${Array.from({ length: n - 1 }, (_, i) => `line ${i}`).join('\n')}\n`
const sessionDoc = (bullets: string[]) => ['# Session', '', '## Active', ...bullets, '', '## Queue', '', '## Notes', ''].join('\n')
const notGate = (c: any) => !c.argv.includes('--show-toplevel')

describe('classic.PostToolUse: the Contract cases', () => {
  test('a Write to AGENTS.md over 250 lines blocks with board-guard text, and the later three do not run', async ($, on) => {
    const w = mkWorld(on, { files: { [`${REPO}/AGENTS.md`]: agentsLines(251) } })
    const r = await write($, `${REPO}/AGENTS.md`)
    expect(r.block).toContain('AGENTS BUDGET')
    expect(r.additionalContext).toBeUndefined()
    expect(w.calls.filter(notGate)).toHaveLength(0)
  })

  test('a Write to C:\\repo\\AGENTS.md over 250 lines blocks as the / spelling does', async ($, on) => {
    const root = 'C:\\repo'
    mkWorld(on, { repos: { [root]: OPTED_IN }, cwd: root, files: { [`${root}\\AGENTS.md`]: agentsLines(251) } })
    const r = await write($, `${root}\\AGENTS.md`, { cwd: root })
    expect(r.block).toContain('AGENTS BUDGET')
  })

  test('a Write through ~/.claude/AGENTS.md, a link into an opted-in repo, is read where the file really is and blocks over 250 lines', async ($, on) => {
    const link = `${HOME}/.claude/AGENTS.md`
    mkWorld(on, { files: { [`${REPO}/AGENTS.md`]: agentsLines(251) }, links: { [link]: `${REPO}/AGENTS.md` } })
    const r = await write($, link, { cwd: HOME })
    expect(r.block).toContain('AGENTS BUDGET')
  })

  test('a Write to .workkit/agents/session.md with a 351-character bullet blocks with session-guard text', async ($, on) => {
    const bullet = `- ${'x'.repeat(349)}`
    const file = `${REPO}/.workkit/agents/session.md`
    mkWorld(on, { files: { [file]: sessionDoc([bullet]) } })
    const r = await write($, file)
    expect(r.block).toContain('351 chars')
    expect(r.block).toContain('350')
  })
})

describe('classic.PostToolUse: board-guard (docs:board-guard suite)', () => {
  test('ports "missing file_path in input: exit 0"', async ($, on) => {
    mkWorld(on)
    expect((await write($, undefined)).block).toBeUndefined()
  })

  test('ports "file_path that does not exist: exit 0"', async ($, on) => {
    mkWorld(on)
    expect((await write($, `${REPO}/AGENTS.md`)).block).toBeUndefined()
  })
})

describe('classic.PostToolUse: changelog-guard (docs:changelog-guard suite)', () => {
  const failing = { exitCode: 1, stdout: '', stderr: 'CHANGELOG.md:7: issue-link: the entry links no issue\n' }

  test('ports "no file_path in the input: fail open"', async ($, on) => {
    mkWorld(on, { lint: failing })
    expect((await write($, undefined)).block).toBeUndefined()
  })

  test('ports "a CHANGELOG that no longer exists: fail open"', async ($, on) => {
    mkWorld(on, { lint: failing })
    expect((await write($, `${REPO}/CHANGELOG.md`)).block).toBeUndefined()
  })

  test('ports "hooks.json registers the hook under PostToolUse Edit|Write": the node linter runs on the written file and its finding blocks', async ($, on) => {
    const file = `${REPO}/CHANGELOG.md`
    const w = mkWorld(on, { lint: failing, files: { [file]: '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- an essay\n' } })
    const r = await write($, file)
    expect(r.block).toContain('issue-link')
    const runs = w.runs('changelog.js')
    expect(runs).toHaveLength(1)
    expect(runs[0].argv).toContain(file)
    expect(runs[0].argv).toContain('--added-only')
  })
})

describe('classic.PostToolUse: session-guard (docs:session-guard suite)', () => {
  test('ports "a session.md that no longer exists: fail open"', async ($, on) => {
    mkWorld(on)
    expect((await write($, `${REPO}/.workkit/agents/session.md`)).block).toBeUndefined()
  })

  test('ports "no file_path in the input: fail open"', async ($, on) => {
    mkWorld(on)
    expect((await write($, undefined)).block).toBeUndefined()
  })
})

describe('classic.PostToolUse: test-reminder (safety:test-reminder suite)', () => {
  const files = { [`${REPO}/lib/thing.js`]: 'module.exports = 1;\n', [`${REPO}/tests/other.test.js`]: "require('../lib/other');\n" }
  const line = 'lib/thing.js has no test naming it.'

  test('ports "hooks.json registers the hook under PostToolUse Edit|Write": a code file no test names gets the line', async ($, on) => {
    mkWorld(on, { files })
    const r = await write($, `${REPO}/lib/thing.js`)
    expect(r.block).toBeUndefined()
    expect(contextOf(r)).toContain(line)
    expect(contextOf(r)).toContain('If not, say why in the Proof: line.')
  })

  test('ports "the same file again in the same session: silent"', async ($, on) => {
    mkWorld(on, { files })
    expect(contextOf(await write($, `${REPO}/lib/thing.js`))).toContain(line)
    expect(contextOf(await write($, `${REPO}/lib/thing.js`))).toBe('')
  })

  test('ports "the same file in a different session: the line again"', async ($, on) => {
    mkWorld(on, { files })
    expect(contextOf(await write($, `${REPO}/lib/thing.js`, { session_id: 'session-1' }))).toContain(line)
    expect(contextOf(await write($, `${REPO}/lib/thing.js`, { session_id: 'session-2' }))).toContain(line)
  })

  test('ports "no session id: the line every time"', async ($, on) => {
    mkWorld(on, { files })
    expect(contextOf(await write($, `${REPO}/lib/thing.js`, { session_id: '' }))).toContain(line)
    expect(contextOf(await write($, `${REPO}/lib/thing.js`, { session_id: '' }))).toContain(line)
  })

  test('ports "a path inside no git repository: silent"', async ($, on) => {
    mkWorld(on, { files: { [`${PLAIN}/lib/thing.js`]: 'module.exports = 1;\n' } })
    expect(contextOf(await write($, `${PLAIN}/lib/thing.js`, { cwd: PLAIN }))).toBe('')
  })

  test('ports "a file that does not exist: silent"', async ($, on) => {
    mkWorld(on)
    expect(contextOf(await write($, `${REPO}/lib/gone.js`))).toBe('')
  })
})
