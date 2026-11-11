// Tests for docs:board-guard's logic in hooks/mods/board-guard.js: boardGuardVerdict (the
// AGENTS.md budget), docShape (paragraph and over-long lines), docShapeVerdict (the ratchet
// against the index copy), inDocSet (the docs.paths set) and boardGuardGather joining them.
// The wiring cases are test/mods/post-tool-use.test.ts.

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, failureOf, summary, selfRun } = require('../lib/harness');
const { mods, textOf, mergedSettings, runResult } = require('../lib/mods-inputs');
const { mkRepo } = require('../lib/git-repo');
const { ioIn } = require('../../workflow/lib/io');

const REPO = path.join(__dirname, '..', '..');
// A three-byte character, built from its code so this file holds none.
const WIDE = String.fromCharCode(0x2014);
const verdict = (name, text) => textOf(mods('board-guard').boardGuardVerdict(`/w/repo/${name}`, text));
const shape = (text) => mods('board-guard').docShape(text);
const list = (nums) => JSON.stringify(nums);

const SPEC = '/w/kit/docs/project-state.md';
const DEFAULT_SET = ['AGENTS.md', 'README.md', 'docs/'];
const ratchet = (name, text, before, on = true) => textOf(mods('board-guard').docShapeVerdict(`/w/repo/${name}`, text, before, on, SPEC));
const inSet = (rel, paths) => mods('board-guard').inDocSet(rel, paths);
// The offending lines a bounce names for one half, each as `line N` or `line N (M bytes)`.
const named = (out, label) => [...out.matchAll(new RegExp(`${label}: (line \\d+(?: \\(\\d+ bytes\\))?)`, 'g'))].map((m) => m[1]);

// A doc of `prose` paragraph lines and `dense` 450-byte bullets under one heading.
const doc = ({ prose = 0, dense = 0, word = 'Paragraph' } = {}) => [
  '# Notes',
  ...Array.from({ length: prose }, (_, i) => `${word} line ${i}, running text.`),
  ...Array.from({ length: dense }, (_, i) => `- ${i} ${'x'.repeat(446)}`),
  '- a bullet',
  '',
].join('\n');

// boardGuardGather over the merged settings `repoFile` gives, `before` the index copy's text;
// `asked` counts the calls the gather made to `repo` and to `before`.
const gather = async (rel, text, repoFile, before = null) => {
  const settings = await mergedSettings({ repo: { enabled: true, ...repoFile } });
  const asked = { repo: 0, before: 0 };
  const repo = async () => {
    asked.repo += 1;
    return { settings, rel, before: async () => { asked.before += 1; return before; } };
  };
  const out = textOf(await mods('board-guard').boardGuardGather(`/w/repo/${rel}`, text, SPEC, repo));
  return { out, asked };
};
const on = (paths) => ({ docs: paths === undefined ? { bullets: true } : { bullets: true, paths } });
const SHAPE_BOUNCE = 'breaks the markdown shape';

const agentsLines = (n) => `# repo: overview\n${Array.from({ length: n - 1 }, (_, i) => `line ${i}`).join('\n')}\n`;
const longLine = (n) => 'x'.repeat(n);

