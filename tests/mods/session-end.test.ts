// session.end through the hooks module: the ending session's per-session
// state (every store key under workkit:<session_id>:) is dropped.

import { test, expect } from 'claude-code/testing'
import { mkWorld } from '../lib/mod-world.ts'

test("session.end deletes every workkit:<sid>: key and leaves other sessions' keys", async ($, on) => {
  const w = mkWorld(on, {
    store: {
      'workkit:sess-1:test-reminder': ['lib/a.js'],
      'workkit:sess-1:checkpoint': 1,
      'workkit:sess-1:reload-guard:stamp': 'x',
      'workkit:sess-2:checkpoint': 2,
      'someone-else': 3,
    },
  })
  await $.session.end({ reason: 'other', sessionId: 'sess-1', resume: {} } as any)
  expect(w.sessionKeys('sess-1')).toHaveLength(0)
  expect(w.store.has('workkit:sess-2:checkpoint')).toBe(true)
  expect(w.store.has('someone-else')).toBe(true)
})

test('with HOOK_DISABLE=1 session.end passes on and every workkit:<sid>: key stays', async ($, on) => {
  const w = mkWorld(on, { env: { HOOK_DISABLE: '1' }, store: { 'workkit:sess-1:checkpoint': 1, 'workkit:sess-1:feature': true } })
  await $.session.end({ reason: 'other', sessionId: 'sess-1', resume: {} } as any)
  expect(w.sessionKeys('sess-1')).toHaveLength(2)
})
