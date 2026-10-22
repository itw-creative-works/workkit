// The serial Bash chain's cost, measured: 20 plain Bash tool.call events through
// the hooks module in an opted-in repo, and the mean time each took printed as
// one line, `mean handler ms: <n>`, for the issue's Proof line. A measurement,
// never a bar: the cases assert only that every call went through.

import { test, expect, describe } from 'claude-code/testing'
import { mkWorld, bash, REPO } from '../lib/mod-world.ts'

const RUNS = 20
// The test kit ends a case at 5 seconds, so the 20 calls run in batches.
const BATCH = 5
const took: number[] = []

describe('tool.call Bash: the chain timed', () => {
  for (let b = 0; b < RUNS / BATCH; b++) {
    test(`plain Bash calls ${b * BATCH + 1} to ${(b + 1) * BATCH} of ${RUNS} through the module`, async ($, on) => {
      const w = mkWorld(on, { files: { [`${REPO}/package.json`]: JSON.stringify({ name: 'widget', version: '1.2.3' }) } })
      for (let i = 0; i < BATCH; i++) {
        const command = `ls -la src/${b * BATCH + i}`
        const start = performance.now()
        await bash($, command)
        took.push(performance.now() - start)
        expect(w.toolRan?.command).toBe(command)
      }
      if (took.length === RUNS) {
        // eslint-disable-next-line no-console
        console.log(`mean handler ms: ${(took.reduce((a, t) => a + t, 0) / RUNS).toFixed(2)}`)
      }
    })
  }
})
