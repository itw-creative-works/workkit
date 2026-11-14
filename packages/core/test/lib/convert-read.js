// The reading half of `workkit convert` (test/convert.js): an old-shape
// suite's code with its literals masked, its brackets, its frame (the export,
// the runner, the selfRun line), its harness require, its testUnless aliases
// and the runner's statements, and the reads that keep a file as it is.

import { maskSpans } from './lexer.js';

// The harness words the door does not carry: a use the mapping leaves keeps
// the file as it is.
export const REMOVED = ['group', 'assert', 'assertEq', 'failureOf', 'skip', 'testUnless', 'skipSuite', 'summary', 'selfRun', 'log', 'stripAnsi'];
// The words a call statement of the runner may open with to be a case.
const CASE_CALL = /(?<![\w$.])(test|skip|testUnless)\s*\(/;
const ASSERT_CALL = /(?<![\w$.])(assertEq|assert)\s*\(/g;
const OPENERS = { '(': ')', '[': ']', '{': '}' };

/**
 * The text with every comment blanked to spaces and every string, template
 * and regex to `#`s, so a literal stays a value; an index in it is the same
 * index in the text.
 * @param {string} text the source
 * @returns {{ code: string, inTemplate: boolean[] }}
 */
export const maskOf = (text) => maskSpans(text, { comment: ' ', literal: '#' });

/** The 1-based line of index `at`. */
export const lineOf = (text, at) => text.slice(0, at).split('\n').length;
// An identifier as a regex source: a `$` in it matched as itself.
const escaped = (name) => name.replace(/\$/g, '\\$');
const skipSpace = (code, at) => {
  let i = at;
  while (i < code.length && /\s/.test(code[i])) i += 1;
  return i;
};

// The index of the closer matching the opener at `at`, or -1 when the
// brackets do not pair.
const closeOf = (code, at) => {
  const want = [OPENERS[code[at]]];
  for (let i = at + 1; i < code.length; i += 1) {
    const c = code[i];
    if (OPENERS[c]) want.push(OPENERS[c]);
    else if (c === ')' || c === ']' || c === '}') {
      if (c !== want.pop()) return -1;
      if (want.length === 0) return i;
    }
  }
  return -1;
};

/**
 * Where the masked code's brackets stop pairing, or -1 when they all pair:
 * a closer of the wrong kind, or the innermost opener never closed. The line
 * lexer misreads some literals (a template inside a template's `${}`).
 * @param {string} code the masked code
 * @returns {number}
 */
export const pairingBreak = (code) => {
  const open = [];
  for (let i = 0; i < code.length; i += 1) {
    const c = code[i];
    if (OPENERS[c]) open.push(i);
    else if (c === ')' || c === ']' || c === '}') {
      if (open.length === 0 || OPENERS[code[open.pop()]] !== c) return i;
    }
  }
  return open.length ? open.at(-1) : -1;
};

/**
 * The arguments between the parens at `open` and `close`, each its range
 * trimmed of space; a trailing comma adds none.
 * @returns {Array<{ s: number, e: number }>}
 */
export const argsOf = (code, open, close) => {
  const args = [];
  let depth = 0;
  let from = open + 1;
  const push = (to) => {
    const s = skipSpace(code, from);
    let e = to;
    while (e > s && /\s/.test(code[e - 1])) e -= 1;
    if (e > s) args.push({ s, e });
  };
  for (let i = open + 1; i < close; i += 1) {
    if (OPENERS[code[i]]) depth += 1;
    else if (')]}'.includes(code[i])) depth -= 1;
    else if (code[i] === ',' && depth === 0) {
      push(i);
      from = i + 1;
    }
  }
  push(close);
  return args;
};

/** The code of a range with everything inside its brackets blanked. */
export const topOf = (code, s, e) => {
  let depth = 0;
  let out = '';
  for (let i = s; i < e; i += 1) {
    const c = code[i];
    if (')]}'.includes(c)) depth -= 1;
    out += depth === 0 ? c : ' ';
    if (OPENERS[c]) depth += 1;
  }
  return out;
};

// The end of the statement opening at `at`: just past its `;` at the top, or
// -1 when none comes before `to`.
const semicolonEnd = (code, at, to) => {
  let depth = 0;
  for (let i = at; i < to; i += 1) {
    if (OPENERS[code[i]]) depth += 1;
    else if (')]}'.includes(code[i])) depth -= 1;
    else if (code[i] === ';' && depth === 0) return i + 1;
  }
  return -1;
};

// The end of a call statement whose callee ends at `at`: `pairs` paren lists
// (two for testUnless), then `;`. Null when it is shaped otherwise.
const callEnd = (code, at, pairs) => {
  const lists = [];
  let i = at;
  for (let n = 0; n < pairs; n += 1) {
    i = skipSpace(code, i);
    if (code[i] !== '(') return null;
    const close = closeOf(code, i);
    if (close === -1) return null;
    lists.push({ open: i, close });
    i = close + 1;
  }
  i = skipSpace(code, i);
  return code[i] === ';' ? { lists, end: i + 1 } : null;
};

// The extent of an `if`, `for` or `while` statement at `at` (its head, then
// a block or one statement), so the words inside it can be read.
const blockExtent = (code, at, to) => {
  const head = code.indexOf('(', at);
  const headEnd = head === -1 ? -1 : closeOf(code, head);
  if (headEnd === -1) return to;
  const body = skipSpace(code, headEnd + 1);
  if (code[body] === '{') return closeOf(code, body) + 1 || to;
  const end = semicolonEnd(code, body, to);
  return end === -1 ? to : end;
};

// Why a runner statement that is no label, case or constant stops the file;
// `named` holds every name declared as a testUnless alias, mappable or not.
const whyStopped = (code, at, to, named) => {
  const word = code.slice(at).match(/^[\w$.]+/)?.[0] ?? code[at];
  const holdsCase = (end) => CASE_CALL.test(code.slice(at, end));
  if (/^(for|while|do)$/.test(word)) return holdsCase(blockExtent(code, at, to)) ? 'cases made in a loop' : `a ${word} loop between cases`;
  if (/(?<![\w$.])(skipSuite|needs)\s*\(/.test(code.slice(at, semicolonEnd(code, at, to)))) return 'a whole-file skip';
  if (word === 'if') return holdsCase(blockExtent(code, at, to)) ? 'a case behind an if' : 'an if between cases';
  if (word === 'let' || word === 'var') return `a ${word} between cases, no constant`;
  if (word === 'const') return 'an awaited constant between cases, a setup';
  if (word === 'return') return 'a return before the runner\'s end';
  const callee = code.slice(at).match(/^(?:await\s+)?([\w$.]+)\s*\(/)?.[1];
  if (callee && named.has(callee)) return `a case through ${callee}, a testUnless alias`;
  if (callee) return `a call to ${callee}, no label, case or constant`;
  return `a ${word} statement, no label, case or constant`;
};

/**
 * The runner body's statements, each a label (`group`), a case (`test`,
 * `skip`, `testUnless`, or a call through a mappable alias, kind `alias`), a
 * constant (an alias's own line, kind `aliasDecl`) or the closing
 * `return summary();`; or the first statement that is none of them.
 * @param {string} code the masked code
 * @param {number} from the body's first index
 * @param {number} to the index of its closing brace
 * @param {{ map: Map<string, object>, named: Set<string> }} aliases the file's testUnless aliases
 * @returns {{ stmts: object[], stop?: { at: number, why: string } }}
 */
export const statementsOf = (code, from, to, aliases) => {
  const stmts = [];
  const declAt = new Set([...aliases.map.values()].map((a) => a.start));
  let at = skipSpace(code, from);
  while (at < to) {
    const rest = code.slice(at, to);
    const stopped = (why) => ({ stmts, stop: { at, why } });
    let m;
    if ((m = rest.match(/^group\s*(?=\()/))) {
      const call = callEnd(code, at + m[0].length, 1);
      if (!call) return stopped('a group call shaped otherwise');
      stmts.push({ kind: 'group', start: at, end: call.end, args: call.lists[0] });
    } else if ((m = rest.match(/^(?:await\s+)?([\w$]+)\s*(?=\()/)) && aliases.map.has(m[1])) {
      const call = callEnd(code, at + m[0].length, 1);
      if (!call || argsOf(code, call.lists[0].open, call.lists[0].close).length !== 2) return stopped(`a ${m[1]} call shaped otherwise`);
      const callee = at + m[0].length - m[0].replace(/^(?:await\s+)?/, '').length;
      stmts.push({ kind: 'alias', start: at, end: call.end, callee, lists: call.lists, alias: aliases.map.get(m[1]) });
    } else if (m && ['test', 'skip', 'testUnless'].includes(m[1])) {
      const call = callEnd(code, at + m[0].length, m[1] === 'testUnless' ? 2 : 1);
      if (!call) return stopped(`a ${m[1]} call shaped otherwise`);
      const counts = call.lists.map(({ open, close }) => argsOf(code, open, close).length);
      if (m[1] === 'skip' && counts[0] !== 2) return stopped('a skip without its name and reason');
      if (m[1] === 'testUnless' && (counts[0] !== 2 || counts[1] !== 2)) return stopped('a testUnless without its condition, reason, name and case');
      const callee = at + m[0].search(/(test|skip|testUnless)/);
      stmts.push({ kind: m[1], start: at, end: call.end, callee, lists: call.lists });
    } else if (/^const\s/.test(rest)) {
      const end = semicolonEnd(code, at, to);
      if (end === -1) return stopped('a constant with no semicolon');
      if (/(?<![\w$.])await(?![\w$])/.test(topOf(code, at, end))) return stopped(whyStopped(code, at, to, aliases.named));
      stmts.push({ kind: declAt.has(at) ? 'aliasDecl' : 'const', start: at, end });
    } else if (/^return\s+summary\s*\(\s*\)\s*;/.test(rest)) {
      const end = semicolonEnd(code, at, to);
      if (skipSpace(code, end) < to) return stopped('a return before the runner\'s end');
      stmts.push({ kind: 'summary', start: at, end });
    } else {
      return stopped(whyStopped(code, at, to, aliases.named));
    }
    at = skipSpace(code, stmts.at(-1).end);
  }
  return { stmts };
};

// How many brackets are open at `at`.
const depthAt = (code, at) => {
  let depth = 0;
  for (let i = 0; i < at; i += 1) {
    if (OPENERS[code[i]]) depth += 1;
    else if (')]}'.includes(code[i])) depth -= 1;
  }
  return depth;
};

// The first statement matching `re` (a line-start pattern) at the top level,
// as its range and match.
const topLevel = (code, re) => {
  const m = [...code.matchAll(re)].find((hit) => depthAt(code, hit.index) === 0);
  return m ? { start: m.index, end: m.index + m[0].length, m } : null;
};

/**
 * The harness require: a top-level `const { ... } = require('<spec>');`, not
 * node's own, binding a harness case word; its names as written.
 * @returns {{ start: number, end: number, spec: string, names: string[], renamed?: string, multiline: boolean } | null}
 */
export const harnessRequire = (text, code) => {
  for (const m of code.matchAll(/^const\s*\{([^{}]*)\}\s*=\s*require\(([^()]*)\)\s*;/gm)) {
    const spec = text.slice(m.index + m[0].indexOf('require(') + 8, m.index + m[0].lastIndexOf(')')).trim();
    if (/^['"]node:/.test(spec) || depthAt(code, m.index) !== 0) continue;
    const parts = m[1].split(',').map((part) => part.trim()).filter(Boolean);
    const names = parts.map((part) => part.split(/\s*:\s*/));
    if (!names.some(([name]) => ['test', 'group', 'summary', 'selfRun'].includes(name))) continue;
    const renamed = names.find(([name, alias]) => alias && alias !== name && [...REMOVED, 'test'].includes(name));
    return { start: m.index, end: m.index + m[0].length, spec, names: parts, renamed: renamed?.[0], multiline: m[0].includes('\n') };
  }
  return null;
};

/**
 * The old shape's frame: the runner function and its body, and the export and
 * selfRun lines to drop; or why the file holds none. An export that only
 * awaits a runner and returns the summary wraps it.
 * @returns {{ runner: object, drops: object[] } | { why: string, at: number }}
 */
export const frameOf = (code) => {
  const selfRun = topLevel(code, /^if\s*\(\s*require\.main\s*===\s*module\s*\)\s*selfRun\(\s*[\w$.]+\s*\)\s*;/gm);
  const inline = topLevel(code, /^module\.exports\s*=\s*async\s*\(\s*\)\s*=>\s*\{/gm);
  let exported = null;
  let name;
  if (inline) {
    const close = closeOf(code, inline.end - 1);
    const semi = skipSpace(code, close + 1);
    if (close === -1 || code[semi] !== ';') return { why: 'a runner export shaped otherwise', at: inline.start };
    const wrapped = code.slice(inline.end, close).match(/^\s*await\s+([\w$]+)\s*\(\s*\)\s*;\s*return\s+summary\s*\(\s*\)\s*;\s*$/);
    if (!wrapped) return { runner: { start: inline.start, end: semi + 1, open: inline.end - 1, close }, drops: [selfRun].filter(Boolean) };
    exported = { start: inline.start, end: semi + 1 };
    name = wrapped[1];
  } else {
    exported = topLevel(code, /^module\.exports\s*=\s*([\w$]+)\s*;/gm);
    if (!exported) return { why: 'no runner export, so no suite in the old shape', at: 0 };
    name = exported.m[1];
  }
  const word = escaped(name);
  const def = topLevel(code, new RegExp(`^(?:const\\s+${word}\\s*=\\s*async\\s*\\(\\s*\\)\\s*=>\\s*|async\\s+function\\s+${word}\\s*\\(\\s*\\)\\s*)\\{`, 'gm'));
  if (!def) return { why: `no runner function ${name} to read`, at: exported.start };
  const close = closeOf(code, def.end - 1);
  if (close === -1) return { why: `a runner ${name} shaped otherwise`, at: def.start };
  const semi = skipSpace(code, close + 1);
  const end = code[semi] === ';' ? semi + 1 : close + 1;
  return { runner: { start: def.start, end, open: def.end - 1, close, name }, drops: [exported, selfRun].filter(Boolean) };
};

/**
 * The file's testUnless aliases, `const name = testUnless(cond, reason);` at
 * the top level or as a runner statement: `map` the ones the mapping reads,
 * each with its statement range and its two arguments, `named` every name.
 * @param {string} code the masked code
 * @param {{ open: number, close: number }} runner the runner's body
 * @returns {{ map: Map<string, object>, named: Set<string> }}
 */
export const aliasesOf = (code, runner) => {
  const map = new Map();
  const named = new Set();
  for (const m of code.matchAll(/^([ \t]*)const\s+([\w$]+)\s*=\s*testUnless\s*(?=\()/gm)) {
    const start = m.index + m[1].length;
    named.add(m[2]);
    const depth = depthAt(code, start);
    const inRunner = start > runner.open && start < runner.close;
    if (!(depth === 0 || (depth === 1 && inRunner))) continue;
    const call = callEnd(code, m.index + m[0].length, 1);
    const args = call && argsOf(code, call.lists[0].open, call.lists[0].close);
    if (!call || args.length !== 2) continue;
    const nameAt = start + code.slice(start).match(/^const\s+/)[0].length;
    map.set(m[2], { name: m[2], start, end: call.end, nameAt, cond: args[0], reason: args[1], top: depth === 0 });
  }
  return { map, named };
};

// Whether the word at `at` is an object key, `{ word: ...` or `, word: ...`.
const isKey = (code, at, length) => /^\s*:(?!:)/.test(code.slice(at + length, at + length + 80))
  && /[{,]/.test(code.slice(0, at).trimEnd().at(-1));

/**
 * Where `name` is read as a binding in code[s, e): never a member (`.name`)
 * or an object key.
 * @returns {number[]}
 */
export const refsOf = (code, name, s = 0, e = code.length) => {
  const re = new RegExp(`(?<![\\w$.])${escaped(name)}(?![\\w$])`, 'g');
  return [...code.slice(s, e).matchAll(re)].map((m) => s + m.index).filter((at) => !isKey(code, at, name.length));
};

// The names a constant statement declares.
const declared = (code, stmt) => {
  const pattern = code.slice(stmt.start, stmt.end).match(/^const\s+([^=]+?)\s*=/)?.[1] ?? '';
  return [...pattern.matchAll(/[A-Za-z_$][\w$]*(?![\w$]|\s*:)/g)].map((m) => m[0]);
};

// Where a statement reads `name`: its own text, and for a case through an
// alias the condition and reason the mapping writes into it. The first read
// is returned at the statement's own start when it sits in the alias.
const readAt = (code, name, s) => {
  const own = refsOf(code, name, s.start, s.end)[0];
  if (own !== undefined || s.kind !== 'alias') return own;
  const carried = [s.alias.cond, s.alias.reason].some((arg) => refsOf(code, name, arg.s, arg.e).length > 0);
  return carried ? s.start : undefined;
};

/**
 * A constant one group declares and a later group reads, an alias's carried
 * condition and reason included: the later read, or null.
 * @returns {{ at: number, name: string } | null}
 */
export const crossGroupRead = (code, stmts) => {
  const groups = [];
  for (const stmt of stmts) {
    if (stmt.kind === 'group') groups.push([]);
    else if (groups.length) groups.at(-1).push(stmt);
  }
  for (let g = 0; g < groups.length; g += 1) {
    for (const name of groups[g].filter((s) => s.kind === 'const').flatMap((s) => declared(code, s))) {
      for (const later of groups.slice(g + 1)) {
        if (later.some((s) => s.kind === 'const' && declared(code, s).includes(name))) continue;
        const hit = later.map((s) => readAt(code, name, s)).find((at) => at !== undefined);
        if (hit !== undefined) return { at: hit, name };
      }
    }
  }
  return null;
};

/**
 * The first use of a removed word outside the spots the mapping rewrites or drops.
 * @returns {{ at: number, word: string } | null}
 */
export const strayWord = (code, allowed, dropped) => REMOVED
  .flatMap((word) => refsOf(code, word).map((at) => ({ at, word })))
  .filter(({ at }) => !allowed.has(at) && !dropped.some(([s, e]) => at >= s && at < e))
  .sort((a, b) => a.at - b.at)[0] ?? null;

/**
 * The first `expect(...)` call in the masked code with no matcher after it
 * (no `.` follows its close), or -1: an assertion that can never fail.
 * @param {string} code the masked code
 * @returns {number}
 */
export const matcherlessExpect = (code) => {
  for (const m of code.matchAll(/(?<![\w$.])expect\s*\(/g)) {
    const close = closeOf(code, m.index + m[0].length - 1);
    if (close === -1 || code[skipSpace(code, close + 1)] !== '.') return m.index;
  }
  return -1;
};

/**
 * The assert and assertEq calls, each with its parens; one the mapping cannot
 * read is returned as `bad`.
 * @returns {{ calls: object[] } | { bad: RegExpMatchArray }}
 */
export const assertCalls = (code) => {
  const calls = [];
  for (const m of code.matchAll(ASSERT_CALL)) {
    const open = m.index + m[0].length - 1;
    const close = closeOf(code, open);
    const n = close === -1 ? 0 : argsOf(code, open, close).length;
    const ok = m[1] === 'assert' ? n >= 1 && n <= 2 : n >= 2 && n <= 3;
    if (!ok) return { bad: m };
    calls.push({ name: m[1], start: m.index, open, close });
  }
  return { calls };
};
