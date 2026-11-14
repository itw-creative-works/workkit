/* eslint-disable no-console */
// `workkit convert [paths...]`: a suite in the kit harness's old shape, a
// runner function the file exports, rewritten in place onto Node's test
// functions through the door. Only a runner holding labels, cases and
// constants alone is rewritten; any other file is named with the line that stopped it.

import fs from 'node:fs';
import vm from 'node:vm';
import { findSuites, suiteName } from './lib/suites.js';
import { unmatchedLine, writtenPaths, namedSuites } from './lib/suite-path.js';
import {
  maskOf, lineOf, pairingBreak, frameOf, harnessRequire, aliasesOf, statementsOf,
  assertCalls, strayWord, refsOf, crossGroupRead, matcherlessExpect,
} from './lib/convert-read.js';
import { nestedTemplateAt } from './lib/lexer.js';
import { mapAssertions, runnerOut, lineRange, requireLine } from './lib/convert-map.js';

const CASE_KINDS = ['test', 'skip', 'testUnless', 'alias'];

// Whether the text compiles as a CommonJS module body; the message when not.
const compileError = (text, filename) => {
  try {
    vm.compileFunction(text, ['exports', 'require', 'module', '__filename', '__dirname'], { filename });
    return null;
  } catch (err) {
    return err.message;
  }
};

// The conversion of a text with `\n` line ends alone.
const convertLines = (text, filename) => {
  const left = (at, why) => ({ line: lineOf(text, at), why });
  // The line lexer misreads a nested template, so no mask of such a file is trusted.
  const nested = nestedTemplateAt(text);
  if (nested !== -1) return left(nested, 'a template literal nested in another template\'s placeholder');
  const { code, inTemplate } = maskOf(text);
  const broke = pairingBreak(code);
  if (broke !== -1) return left(broke, 'brackets the kit lexer cannot pair from here, so no statement can be read');
  const frame = frameOf(code);
  if (frame.why) return left(frame.at, frame.why);
  const { runner } = frame;
  const req = harnessRequire(text, code);
  if (!req) return left(runner.start, 'no harness require line to rewrite');
  if (req.renamed) return left(req.start, `the harness require renames ${req.renamed}`);
  const aliases = aliasesOf(code, runner);
  const { stmts, stop } = statementsOf(code, runner.open + 1, runner.close, aliases);
  if (stop) return left(stop.at, stop.why);
  const cases = stmts.filter((s) => CASE_KINDS.includes(s.kind)).length;
  if (cases === 0) return left(runner.start, 'the runner holds no case');
  // An alias goes when every read of it is a case the mapping rewrites; one
  // read anywhere else keeps its line, whose testUnless then leaves the file.
  const callees = new Set(stmts.filter((s) => s.kind === 'alias').map((s) => s.callee));
  const gone = [...aliases.map.values()].filter((a) => refsOf(code, a.name).every((at) => at === a.nameAt || callees.has(at)));
  for (const s of stmts.filter((x) => x.kind === 'aliasDecl' && !gone.some((a) => a.start === x.start))) s.kind = 'const';
  const drops = [...frame.drops, ...gone.filter((a) => a.top)];
  const asserts = assertCalls(code);
  if (asserts.bad) return left(asserts.bad.index, `an ${asserts.bad[1]} whose arguments the mapping cannot read`);
  const allowed = new Set([
    ...asserts.calls.map((c) => c.start),
    ...stmts.map((s) => (s.kind === 'group' ? s.start : s.callee)).filter((at) => at !== undefined),
  ]);
  const dropped = [req, ...drops, ...stmts.filter((s) => s.kind === 'summary' || s.kind === 'aliasDecl')].map((r) => [r.start, r.end]);
  const stray = strayWord(code, allowed, dropped);
  if (stray) return left(stray.at, `uses ${stray.word}, which has no mapped form here`);
  const outside = [...dropped, [runner.start, runner.end]];
  const within = (at) => outside.some(([s, e]) => at >= s && at < e);
  if (runner.name) {
    const other = refsOf(code, runner.name).find((at) => !within(at));
    if (other !== undefined) return left(other, `the runner ${runner.name} is read outside its export`);
  }
  const cross = crossGroupRead(code, stmts);
  if (cross) return left(cross.at, `${cross.name}, a constant of an earlier group, read in a later one`);
  const after = [...code.slice(runner.end)].findIndex((c, i) => /\S/.test(c) && !within(runner.end + i));
  if (after !== -1) return left(runner.end + after, 'code after the runner, which its describe bodies would reach before it runs');
  const edits = [
    { s: req.start, e: req.end, out: requireLine(req, stmts.some((s) => s.kind === 'group'), asserts.calls.length > 0) },
    { s: runner.start, e: runner.end, out: runnerOut(text, code, inTemplate, runner, stmts) },
    ...drops.map((r) => {
      const [s, e] = lineRange(text, r.start, r.end);
      return { s, e, out: '' };
    }),
  ].sort((a, b) => a.s - b.s);
  let out = '';
  let at = 0;
  for (const edit of edits) {
    out += `${text.slice(at, edit.s)}${edit.out}`;
    at = edit.e;
  }
  out = mapAssertions(`${out}${text.slice(at)}`).replace(/\s*$/, '\n');
  const broken = compileError(out, filename);
  if (broken) return left(runner.start, `the converted text would not parse (${broken})`);
  // The last guard: an expect the mapping wrote with no matcher after it can never fail.
  if (matcherlessExpect(maskOf(out).code) !== -1) return left(runner.start, 'the converted text would hold an expect with no matcher');
  return { text: out, cases };
};

/**
 * One suite's text converted from the old shape onto Node's test functions.
 * A text whose every line ends in CRLF keeps CRLF on every line, written ones too.
 * @param {string} text the suite's source
 * @param {string} [filename] its path, for the compile check's messages
 * @returns {{ text: string, cases: number } | { line: number, why: string }}
 *   the new text and its case count, or the line that stopped it and why
 */
export const convertText = (text, filename = 'suite.js') => {
  if (!text.includes('\r\n') || /(?:^|[^\r])\n/.test(text)) return convertLines(text, filename);
  const res = convertLines(text.replaceAll('\r\n', '\n'), filename);
  return 'text' in res ? { ...res, text: res.text.replaceAll('\n', '\r\n') } : res;
};

/**
 * The verb: each named suite, or every suite under the cwd, converted in
 * place or left, one line each; exit 0 once it ran. A path is read as the
 * runner reads one, from the cwd with `\` as `/`; one naming no suite there
 * is `No suite matches <arg>`, exit 1, before any file is written.
 * @param {string[]} args the suite paths, none for every suite
 */
export const main = (args) => {
  const root = process.cwd();
  const all = findSuites(root);
  const named = writtenPaths(args);
  const miss = unmatchedLine(root, all, named);
  if (miss !== null) {
    console.error(miss);
    process.exitCode = 1;
    return;
  }
  for (const file of named.length ? namedSuites(root, named) : all) {
    const name = suiteName(root, file);
    const res = convertText(fs.readFileSync(file, 'utf8'), file);
    if ('why' in res) {
      console.log(`left ${name}:${res.line} ${res.why}`);
    } else {
      fs.writeFileSync(file, res.text);
      console.log(`converted ${name} (${res.cases} case${res.cases === 1 ? '' : 's'})`);
    }
  }
};
