// The mapping half of `workkit convert` (test/convert.js): the old shape's
// words written onto Node's test functions through the door, over what
// lib/convert-read.js read: the require line, the runner as describes and
// cases, each skip and testUnless alias, and every assertion.

import { REMOVED, maskOf, argsOf, topOf, assertCalls } from './convert-read.js';

// A runner operand that needs parentheses inside `c ? r : false`: a lower
// operator at its top.
const LOOSE_OPERAND = /\|\||\?\?|\?(?!\.)|(?<![=!<>])=(?!=)|,/;

/**
 * The text with every assert and assertEq mapped onto expect, inner calls
 * first: `assert(v, m)` to `expect(v, m).toBeTruthy()`, `assertEq(a, w, m)`
 * to `expect(a, m).toBe(w)`.
 * @param {string} text the source
 * @returns {string}
 */
export const mapAssertions = (text) => {
  const { code } = maskOf(text);
  const { calls } = assertCalls(code);
  const emit = (s, e) => {
    let out = '';
    let at = s;
    for (const call of calls) {
      if (call.start < at || call.close >= e) continue;
      const args = argsOf(code, call.open, call.close).map(({ s: a, e: b }) => emit(a, b));
      const mapped = call.name === 'assert'
        ? `expect(${emit(call.open + 1, call.close)}).toBeTruthy()`
        : `expect(${[args[0], ...args.slice(2)].join(', ')}).toBe(${args[1]})`;
      out += `${text.slice(at, call.start)}${mapped}`;
      at = call.close + 1;
    }
    return `${out}${text.slice(at, e)}`;
  };
  return emit(0, text.length);
};

/**
 * The runner rewritten at the top level: each group a describe around the
 * cases under it, each case mapped, each constant kept; the summary and each
 * alias line of kind `aliasDecl` dropped.
 * @param {string} text the source
 * @param {string} code its masked code
 * @param {boolean[]} inTemplate per line, whether a template was open at its start
 * @param {{ open: number, close: number }} runner the runner's body
 * @param {object[]} stmts the runner's statements
 * @returns {string}
 */
