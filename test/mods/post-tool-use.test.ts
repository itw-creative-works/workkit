// classic.PostToolUse (Edit/Write) through the hooks module: board-guard,
// changelog-guard, session-guard, test-reminder and test-bar run in that order
// on the written file and the first block wins.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, contextOf, hooksLog, HOME, REPO, PLAIN, SID, OPTED_IN } from '../lib/mod-world.ts'

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
  test('missing file_path in input: exit 0', async ($, on) => {
    mkWorld(on)
    expect((await write($, undefined)).block).toBeUndefined()
  })

  test('file_path that does not exist: exit 0', async ($, on) => {
    mkWorld(on)
    expect((await write($, `${REPO}/AGENTS.md`)).block).toBeUndefined()
  })
})

describe('classic.PostToolUse: board-guard, the markdown shape (docs.bullets)', () => {
  const bullets = (on: boolean) => JSON.stringify({ enabled: true, docs: { bullets: on } })
  const PARAGRAPH = '# Notes\n\nA line of running text, the shape the check refuses.\n'
  const everyDoc = JSON.stringify({ enabled: true, docs: { bullets: true, paths: ['./'] } })
  // A doc of `n` paragraph lines; the world's index copy of a file is its `git.blobs` entry `:<rel>`.
  const prose = (n: number) => ['# Notes', ...Array.from({ length: n }, (_, i) => `Paragraph line ${i}, running text.`), ''].join('\n')
  const tracked = (rel: string, n: number) => ({ blobs: { [`:${rel}`]: prose(n) } })

  test('a tracked README.md with 5 paragraph lines in the index: a write leaving 5 passes', async ($, on) => {
    mkWorld(on, { repos: { [REPO]: bullets(true) }, git: tracked('README.md', 5), files: { [`${REPO}/README.md`]: prose(5) } })
    expect((await write($, `${REPO}/README.md`)).block).toBeUndefined()
  })

  test('the same README.md and a write leaving 6: bounced, naming 6 and 5', async ($, on) => {
    mkWorld(on, { repos: { [REPO]: bullets(true) }, git: tracked('README.md', 5), files: { [`${REPO}/README.md`]: prose(6) } })
    expect((await write($, `${REPO}/README.md`)).block).toContain('DOC PROSE: 6 paragraph lines, 5 before')
  })

  test('a tracked docs/a/b.md with 1 paragraph line in the index: a write leaving 1 passes, one leaving 2 is bounced naming 2 and 1', async ($, on) => {
    const file = `${REPO}/docs/a/b.md`
    const w = mkWorld(on, { repos: { [REPO]: bullets(true) }, git: tracked('docs/a/b.md', 1), files: { [file]: prose(1) } })
    expect((await write($, file)).block).toBeUndefined()
    w.files.set(file, prose(2))
    expect((await write($, file)).block).toContain('DOC PROSE: 2 paragraph lines, 1 before')
  })

  test('a tracked docs/x.md in a merge conflict, the index holding stages 1 to 3: a write adding paragraph lines passes unjudged', async ($, on) => {
    mkWorld(on, { repos: { [REPO]: bullets(true) }, git: { conflicts: ['docs/x.md'] }, files: { [`${REPO}/docs/x.md`]: prose(4) } })
    expect((await write($, `${REPO}/docs/x.md`)).block).toBeUndefined()
  })

  for (const [label, git] of [['new', {}], ['tracked', tracked('src/pages/about.md', 1)]] as const) {
    test(`the default set and a ${label} src/pages/about.md full of paragraphs: nothing is bounced`, async ($, on) => {
      mkWorld(on, { repos: { [REPO]: bullets(true) }, git, files: { [`${REPO}/src/pages/about.md`]: prose(8) } })
      expect((await write($, `${REPO}/src/pages/about.md`)).block).toBeUndefined()
    })
  }

  test('case 6: docs.bullets true and a paragraph line in docs/x.md: the write is bounced naming the file and the line', async ($, on) => {
    mkWorld(on, { repos: { [REPO]: bullets(true) }, files: { [`${REPO}/docs/x.md`]: PARAGRAPH } })
    const r = await write($, `${REPO}/docs/x.md`)
    expect(r.block).toContain('board-guard: ')
    expect(r.block).toContain('x.md breaks the markdown shape')
    expect(r.block).toContain('DOC PROSE: line 3')
  })

  test('case 16: five prose lines and a 401-byte bullet: three prose lines named, the third with the rest counted, and the dense line with its bytes', async ($, on) => {
    const text = ['One line.', 'Two line.', 'Three line.', 'Four line.', 'Five line.', '', `- ${'x'.repeat(399)}`, ''].join('\n')
    mkWorld(on, { repos: { [REPO]: bullets(true) }, files: { [`${REPO}/docs/x.md`]: text } })
    const r = await write($, `${REPO}/docs/x.md`)
    expect(r.block).toContain('DOC PROSE: line 1')
    expect(r.block).toContain('DOC PROSE: line 2')
    expect(r.block).toContain('DOC PROSE: line 3, and 2 more')
    expect(r.block).toContain('DOC DENSITY: line 7 (401 bytes)')
  })

  for (const [label, settings] of [['absent', OPTED_IN], ['false', bullets(false)]]) {
    test(`case 7: the same write with docs.bullets ${label}: nothing is bounced`, async ($, on) => {
      mkWorld(on, { repos: { [REPO]: settings }, files: { [`${REPO}/docs/x.md`]: PARAGRAPH } })
      expect((await write($, `${REPO}/docs/x.md`)).block).toBeUndefined()
    })
  }

  for (const name of ['CHANGELOG.md', 'LICENSE.md']) {
    test(`case 8: docs.bullets true, docs.paths ["./"] and a paragraph line in ${name}: the shape check bounces nothing`, async ($, on) => {
      mkWorld(on, { repos: { [REPO]: everyDoc }, files: { [`${REPO}/${name}`]: PARAGRAPH } })
      expect((await write($, `${REPO}/${name}`)).block).toBeUndefined()
    })
  }

  test('case 17: docs.bullets true, docs.paths ["./"] and a paragraph line in an issue template folder bounces nothing, the same text in docs/bug.md is bounced', async ($, on) => {
    const quiet = ['.github/ISSUE_TEMPLATE/bug.md', 'workflow/templates/issue-forms/bug.md']
    const files = Object.fromEntries([...quiet, 'docs/bug.md'].map((rel) => [`${REPO}/${rel}`, PARAGRAPH]))
    mkWorld(on, { repos: { [REPO]: everyDoc }, files })
    for (const rel of quiet) expect((await write($, `${REPO}/${rel}`)).block).toBeUndefined()
    expect((await write($, `${REPO}/docs/bug.md`)).block).toContain('DOC PROSE: line 3')
  })

  test('case 9: docs.bullets false and an AGENTS.md of 251 lines: the budget bounce, and no shape bounce', async ($, on) => {
    mkWorld(on, { repos: { [REPO]: bullets(false) }, files: { [`${REPO}/AGENTS.md`]: agentsLines(251) } })
    const r = await write($, `${REPO}/AGENTS.md`)
    expect(r.block).toContain('AGENTS BUDGET')
    expect(r.block).toContain('251 lines (max 250)')
    expect(r.block).not.toContain('breaks the markdown shape')
  })

  test('case 10: docs.bullets true and a paragraph line in a file that is not markdown: nothing is bounced', async ($, on) => {
    mkWorld(on, { repos: { [REPO]: bullets(true) }, files: { [`${REPO}/notes.txt`]: PARAGRAPH } })
    expect((await write($, `${REPO}/notes.txt`)).block).toBeUndefined()
  })
})

