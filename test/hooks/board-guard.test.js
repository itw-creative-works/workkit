// Tests for docs:board-guard's logic, boardGuardVerdict(path, text) in
// hooks/mods/board-guard.js: AGENTS.md held to its size and density budget.
// Each case ports the HEAD case its name quotes; the wiring cases (no
// file_path, a file that is gone) are test/mods/post-tool-use.test.ts.

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

const REPO = path.join(__dirname, '..', '..');
// A three-byte character, built from its code so this file holds none.
const WIDE = String.fromCharCode(0x2014);
const verdict = (name, text) => textOf(mods('board-guard').boardGuardVerdict(`/w/repo/${name}`, text));

const agentsLines = (n) => `# repo: overview\n${Array.from({ length: n - 1 }, (_, i) => `line ${i}`).join('\n')}\n`;
const longLine = (n) => 'x'.repeat(n);

const run = async () => {
  group('board-guard: scope');

  await test('ports "unguarded file: silent exit 0"', () => {
    assertEq(verdict('README.md', 'anything at all'), '', 'unguarded files are ignored');
  });

  group('board-guard: CLAUDE.md is not a guard surface');

  await test('ports "a content-bearing CLAUDE.md write: silent exit 0"', () => {
    assertEq(verdict('CLAUDE.md', '# My Project\n\nReal instructions here.\n@AGENTS.md\n'), '', 'a CLAUDE.md write passes');
  });

  group('board-guard: AGENTS.md size budget');

  await test('ports "AGENTS.md at 250 lines: exit 0"', () => {
    assertEq(verdict('AGENTS.md', agentsLines(250)), '', '250 lines is within budget');
  });

  await test('ports "AGENTS.md over 250 lines: exit 2 AGENTS BUDGET with offload instruction"', () => {
    const out = verdict('AGENTS.md', agentsLines(251));
    assert(out.includes('AGENTS BUDGET'), `names the violation, got: ${out}`);
    assert(out.includes('251 lines (max 250)'), `states the count and the limit, got: ${out}`);
    assert(out.includes('docs/'), 'tells the writer to offload detail to docs/');
  });

  await test('a C:\\ spelled AGENTS.md gets the verdict the / spelling gets', () => {
    const judge = (file, text) => textOf(mods('board-guard').boardGuardVerdict(file, text));
    assertEq(judge('C:\\Users\\ian\\repo\\AGENTS.md', agentsLines(251)), verdict('AGENTS.md', agentsLines(251)), 'over budget, the same bounce');
    assert(judge('C:\\Users\\ian\\repo\\AGENTS.md', agentsLines(251)).includes('AGENTS BUDGET'), 'and it is a bounce');
    assertEq(judge('C:\\Users\\ian\\repo\\README.md', agentsLines(251)), '', 'an unguarded file still passes');
  });

  await test('ports "251 lines with no final newline: still over, exit 2"', () => {
    const out = verdict('AGENTS.md', agentsLines(251).trimEnd());
    assert(out.includes('251 lines (max 250)'), `counts every line, got: ${out}`);
  });

  group('board-guard: AGENTS.md density budget');

  await test('ports "a 400-byte line: exit 0 (the boundary passes)"', () => {
    assertEq(verdict('AGENTS.md', `# repo: overview\n${longLine(400)}\n`), '', '400 bytes is within the density budget');
  });

  await test('ports "a 401-byte line: exit 2 AGENTS DENSITY naming the line and its length"', () => {
    const out = verdict('AGENTS.md', `# repo: overview\n${longLine(401)}\n`);
    assert(out.includes('AGENTS DENSITY'), `names the violation, got: ${out}`);
    assert(out.includes('line 2 (401 bytes)'), `names the offender, got: ${out}`);
    assert(out.includes('No line may exceed 400 bytes'), `states the limit, got: ${out}`);
    assert(out.includes('docs/'), 'tells the writer where the detail goes');
  });

  await test('ports "a 137-line file with a 3,000-byte line: the count passes, the density bounces"', () => {
    const body = Array.from({ length: 135 }, (_, i) => `line ${i}`);
    body.splice(60, 0, longLine(3000));
    const text = `# repo: overview\n${body.join('\n')}\n`;
    assertEq(text.trimEnd().split('\n').length, 137, 'the fixture is 137 lines');
    const out = verdict('AGENTS.md', text);
    assert(out.length > 0, 'a dense file blocks even well inside 250 lines');
    assert(!out.includes('AGENTS BUDGET'), `the line count is not the complaint, got: ${out}`);
    assert(out.includes('line 62 (3000 bytes)'), `names the offender, got: ${out}`);
  });

  await test('ports "many offenders: the first three are named and the rest counted"', () => {
    const out = verdict('AGENTS.md', `# repo: overview\n${Array.from({ length: 5 }, () => longLine(500)).join('\n')}\n`);
    for (const n of [2, 3, 4]) assert(out.includes(`line ${n} (500 bytes)`), `names line ${n}, got: ${out}`);
    assert(!out.includes('line 5 (500 bytes)'), 'stops after the first few');
    assert(out.includes('and 2 more'), `counts the rest, got: ${out}`);
  });

  // 370 characters, 410 bytes: the rule judges bytes and the message says so.
  await test('ports "a non-ASCII line: judged in bytes, and the message says 410"', () => {
    const line = `${'x'.repeat(350)}${WIDE.repeat(20)}`;
    assertEq(line.length, 370, 'the fixture is 370 characters');
    assertEq(Buffer.byteLength(line, 'utf8'), 410, 'and 410 bytes');
    const out = verdict('AGENTS.md', `# repo: overview\n${line}\n`);
    assert(out.includes('line 2 (410 bytes)'), `names the byte length, got: ${out}`);
  });

  await test('ports "the bounce names the spec file that exists"', () => {
    const out = verdict('AGENTS.md', agentsLines(251));
    const named = (out.match(/\(spec: (.+?)\)\. Fix these/) || [])[1];
    assert(named, `names a spec path, got: ${out}`);
    assert(named.endsWith('docs/project-state.md'), `the spec is docs/project-state.md, got: ${named}`);
    const resolved = path.isAbsolute(named) ? named : path.join(REPO, named);
    assert(fs.existsSync(resolved), `and that file exists: ${resolved}`);
  });

  await test('ports "this repo\'s own AGENTS.md passes the hardened guard"', () => {
    const text = fs.readFileSync(path.join(REPO, 'AGENTS.md'), 'utf8');
    assertEq(verdict('AGENTS.md', text), '', 'the TOC rewrite must satisfy both halves of the budget');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
