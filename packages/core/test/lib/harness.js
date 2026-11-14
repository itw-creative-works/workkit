// The test library's one entry: Node's own case functions, `test` and `it`
// behind the case deadline, the commands a suite needs as a skip value, and
// every concern file's exports. AGENTS.md § Tests.

import fs from 'node:fs';
import path from 'node:path';
import { test as nodeTest, it as nodeIt } from 'node:test';
import { withDeadline } from './cases.js';
import { CASE_DEADLINE } from './process.js';

export { describe, before, after, beforeEach, afterEach, mock } from 'node:test';
export * from './process.js';
export * from './scratch.js';
export * from './seed.js';
export * from './suites.js';
export * from './log.js';
export * from './spawn.js';
export * from './expect.js';

export const test = withDeadline(nodeTest, CASE_DEADLINE);
export const it = withDeadline(nodeIt, CASE_DEADLINE);

// The workflow state directory's name for the test layer. The engine and the
// hooks hold their own copy, so change all three together.
export const WORKKIT_DIR = '.workkit';

// A file PATH's search would run as `name`: on Windows the name plus each
// PATHEXT extension (the name alone only when it carries one), elsewhere an
// executable file of that name.
const onPath = (name) => {
  const windows = process.platform === 'win32';
  const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const names = windows ? [...(path.extname(name) ? [name] : []), ...exts.map((ext) => `${name}${ext}`)] : [name];
  return (process.env.PATH || '').split(path.delimiter).filter(Boolean).some((dir) => names.some((candidate) => {
    const file = path.join(dir, candidate);
    try {
      fs.accessSync(file, windows ? fs.constants.F_OK : fs.constants.X_OK);
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  }));
};

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