const cases = async () => {
  group('board-guard: scope');

  await test('unguarded file: silent exit 0', () => {
    assertEq(verdict('README.md', 'anything at all'), '', 'unguarded files are ignored');
  });

  group('board-guard: CLAUDE.md is not a guard surface');

  await test('a content-bearing CLAUDE.md write: silent exit 0', () => {
    assertEq(verdict('CLAUDE.md', '# My Project\n\nReal instructions here.\n@AGENTS.md\n'), '', 'a CLAUDE.md write passes');
  });

  group('board-guard: AGENTS.md size budget');

  await test('AGENTS.md at 250 lines: exit 0', () => {
    assertEq(verdict('AGENTS.md', agentsLines(250)), '', '250 lines is within budget');
  });

  await test('AGENTS.md over 250 lines: exit 2 AGENTS BUDGET with offload instruction', () => {
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

  await test('251 lines with no final newline: still over, exit 2', () => {
    const out = verdict('AGENTS.md', agentsLines(251).trimEnd());
    assert(out.includes('251 lines (max 250)'), `counts every line, got: ${out}`);
  });

  group('board-guard: AGENTS.md density budget');

  await test('a 400-byte line: exit 0 (the boundary passes)', () => {
    assertEq(verdict('AGENTS.md', `# repo: overview\n${longLine(400)}\n`), '', '400 bytes is within the density budget');
  });

  await test('a 401-byte line: exit 2 AGENTS DENSITY naming the line and its length', () => {
    const out = verdict('AGENTS.md', `# repo: overview\n${longLine(401)}\n`);
    assert(out.includes('AGENTS DENSITY'), `names the violation, got: ${out}`);
    assert(out.includes('line 2 (401 bytes)'), `names the offender, got: ${out}`);
    assert(out.includes('No line may exceed 400 bytes'), `states the limit, got: ${out}`);
    assert(out.includes('docs/'), 'tells the writer where the detail goes');
  });

  await test('a 137-line file with a 3,000-byte line: the count passes, the density bounces', () => {
    const body = Array.from({ length: 135 }, (_, i) => `line ${i}`);
    body.splice(60, 0, longLine(3000));
    const text = `# repo: overview\n${body.join('\n')}\n`;
    assertEq(text.trimEnd().split('\n').length, 137, 'the fixture is 137 lines');
    const out = verdict('AGENTS.md', text);
    assert(out.length > 0, 'a dense file blocks even well inside 250 lines');
    assert(!out.includes('AGENTS BUDGET'), `the line count is not the complaint, got: ${out}`);
    assert(out.includes('line 62 (3000 bytes)'), `names the offender, got: ${out}`);
  });

  await test('many offenders: the first three are named and the rest counted', () => {
    const out = verdict('AGENTS.md', `# repo: overview\n${Array.from({ length: 5 }, () => longLine(500)).join('\n')}\n`);
    for (const n of [2, 3, 4]) assert(out.includes(`line ${n} (500 bytes)`), `names line ${n}, got: ${out}`);
    assert(!out.includes('line 5 (500 bytes)'), 'stops after the first few');
    assert(out.includes('and 2 more'), `counts the rest, got: ${out}`);
  });

  // 370 characters, 410 bytes: the rule judges bytes and the message says so.
  await test('a non-ASCII line: judged in bytes, and the message says 410', () => {
    const line = `${'x'.repeat(350)}${WIDE.repeat(20)}`;
    assertEq(line.length, 370, 'the fixture is 370 characters');
    assertEq(Buffer.byteLength(line, 'utf8'), 410, 'and 410 bytes');
    const out = verdict('AGENTS.md', `# repo: overview\n${line}\n`);
    assert(out.includes('line 2 (410 bytes)'), `names the byte length, got: ${out}`);
  });

  await test('the bounce names the spec file that exists', () => {
    const out = verdict('AGENTS.md', agentsLines(251));
    const named = (out.match(/\(spec: (.+?)\)\. Fix these/) || [])[1];
    assert(named, `names a spec path, got: ${out}`);
    assert(named.endsWith('docs/project-state.md'), `the spec is docs/project-state.md, got: ${named}`);
    const resolved = path.isAbsolute(named) ? named : path.join(REPO, named);
    assert(fs.existsSync(resolved), `and that file exists: ${resolved}`);
  });

  await test('this repo\'s own AGENTS.md passes the hardened guard', () => {
    const text = fs.readFileSync(path.join(REPO, 'AGENTS.md'), 'utf8');
    assertEq(verdict('AGENTS.md', text), '', 'the TOC rewrite must satisfy both halves of the budget');
  });

  group('board-guard: the markdown shape (docShape)');

  await test('case 1: a running-text line 3 is the one prose line', () => {
    const out = shape('# Notes\n\nA line of running text, the shape the check refuses.\n- a bullet\n');
    assertEq(list(out.prose), '[3]', 'prose names line 3');
    assertEq(list(out.dense), '[]', 'and nothing is dense');
  });

  await test('case 2: every allowed line start is not prose', () => {
    const text = [
      '# A heading',
      '',
      '- a dash bullet',
      '* a star bullet',
      '+ a plus bullet',
      '  - an indented sub-bullet',
      '1. a numbered step',
      '| a | table row |',
      '> a quote',
      '<!-- an HTML comment -->',
      '<details>',
      '{{task}}',
      '{% if site.repo %}',
      '---',
      '',
    ].join('\n');
    assertEq(list(shape(text).prose), '[]', 'no line is prose');
  });

  await test('case 3: running text inside a fenced block or front matter is not prose', () => {
    const text = [
      '---',
      'title: A page',
      'running text in front matter',
      '---',
      '# A heading',
      '```js',
      'running text in a backtick fence',
      '```',
      '~~~',
      'running text in a tilde fence',
      '~~~',
      '',
    ].join('\n');
    assertEq(list(shape(text).prose), '[]', 'no line is prose');
  });

  await test('case 4: a 401-byte bullet is dense, a 400-byte one is not, and a wide character counts its bytes', () => {
    assertEq(list(shape(`# Notes\n- ${longLine(399)}\n`).dense), '[2]', 'the 401-byte bullet is named');
    assertEq(list(shape(`# Notes\n- ${longLine(398)}\n`).dense), '[]', 'the 400-byte bullet passes');
    const wide = `- ${longLine(369)}${WIDE.repeat(10)}`;
    assertEq(wide.length, 381, 'the wide fixture is 381 characters');
    assertEq(list(shape(`# Notes\n${wide}\n`).dense), '[2]', 'and 401 bytes, so it is named');
  });

  await test('case 5: a 401-byte line inside front matter is not dense, the same line in a fence is', () => {
    const line = `title: ${longLine(394)}`;
    assertEq(list(shape(`---\n${line}\n---\n# A page\n`).dense), '[]', 'front matter has no byte limit');
    assertEq(list(shape(`# A page\n\`\`\`\n${line}\n\`\`\`\n`).dense), '[3]', 'a fence keeps it');
  });

  await test('case 13: an import line alone is not prose, an @ that starts running text is', () => {
    const text = [
      '# Notes',
      '@AGENTS.md',
      '@node_modules/@omega.js/AGENTS.md',
      '@someone said so',
      '',
    ].join('\n');
    assertEq(list(shape(text).prose), '[4]', 'only the running text after @ is prose');
  });

  await test('case 14: a four-backtick fence holds a three-backtick one, and an info-string line never closes a fence', () => {
    const nested = [
      '# Notes',
      '````md',
      '```js',
      'running text in the inner fence',
      '```',
      'running text after the inner close, still in the outer fence',
      '````',
      'Running text after the four-backtick close.',
      '',
    ].join('\n');
    assertEq(list(shape(nested).prose), '[8]', 'only the line after the four-backtick close is prose');
    const info = [
      '# Notes',
      '```',
      '```js',
      'running text the info-string line did not let out',
      '```',
      '',
    ].join('\n');
    assertEq(list(shape(info).prose), '[]', 'the info-string line leaves the fence open');
  });

  await test('case 15: a number and a dot with no space is prose, with a space it is a step', () => {
    assertEq(list(shape('# Notes\n1.step\n1. step\n').prose), '[2]', 'only 1.step is prose');
  });

  await test('case 18: a line opening with three backticks that holds another backtick opens no fence', () => {
    const text = '# Notes\n```code``` is inline\nRunning text after it.\n';
    assertEq(list(shape(text).prose), '[2,3]', 'the inline line and the text after it are prose');
    assertEq(list(shape('# Notes\n~~~a`b\nrunning text in a tilde fence\n~~~\n').prose), '[]', 'a tilde fence may hold a backtick in its info string');
  });

  group('board-guard: the ratchet (docShapeVerdict)');

  await test('the switch off: a new doc full of paragraphs and dense lines passes', () => {
    assertEq(ratchet('docs/x.md', doc({ prose: 4, dense: 2 }), null, false), '', 'off judges nothing');
  });

  await test('a new docs/x.md with one paragraph line: bounced, naming the line', () => {
    const out = ratchet('docs/x.md', '# Notes\n\nA line of running text.\n- a bullet\n', null);
    assert(out.includes(SHAPE_BOUNCE), `a shape bounce, got: ${out}`);
    assert(out.includes('DOC PROSE: line 3'), `names line 3, got: ${out}`);
  });

  await test('a new docs/x.md of headings and bullets: passes', () => {
    assertEq(ratchet('docs/x.md', '# Notes\n\n## Part\n- a bullet\n  - a sub-bullet\n', null), '', 'a clean new doc passes');
  });

  await test('a tracked README.md with 5 paragraph lines: a write leaving 5, reworded, passes, and one leaving 4 passes', () => {
    const before = doc({ prose: 5 });
    assertEq(ratchet('README.md', doc({ prose: 5, word: 'Reworded' }), before), '', 'the same count passes');
    assertEq(ratchet('README.md', doc({ prose: 4 }), before), '', 'a lower count passes');
  });

  await test('the same README.md and a write leaving 6: bounced naming 6 and 5, and no density line', () => {
    const out = ratchet('README.md', doc({ prose: 6 }), doc({ prose: 5 }));
    assert(out.includes('DOC PROSE: 6 paragraph lines, 5 before'), `names both counts, got: ${out}`);
    assert(!out.includes('DOC DENSITY'), `only the count that rose gets a line, got: ${out}`);
  });

  await test('a tracked doc with 2 lines over 400 bytes: a write leaving 3 is bounced, one leaving 2 passes', () => {
    const before = doc({ dense: 2 });
    const out = ratchet('docs/x.md', doc({ dense: 3 }), before);
    assert(out.includes('DOC DENSITY: 3 lines over 400 bytes, 2 before'), `names both counts, got: ${out}`);
    assertEq(ratchet('docs/x.md', doc({ dense: 2 }), before), '', 'the same count passes');
  });

  await test('a write that drops a paragraph line and adds a line over 400 bytes: bounced on the density count alone', () => {
    const out = ratchet('docs/x.md', doc({ prose: 2, dense: 1 }), doc({ prose: 3 }));
    assert(out.includes('DOC DENSITY'), `the density count rose, got: ${out}`);
    assert(!out.includes('DOC PROSE'), `the prose count fell, so it has no line, got: ${out}`);
  });

  await test('an old doc with paragraph lines 1 to 5 and a new one at line 200: the bounce names line 200 and none of the old', () => {
    const old = [
      ...Array.from({ length: 5 }, (_, i) => `Old paragraph ${i}.`),
      ...Array.from({ length: 194 }, (_, i) => `- bullet ${i}`),
    ];
    const out = ratchet('docs/x.md', `${[...old, 'A new paragraph line.'].join('\n')}\n`, `${old.join('\n')}\n`);
    assert(out.includes('DOC PROSE: 6 paragraph lines, 5 before'), `names both counts, got: ${out}`);
    assertEq(list(named(out, 'DOC PROSE')), '["line 200"]', 'only the added line is named');
  });

  await test('a new paragraph line whose text equals an old one: the count rose, so the second copy is named', () => {
    const out = ratchet('docs/x.md', '# Notes\nSame text.\n- a bullet\nSame text.\n', '# Notes\nSame text.\n- a bullet\n');
    assertEq(list(named(out, 'DOC PROSE')), '["line 4"]', 'the old text excuses one copy, not both');
  });

  await test('a dense line added above two old ones: the bounce names the added line, not the old ones it moved down', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((ch) => `- ${ch} ${'x'.repeat(446)}`);
    const out = ratchet('docs/x.md', `# Notes\n${c}\n${a}\n${b}\n`, `# Notes\n${a}\n${b}\n`);
    assert(out.includes('DOC DENSITY: 3 lines over 400 bytes, 2 before'), `names both counts, got: ${out}`);
    assertEq(list(named(out, 'DOC DENSITY')), '["line 2 (450 bytes)"]', 'only the added line is named');
  });

  group('board-guard: the doc set (inDocSet)');

  await test('the default set: root AGENTS.md, root README.md and docs/a/b.md are in it, packages/x/README.md and src/pages/about.md are not', () => {
    for (const rel of ['AGENTS.md', 'README.md', 'docs/a/b.md']) assertEq(inSet(rel, DEFAULT_SET), true, `${rel} is in`);
    for (const rel of ['packages/x/README.md', 'src/pages/about.md']) assertEq(inSet(rel, DEFAULT_SET), false, `${rel} is out`);
  });

  await test('["./"]: every .md in the repo, at any depth', () => {
    for (const rel of ['README.md', 'packages/x/README.md', 'src/pages/about.md']) assertEq(inSet(rel, ['./']), true, `${rel} is in`);
  });

  await test('["packages/x/"]: packages/x/README.md and a doc deeper under it are in, root README.md is not', () => {
    assertEq(inSet('packages/x/README.md', ['packages/x/']), true, 'packages/x/README.md is in');
    assertEq(inSet('packages/x/docs/deep.md', ['packages/x/']), true, 'a deeper doc is in');
    assertEq(inSet('README.md', ['packages/x/']), false, 'root README.md is out');
  });

  group('board-guard: the gather (boardGuardGather)');

  await test('docs.bullets off: a paragraph write to docs/x.md passes and the index copy is never asked for', async () => {
    const { out, asked } = await gather('docs/x.md', doc({ prose: 3 }), {});
    assertEq(out, '', 'off passes');
    assertEq(asked.before, 0, 'no index read');
  });

  await test('the default set: src/pages/about.md full of paragraphs passes, new or tracked, and its index copy is never asked for', async () => {
    for (const before of [null, doc({ prose: 1 })]) {
      const { out, asked } = await gather('src/pages/about.md', doc({ prose: 8, dense: 2 }), on(), before);
      assertEq(out, '', `passes with ${before === null ? 'no' : 'an'} index copy`);
      assertEq(asked.before, 0, 'no index read');
    }
  });

  await test('the gather judges the set docs.paths names: ["packages/x/"] bounces packages/x/README.md and passes root README.md', async () => {
    assert((await gather('packages/x/README.md', doc({ prose: 1 }), on(['packages/x/']))).out.includes(SHAPE_BOUNCE), 'the named folder is judged');
    assertEq((await gather('README.md', doc({ prose: 1 }), on(['packages/x/']))).out, '', 'root README.md is not');
  });

  await test('["./"]: CHANGELOG.md, LICENSE.md and an issue form still pass', async () => {
    for (const rel of ['CHANGELOG.md', 'LICENSE.md', '.github/ISSUE_TEMPLATE/bug.md']) {
      assertEq((await gather(rel, doc({ prose: 3 }), on(['./']))).out, '', `${rel} passes`);
    }
  });

  await test('docs.paths not an array of strings, the switch on: a markdown write is bounced naming the key', async () => {
    const { out } = await gather('docs/x.md', '# Notes\n- a bullet\n', on(['docs/', 7]));
    assert(out.includes('board-guard: docs.paths in the settings is not an array of path strings'), `names the key, got: ${out}`);
  });

  await test('the repo facts are asked only for a .md write not exempt by name', async () => {
    for (const rel of ['notes.txt', 'CHANGELOG.md', 'LICENSE.md', 'workflow/templates/issue-forms/bug.md']) {
      assertEq((await gather(rel, doc({ prose: 3 }), on(['./']))).asked.repo, 0, `${rel}: not asked`);
    }
  });

  await test('an AGENTS.md over 250 lines, the switch on or off: the budget bounce comes first, and no shape bounce', async () => {
    for (const repoFile of [{}, on()]) {
      const { out } = await gather('AGENTS.md', agentsLines(251), repoFile);
      assert(out.includes('AGENTS BUDGET'), `the budget bounce, got: ${out}`);
      assert(!out.includes(SHAPE_BOUNCE), `no shape bounce, got: ${out}`);
    }
  });

  group('board-guard: the index copy (boardGuardRepo) over a real repo');

  const TRACKED = '# Notes\n- the committed text\n';
  const repoOf = (r, rel, io = ioIn(r.env)) => {
    const file = path.join(r.repo, rel);
    return mods('board-guard').boardGuardRepo(file, path.dirname(file), r.env, io);
  };

  // One repo the read-only cases share: docs/x.md tracked with an unstaged edit, docs/new.md untracked.
  const shared = mkRepo('bg-index', { 'docs/x.md': TRACKED });
  shared.write('docs/x.md', '# Notes\n- an unstaged edit\n');
  shared.write('docs/new.md', '# New\n');

  await test('a tracked doc: before resolves the index copy, not the working text', async () => {
    const facts = await repoOf(shared, 'docs/x.md');
    assertEq(facts.rel, 'docs/x.md', 'the path from the repo root');
    assertEq(await facts.before(), TRACKED, 'the index copy');
  });

  await test('a new doc the index holds no entry for: before resolves null', async () => {
    assertEq(await (await repoOf(shared, 'docs/new.md')).before(), null, 'no index copy');
  });

  await test('a doc in a merge conflict, the index holding no stage 0: before rejects', async () => {
    const r = mkRepo('bg-conflict', { 'docs/x.md': TRACKED });
    r.git('switch', '-q', '-c', 'side');
    r.write('docs/x.md', '# Notes\n- the side text\n');
    r.git('commit', '-q', '-am', 'side');
    r.git('switch', '-q', 'main');
    r.write('docs/x.md', '# Notes\n- the main text\n');
    r.git('commit', '-q', '-am', 'main');
    // The merge exits 1 on the conflict it leaves, which is the state under test.
    try { r.git('merge', '-q', 'side'); } catch { /* conflicted */ }
    const err = await failureOf(async () => (await repoOf(r, 'docs/x.md')).before());
    assert(err instanceof Error, 'a conflicted index rejects');
  });

  await test('git ls-files failing after git show failed: before rejects', async () => {
    const real = ioIn(shared.env);
    const run = async (argv, init) => (argv.includes('ls-files') && argv.includes('--stage')
      ? runResult({ exitCode: 128, stderr: 'fatal: index file corrupt\n' })
      : real.run(argv, init));
    const err = await failureOf(async () => (await repoOf(shared, 'docs/new.md', { ...real, run })).before());
    assert(err instanceof Error, 'a failed git call rejects, never reads as a new file');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