describe('classic.PostToolUse: changelog-guard (docs:changelog-guard suite)', () => {
  const failing = { exitCode: 1, stdout: '', stderr: 'CHANGELOG.md:7: issue-link: the entry links no issue\n' }

  test('hooks.json registers the hook under PostToolUse Edit|Write: the node linter runs on the written file and its finding blocks', async ($, on) => {
    const file = `${REPO}/CHANGELOG.md`
    const w = mkWorld(on, { lint: failing, files: { [file]: '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- an essay\n' } })
    const r = await write($, file)
    expect(r.block).toContain('issue-link')
    const runs = w.runs('changelog/lint.js')
    expect(runs).toHaveLength(1)
    expect(runs[0].argv).toContain(file)
    expect(runs[0].argv).toContain('--added-only')
  })

  test('node absent: the write passes and one log line names the stand-down', async ($, on) => {
    const file = `${REPO}/CHANGELOG.md`
    const w = mkWorld(on, { absent: ['node'], lint: failing, files: { [file]: '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- an essay\n' } })
    const r = await write($, file)
    expect(r.block).toBeUndefined()
    const said = w.logs.filter((l: string) => l.startsWith('docs/changelog-guard: the linter did not start ('))
    expect(said).toHaveLength(1)
    expect(said[0].endsWith('); the write is not judged')).toBe(true)
  })
})

