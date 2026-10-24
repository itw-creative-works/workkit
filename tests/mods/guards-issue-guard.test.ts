// tool.call Bash through the hooks module: safety:issue-guard in the Bash
// chain, the one guard that runs whether the repo opted in or not, the .env
// files read from the session folder and the repo root above it, and a body
// file read where the command names it.
// The verdict's own cases are tests/hooks/issue-guard.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, hooksLog, TOOL_SPY, REPO, bash, denyOf } from '../lib/mod-world.ts'

const SECRET = 'sup3rSecretValue_9f2a'
const ROOT_SECRET = 'r00tSecretValue_7c1b'
const SUB_SECRET = 'subSecretValue_4d9e'
const SUB = `${REPO}/packages/api`
const PUBLIC = 'Every repo workkit touches is assumed public, issues and PRs and comments included: no secrets, credentials, tokens, or private business or personal details. Keep that context in chat or in local files and reference it indirectly.'
const ENV_VALUE = (key: string) => `issue-guard: BLOCKED this gh command: the outbound text carries the value of ${key} from a local .env file.\n${PUBLIC}`

const fired = (w: any, hook: string) => hooksLog(w).filter((l: any) => l.hook === hook).map((l: any) => l.verdict)
const ENV_FILES = {
  [`${REPO}/.env`]: `# a comment\nAPI_SECRET=${SECRET}\nDEBUG=true\n`,
  [`${REPO}/.env.example`]: 'API_SECRET=your-api-key-here-1234\n',
}
const ORG_FILES = { [`${REPO}/.env`]: 'ORG="itw-creative-works"\n' }
const ORG_BODY = 'gh issue comment 1 --body "itw-creative-works is the org"'

describe('tool.call Bash: safety:issue-guard', () => {
  test('given gh issue create whose text carries a .env value: the deny names the key, never the value', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { files: ENV_FILES })
    await bash($, `gh issue create --title "auth fails" --body "the token is ${SECRET}"`)
    const deny = denyOf(w)
    expect(deny).toBe(ENV_VALUE('API_SECRET'))
    expect(deny).not.toContain(SECRET)
    expect(w.toolRan).toBeUndefined()
    expect(fired(w, 'safety:issue-guard')).toEqual(['run'])
  })

  test('the same in a repo with no .workkit/settings.json: issue-guard runs while the opted-in guards stand down', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { repos: { [REPO]: null }, files: ENV_FILES })
    await bash($, `gh issue create --title "auth fails" --body "the token is ${SECRET}"`)
    expect(denyOf(w)).toBe(ENV_VALUE('API_SECRET'))
    expect(fired(w, 'safety:issue-guard')).toEqual(['run'])
    expect(fired(w, 'safety:commit-language')).toEqual(['stood-down'])
  })

  test('ports "a root .env value, from a subdirectory cwd" and "the subdirectory\'s own .env is still scanned"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, {
      cwd: SUB,
      files: { [`${REPO}/.env`]: `ROOT_TOKEN=${ROOT_SECRET}\n`, [`${SUB}/.env`]: `SUB_TOKEN=${SUB_SECRET}\n` },
    })
    await bash($, `gh issue comment 12 --body "it failed with ${ROOT_SECRET}"`)
    expect(denyOf(w, 0)).toBe(ENV_VALUE('ROOT_TOKEN'))
    await bash($, `gh issue comment 12 --body "it failed with ${SUB_SECRET}"`)
    expect(denyOf(w, 1)).toBe(ENV_VALUE('SUB_TOKEN'))
  })

  test('ports "--body-file CONTENT is scanned: exit 2": the file read from the session folder', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { files: { ...ENV_FILES, [`${REPO}/body.md`]: `## Description\n\nthe key is ${SECRET}\n` } })
    await bash($, 'gh issue create --title "x" --body-file body.md')
    expect(denyOf(w)).toBe(ENV_VALUE('API_SECRET'))
  })

  test('ports "the -F body=@file form is dereferenced": an absolute path', { plugins: [TOOL_SPY] }, async ($, on) => {
    const file = '/w/notes/rest-comment.md'
    const w = mkWorld(on, { files: { ...ENV_FILES, [file]: `the key is ${SECRET}\n` } })
    await bash($, `gh api -X POST repos/owner/name/issues/12/comments -F body=@${file}`)
    expect(denyOf(w)).toBe(ENV_VALUE('API_SECRET'))
  })

  test('ports "a placeholder from .env.example: exit 0" and "clean gh issue comment: exit 0"', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { files: ENV_FILES })
    await bash($, 'gh issue comment 12 --body "set API_SECRET=your-api-key-here-1234 locally"')
    await bash($, 'gh issue comment 57 --body "specced: the guard blocks the outbound write"')
    expect(denyOf(w, 0)).toBeNull()
    expect(denyOf(w, 1)).toBeNull()
    expect(w.toolRan?.command).toBe('gh issue comment 57 --body "specced: the guard blocks the outbound write"')
  })

  test('a .env value naming the org, from a repo whose origin is under the org: the write passes', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { files: ORG_FILES, origins: { [REPO]: 'https://github.com/itw-creative-works/workkit.git' } })
    await bash($, ORG_BODY)
    expect(denyOf(w)).toBeNull()
    expect(w.toolRan?.command).toBe(ORG_BODY)
  })

  test('the same text from a repo with no origin: the deny names ORG', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on, { files: ORG_FILES, origins: { [REPO]: null } })
    await bash($, ORG_BODY)
    expect(denyOf(w)).toBe(ENV_VALUE('ORG'))
    expect(w.toolRan).toBeUndefined()
  })
})
