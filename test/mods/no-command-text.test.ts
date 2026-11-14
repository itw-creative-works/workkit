// The hooks module's side of the lock that keeps every guard off a Bash command's text: a Bash call whose command is
// unmistakable (and spelled as the old readers would have acted on) gets the same program runs and the same answer as
// `ls`, and no program run, no file the module writes and no line it logs carries that text, before the call or after
// it. The one read the module makes, the capture path match, is test/mods/guards-capture-guard.test.ts; the facts a
// guard gets are test/hooks/no-command-text.test.js.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, kitLogs, TOOL_SPY, REPO, SID, answered } from '../lib/mod-world.ts'

const MARK = 'zq7731-no-guard-reads-this'
const UNMISTAKABLE = `printf '${MARK}' && git reset --hard && sed -i s/a/b/ x && npm publish`

const call = ($: any, command: string, id: string) => $.tool.call({ tool: 'Bash', command, description: 'x', tool_use_id: id } as any)
const after = ($: any, event: string, command: string, id: string) => $.classic[event]({
  tool_name: 'Bash', tool_input: { command }, tool_response: {}, tool_use_id: id, error: 'Exit code 1', session_id: SID, cwd: REPO,
})

// Each program run since `from`, as its argv joined.
const runsSince = (w: any, from: number) => w.calls.slice(from).map((c: any) => c.argv.join(' '))
// Everything the module handed a program, wrote or logged, as one text.
const leaked = (w: any) => [JSON.stringify(w.calls), [...w.files.values()].join('\n'), kitLogs(w).join('\n')].join('\n')

describe('no-command-text: the hooks module never carries a Bash command\'s text', () => {
  test('tool.call: the unmistakable command gets the same program runs and answer as ls, and its text reaches no run, file or log', { plugins: [TOOL_SPY] }, async ($, on) => {
    const w = mkWorld(on)
    // A first call warms what the module makes once per session, so the two compared calls start alike.
    await call($, 'ls', 'toolu_a')
    const before = w.calls.length
    await call($, 'ls', 'toolu_b')
    const plain = runsSince(w, before)
    const mid = w.calls.length
    await call($, UNMISTAKABLE, 'toolu_c')
    expect(runsSince(w, mid)).toEqual(plain)
    expect(answered(w, 2)?.deny).toBeUndefined()
    expect(answered(w, 2)?.context ?? null).toEqual(answered(w, 1)?.context ?? null)
    expect(w.toolRan?.command).toBe(UNMISTAKABLE)
    expect(leaked(w)).not.toContain(MARK)
  })

  for (const event of ['PostToolUse', 'PostToolUseFailure']) {
    test(`classic.${event}: the unmistakable command gets the same program runs and answer as ls, and its text reaches no run, file or log`, async ($, on) => {
      const w = mkWorld(on)
      await call($, 'ls', 'toolu_a')
      const before = w.calls.length
      const plainAnswer = await after($, event, 'ls', 'toolu_a')
      const plain = runsSince(w, before)
      await call($, UNMISTAKABLE, 'toolu_a')
      const mid = w.calls.length
      const answer = await after($, event, UNMISTAKABLE, 'toolu_a')
      expect(runsSince(w, mid)).toEqual(plain)
      expect(answer?.block).toBeUndefined()
      expect(answer?.additionalContext ?? null).toEqual(plainAnswer?.additionalContext ?? null)
      expect(leaked(w)).not.toContain(MARK)
    })
  }
})