export const runnerOut = (text, code, inTemplate, runner, stmts) => {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') lineStarts.push(i + 1);
  const templateAt = new Set(lineStarts.filter((_, n) => inTemplate[n]));
  const first = stmts[0].start;
  const indent = first - text.lastIndexOf('\n', first) - 1;
  // A range of the text, its lines moved out one level when `top`.
  const slice = (s, e, top) => {
    if (!top) return text.slice(s, e);
    let out = '';
    for (let i = s; i < e; i += 1) {
      if ((i === 0 || text[i - 1] === '\n') && !templateAt.has(i)) {
        let n = 0;
        while (n < indent && text[i + n] === ' ' && i + n < e) n += 1;
        i += n;
        if (i >= e) break;
      }
      out += text[i];
    }
    return out;
  };
  const operand = ({ s, e }) => (LOOSE_OPERAND.test(topOf(code, s, e)) ? `(${text.slice(s, e)})` : text.slice(s, e));
  // A gated case: `test(name, { skip: cond ? reason : false }, fn)`, its name and
  // case from `list`. Node labels a case skipped for a `skip` of `''`, `0` or
  // `null` (and cancels a describe's children), so a falsy cond reaches it as false.
  const gated = (list, cond, reason, top) => {
    const [name] = argsOf(code, list.open, list.close);
    return `test(${slice(list.open + 1, name.e, top)}, { skip: ${operand(cond)} ? ${operand(reason)} : false }${slice(name.e, list.close, top)});`;
  };
  const mapped = (stmt, top) => {
    if (stmt.kind === 'const') return slice(stmt.start, stmt.end, top);
    if (stmt.kind === 'test') return slice(stmt.callee, stmt.end, top);
    const [one, two] = stmt.lists;
    if (stmt.kind === 'alias') return gated(one, stmt.alias.cond, stmt.alias.reason, top);
    if (stmt.kind === 'skip') {
      const [, reason] = argsOf(code, one.open, one.close);
      return `test(${slice(one.open + 1, reason.s, top)}{ skip: ${slice(reason.s, reason.e, top)} }${slice(reason.e, one.close, top)});`;
    }
    const [cond, reason] = argsOf(code, one.open, one.close);
    return gated(two, cond, reason, top);
  };
  let out = '';
  let inGroup = false;
  let prev = runner.open + 1;
  const firstGap = text.slice(prev, first);
  if (/^[ \t]*\n/.test(firstGap)) prev += firstGap.indexOf('\n') + 1;
  const end = { kind: 'end', start: stmts.find((s) => s.kind === 'summary')?.start ?? runner.close };
  let opened = false;
  // The lines of each alias dropped since the last statement written: its
  // comment stays in the gap, above the statement that follows.
  let cuts = [];
  const gapTo = (to, top) => {
    let gap = '';
    let at = prev;
    for (const [s, e] of cuts) {
      gap += slice(at, s, top);
      at = e;
    }
    gap += slice(at, to, top);
    cuts = [];
    return out === '' ? gap.replace(/^(?:[ \t]*\n)+/, '') : gap;
  };
  for (const stmt of [...stmts.filter((s) => s.kind !== 'summary'), end]) {
    if (stmt.kind === 'end') {
      const kept = gapTo(stmt.start, !inGroup).trimEnd();
      if (kept.trim()) out += kept;
      if (inGroup) out += '\n});';
      break;
    }
    if (stmt.kind === 'aliasDecl') {
      cuts.push(lineRange(text, stmt.start, stmt.end));
      continue;
    }
    if (stmt.kind === 'group') {
      if (inGroup) out += '\n});';
      out += `${gapTo(stmt.start, true)}describe(${slice(stmt.args.open + 1, stmt.args.close, true)}, () => {`;
      inGroup = true;
    } else {
      // A describe's first line sits right under its head, with no blank line.
      const lead = gapTo(stmt.start, !inGroup);
      out += `${opened ? lead.replace(/^[ \t]*\n(?:[ \t]*\n)+/, '\n') : lead}${mapped(stmt, !inGroup)}`;
    }
    opened = stmt.kind === 'group';
    prev = stmt.end;
  }
  return out;
};

/**
 * The whole lines a dropped statement holds, from the start of its first
 * through the newline of its last, plus the blank line after when one sits
 * before it too, so a drop leaves one blank at most. The lines around it,
 * a comment above included, stay.
 * @returns {[number, number]}
 */
export const lineRange = (text, s, e) => {
  const start = text.lastIndexOf('\n', s - 1) + 1;
  let end = text.indexOf('\n', e);
  end = end === -1 ? text.length : end + 1;
  if (text.slice(0, start).endsWith('\n\n') && /^[ \t]*\n/.test(text.slice(end))) end = text.indexOf('\n', end) + 1;
  return [start, end];
};

/**
 * The require line on the door's names the converted file takes: describe,
 * test and expect as it needs them, then every other helper it took, in its
 * order, every removed word gone; one line or several as the original was.
 * @param {{ names: string[], spec: string, multiline: boolean }} req the harness require
 * @param {boolean} hasGroups whether the runner holds a group
 * @param {boolean} hasAssertions whether the file calls assert or assertEq
 * @returns {string}
 */
export const requireLine = (req, hasGroups, hasAssertions) => {
  const kept = req.names.filter((part) => !REMOVED.includes(part) && part !== 'test');
  const lead = [
    ...(hasGroups ? ['describe'] : []),
    'test',
    ...(hasAssertions || kept.includes('expect') ? ['expect'] : []),
  ];
  const names = [...lead, ...kept.filter((part) => !lead.includes(part))];
  return req.multiline
    ? `const {\n  ${names.join(', ')},\n} = require(${req.spec});`
    : `const { ${names.join(', ')} } = require(${req.spec});`;
};