describe('classic.PostToolUse: test-reminder (safety:test-reminder suite)', () => {
  const files = { [`${REPO}/lib/thing.js`]: 'module.exports = 1;\n', [`${REPO}/tests/other.test.js`]: "require('../lib/other');\n" }
  const line = 'lib/thing.js has no test naming it.'

  test('hooks.json registers the hook under PostToolUse Edit|Write: a code file no test names gets the line', async ($, on) => {
    mkWorld(on, { files })
    const r = await write($, `${REPO}/lib/thing.js`)
    expect(r.block).toBeUndefined()
    expect(contextOf(r)).toContain(line)
    expect(contextOf(r)).toContain('If not, say why in the Proof: line.')
  })

  test('the same file again in the same session: silent', async ($, on) => {
    mkWorld(on, { files })
    expect(contextOf(await write($, `${REPO}/lib/thing.js`))).toContain(line)
    expect(contextOf(await write($, `${REPO}/lib/thing.js`))).toBe('')
  })

  test('the same file in a different session: the line again', async ($, on) => {
    mkWorld(on, { files })
    expect(contextOf(await write($, `${REPO}/lib/thing.js`, { session_id: 'session-1' }))).toContain(line)
    expect(contextOf(await write($, `${REPO}/lib/thing.js`, { session_id: 'session-2' }))).toContain(line)
  })

  test('no session id: the line every time', async ($, on) => {
    mkWorld(on, { files })
    expect(contextOf(await write($, `${REPO}/lib/thing.js`, { session_id: '' }))).toContain(line)
    expect(contextOf(await write($, `${REPO}/lib/thing.js`, { session_id: '' }))).toContain(line)
  })

  test('a path inside no git repository: silent', async ($, on) => {
    mkWorld(on, { files: { [`${PLAIN}/lib/thing.js`]: 'module.exports = 1;\n' } })
    expect(contextOf(await write($, `${PLAIN}/lib/thing.js`, { cwd: PLAIN }))).toBe('')
  })
})

describe('classic.PostToolUse: test-bar (safety:test-bar suite)', () => {
  const OTHER = '/w/other'
  const body = "const fs = require('fs');\nconst dir = fs.mkdtempSync('thing-');\n"
  const fired = (w: any) => hooksLog(w).filter((l: any) => l.hook === 'safety:test-reminder' || l.hook === 'safety:test-bar')
    .map((l: any) => `${l.hook} ${l.verdict}`)

  test('a test-file write with a finding lands, and the context carries the test-bar line', async ($, on) => {
    mkWorld(on, { files: { [`${REPO}/tests/thing.test.js`]: body } })
    const r = await write($, `${REPO}/tests/thing.test.js`)
    expect(r.block).toBeUndefined()
    expect(contextOf(r)).toContain('test-bar: tests/thing.test.js:2 ')
    expect(contextOf(r)).toContain('mkTmp')
  })

  test('test-bar runs after test-reminder, and its line rides the one context', async ($, on) => {
    const w = mkWorld(on, { files: { [`${REPO}/tests/thing.test.js`]: body } })
    const r = await write($, `${REPO}/tests/thing.test.js`)
    expect(fired(w)).toEqual(['safety:test-reminder run', 'safety:test-bar run'])
    expect(r.additionalContext.filter((c: string) => c.includes('test-bar: tests/thing.test.js:2 '))).toHaveLength(1)
  })

  test('a repo that has not opted in: nothing added, and the fire logs stood-down', async ($, on) => {
    const w = mkWorld(on, { repos: { [REPO]: null }, files: { [`${REPO}/tests/thing.test.js`]: body } })
    expect(contextOf(await write($, `${REPO}/tests/thing.test.js`))).toBe('')
    expect(hooksLog(w).filter((l: any) => l.hook === 'safety:test-bar').map((l: any) => l.verdict)).toEqual(['stood-down'])
  })

  test('a test file in a repo other than the session\'s: nothing added', async ($, on) => {
    mkWorld(on, { repos: { [REPO]: OPTED_IN, [OTHER]: OPTED_IN }, files: { [`${OTHER}/tests/thing.test.js`]: body } })
    expect(contextOf(await write($, `${OTHER}/tests/thing.test.js`))).toBe('')
  })
})
