// The test library's one entry: Node's own case functions, `test` and `it`
// behind the case deadline, the commands a suite needs as a skip value, and
// every concern file's exports. AGENTS.md § Tests.

import { onPath } from './on-path.js';

export { describe, before, after, beforeEach, afterEach, mock } from 'node:test';
export { test, it } from './cases.js';
export * from './process.js';
export * from './scratch.js';
export * from './seed.js';
export * from './suites.js';
export * from './log.js';
export * from './spawn.js';
export * from './expect.js';
export * from './events.js';
export * from './app-cases.js';
export * from './mods.js';

// The workflow state directory's name for the test layer. The engine and the
// hooks hold their own copy, so change all three together.
export const WORKKIT_DIR = '.workkit';

// The commands a suite or case runs, as its `skip` value: false when every
// one is on the PATH. A missing one skips, the reason naming each, only in a
// cloud session, which may lack it; anywhere else it throws, failing the file.
//   describe('render', { skip: needs('hugo', 'ffmpeg') }, () => { ... });
export const needs = (...tools) => {
  if (tools.length === 0 || tools.some((tool) => typeof tool !== 'string' || tool === '')) {
    throw new TypeError('needs() takes one or more command names');
  }
  const missing = [...new Set(tools)].filter((tool) => !onPath(tool));
  if (missing.length === 0) return false;
  const reason = `needs ${missing.join(', ')}`;
  if (process.env.CLAUDE_CODE_REMOTE === 'true') return reason;
  throw new Error(`${reason}, not installed`);
};

// Mirrors the engine's `uname -s` question rather than probing PATH for
// launchctl, so the two never disagree about which branch the code takes.
export const hasLaunchd = () => process.platform === 'darwin';
