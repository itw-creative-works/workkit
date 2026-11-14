// Tests for docs:board-guard's logic in hooks/mods/board-guard.js: boardGuardVerdict (the
// AGENTS.md budget), docShape (paragraph and over-long lines), docShapeVerdict (the ratchet
// against the index copy), inDocSet (the docs.paths set) and boardGuardGather joining them.
// The wiring cases are test/mods/post-tool-use.test.ts.

const path = require('path');
const fs = require('fs');
const {
  describe, test, before, expect,
} = require('../lib/harness');
const { mods, textOf, mergedSettings, runResult } = require('../lib/mods-inputs');
const { mkRepo } = require('../lib/git-repo');
const { caught } = require('../lib/caught');
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

describe('board-guard: scope', () => {
  test('unguarded file: silent exit 0', () => {
    expect(verdict('README.md', 'anything at all'), 'unguarded files are ignored').toBe('');
  });
});

describe('board-guard: CLAUDE.md is not a guard surface', () => {
  test('a content-bearing CLAUDE.md write: silent exit 0', () => {
    expect(verdict('CLAUDE.md', '# My Project\n\nReal instructions here.\n@AGENTS.md\n'), 'a CLAUDE.md write passes').toBe('');
  });
});

describe('board-guard: AGENTS.md size budget', () => {
  test('AGENTS.md at 250 lines: exit 0', () => {
    expect(verdict('AGENTS.md', agentsLines(250)), '250 lines is within budget').toBe('');
  });

  test('AGENTS.md over 250 lines: exit 2 AGENTS BUDGET with offload instruction', () => {
    const out = verdict('AGENTS.md', agentsLines(251));
    expect(out.includes('AGENTS BUDGET'), `names the violation, got: ${out}`).toBeTruthy();
    expect(out.includes('251 lines (max 250)'), `states the count and the limit, got: ${out}`).toBeTruthy();
    expect(out.includes('docs/'), 'tells the writer to offload detail to docs/').toBeTruthy();
  });

  test('a C:\\ spelled AGENTS.md gets the verdict the / spelling gets', () => {
    const judge = (file, text) => textOf(mods('board-guard').boardGuardVerdict(file, text));
    expect(judge('C:\\Users\\ian\\repo\\AGENTS.md', agentsLines(251)), 'over budget, the same bounce').toBe(verdict('AGENTS.md', agentsLines(251)));
    expect(judge('C:\\Users\\ian\\repo\\AGENTS.md', agentsLines(251)).includes('AGENTS BUDGET'), 'and it is a bounce').toBeTruthy();
    expect(judge('C:\\Users\\ian\\repo\\README.md', agentsLines(251)), 'an unguarded file still passes').toBe('');
  });

  test('251 lines with no final newline: still over, exit 2', () => {
    const out = verdict('AGENTS.md', agentsLines(251).trimEnd());
    expect(out.includes('251 lines (max 250)'), `counts every line, got: ${out}`).toBeTruthy();
  });
});

describe('board-guard: AGENTS.md density budget', () => {
  test('a 400-byte line: exit 0 (the boundary passes)', () => {
    expect(verdict('AGENTS.md', `# repo: overview\n${longLine(400)}\n`), '400 bytes is within the density budget').toBe('');
  });

  test('a 401-byte line: exit 2 AGENTS DENSITY naming the line and its length', () => {
    const out = verdict('AGENTS.md', `# repo: overview\n${longLine(401)}\n`);
    expect(out.includes('AGENTS DENSITY'), `names the violation, got: ${out}`).toBeTruthy();
    expect(out.includes('line 2 (401 bytes)'), `names the offender, got: ${out}`).toBeTruthy();
    expect(out.includes('No line may exceed 400 bytes'), `states the limit, got: ${out}`).toBeTruthy();
    expect(out.includes('docs/'), 'tells the writer where the detail goes').toBeTruthy();
  });

  test('a 137-line file with a 3,000-byte line: the count passes, the density bounces', () => {
    const body = Array.from({ length: 135 }, (_, i) => `line ${i}`);
    body.splice(60, 0, longLine(3000));
    const text = `# repo: overview\n${body.join('\n')}\n`;
    expect(text.trimEnd().split('\n').length, 'the fixture is 137 lines').toBe(137);
    const out = verdict('AGENTS.md', text);
    expect(out.length > 0, 'a dense file blocks even well inside 250 lines').toBeTruthy();
    expect(!out.includes('AGENTS BUDGET'), `the line count is not the complaint, got: ${out}`).toBeTruthy();
    expect(out.includes('line 62 (3000 bytes)'), `names the offender, got: ${out}`).toBeTruthy();
  });

  test('many offenders: the first three are named and the rest counted', () => {
    const out = verdict('AGENTS.md', `# repo: overview\n${Array.from({ length: 5 }, () => longLine(500)).join('\n')}\n`);
    for (const n of [2, 3, 4]) expect(out.includes(`line ${n} (500 bytes)`), `names line ${n}, got: ${out}`).toBeTruthy();
    expect(!out.includes('line 5 (500 bytes)'), 'stops after the first few').toBeTruthy();
    expect(out.includes('and 2 more'), `counts the rest, got: ${out}`).toBeTruthy();
  });

  // 370 characters, 410 bytes: the rule judges bytes and the message says so.
  test('a non-ASCII line: judged in bytes, and the message says 410', () => {
    const line = `${'x'.repeat(350)}${WIDE.repeat(20)}`;
    expect(line.length, 'the fixture is 370 characters').toBe(370);
    expect(Buffer.byteLength(line, 'utf8'), 'and 410 bytes').toBe(410);
    const out = verdict('AGENTS.md', `# repo: overview\n${line}\n`);
    expect(out.includes('line 2 (410 bytes)'), `names the byte length, got: ${out}`).toBeTruthy();
  });

  test('the bounce names the spec file that exists', () => {
    const out = verdict('AGENTS.md', agentsLines(251));
    const named = (out.match(/\(spec: (.+?)\)\. Fix these/) || [])[1];
    expect(named, `names a spec path, got: ${out}`).toBeTruthy();
    expect(named.endsWith('docs/project-state.md'), `the spec is docs/project-state.md, got: ${named}`).toBeTruthy();
    const resolved = path.isAbsolute(named) ? named : path.join(REPO, named);
    expect(fs.existsSync(resolved), `and that file exists: ${resolved}`).toBeTruthy();
  });

  test('this repo\'s own AGENTS.md passes the hardened guard', () => {
    const text = fs.readFileSync(path.join(REPO, 'AGENTS.md'), 'utf8');
    expect(verdict('AGENTS.md', text), 'the TOC rewrite must satisfy both halves of the budget').toBe('');
  });
});

describe('board-guard: the markdown shape (docShape)', () => {
  test('case 1: a running-text line 3 is the one prose line', () => {
    const out = shape('# Notes\n\nA line of running text, the shape the check refuses.\n- a bullet\n');
    expect(list(out.prose), 'prose names line 3').toBe('[3]');
    expect(list(out.dense), 'and nothing is dense').toBe('[]');
  });

  test('case 2: every allowed line start is not prose', () => {
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
    expect(list(shape(text).prose), 'no line is prose').toBe('[]');
  });

  test('case 3: running text inside a fenced block or front matter is not prose', () => {
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
    expect(list(shape(text).prose), 'no line is prose').toBe('[]');
  });

  test('case 4: a 401-byte bullet is dense, a 400-byte one is not, and a wide character counts its bytes', () => {
    expect(list(shape(`# Notes\n- ${longLine(399)}\n`).dense), 'the 401-byte bullet is named').toBe('[2]');
    expect(list(shape(`# Notes\n- ${longLine(398)}\n`).dense), 'the 400-byte bullet passes').toBe('[]');
    const wide = `- ${longLine(369)}${WIDE.repeat(10)}`;
    expect(wide.length, 'the wide fixture is 381 characters').toBe(381);
    expect(list(shape(`# Notes\n${wide}\n`).dense), 'and 401 bytes, so it is named').toBe('[2]');
  });

  test('case 5: a 401-byte line inside front matter is not dense, the same line in a fence is', () => {
    const line = `title: ${longLine(394)}`;
    expect(list(shape(`---\n${line}\n---\n# A page\n`).dense), 'front matter has no byte limit').toBe('[]');
    expect(list(shape(`# A page\n\`\`\`\n${line}\n\`\`\`\n`).dense), 'a fence keeps it').toBe('[3]');
  });

  test('case 13: an import line alone is not prose, an @ that starts running text is', () => {
    const text = [
      '# Notes',
      '@AGENTS.md',
      '@node_modules/@omega.js/AGENTS.md',
      '@someone said so',
      '',
    ].join('\n');
    expect(list(shape(text).prose), 'only the running text after @ is prose').toBe('[4]');
  });

  test('case 14: a four-backtick fence holds a three-backtick one, and an info-string line never closes a fence', () => {
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
    expect(list(shape(nested).prose), 'only the line after the four-backtick close is prose').toBe('[8]');
    const info = [
      '# Notes',
      '```',
      '```js',
      'running text the info-string line did not let out',
      '```',
      '',
    ].join('\n');
    expect(list(shape(info).prose), 'the info-string line leaves the fence open').toBe('[]');
  });

  test('case 15: a number and a dot with no space is prose, with a space it is a step', () => {
    expect(list(shape('# Notes\n1.step\n1. step\n').prose), 'only 1.step is prose').toBe('[2]');
  });

  test('case 18: a line opening with three backticks that holds another backtick opens no fence', () => {
    const text = '# Notes\n```code``` is inline\nRunning text after it.\n';
    expect(list(shape(text).prose), 'the inline line and the text after it are prose').toBe('[2,3]');
    expect(list(shape('# Notes\n~~~a`b\nrunning text in a tilde fence\n~~~\n').prose), 'a tilde fence may hold a backtick in its info string').toBe('[]');
  });
});

describe('board-guard: the ratchet (docShapeVerdict)', () => {
  test('the switch off: a new doc full of paragraphs and dense lines passes', () => {
    expect(ratchet('docs/x.md', doc({ prose: 4, dense: 2 }), null, false), 'off judges nothing').toBe('');
  });

  test('a new docs/x.md with one paragraph line: bounced, naming the line', () => {
    const out = ratchet('docs/x.md', '# Notes\n\nA line of running text.\n- a bullet\n', null);
    expect(out.includes(SHAPE_BOUNCE), `a shape bounce, got: ${out}`).toBeTruthy();
    expect(out.includes('DOC PROSE: line 3'), `names line 3, got: ${out}`).toBeTruthy();
  });

  test('a new docs/x.md of headings and bullets: passes', () => {
    expect(ratchet('docs/x.md', '# Notes\n\n## Part\n- a bullet\n  - a sub-bullet\n', null), 'a clean new doc passes').toBe('');
  });

  test('a tracked README.md with 5 paragraph lines: a write leaving 5, reworded, passes, and one leaving 4 passes', () => {
    const before = doc({ prose: 5 });
    expect(ratchet('README.md', doc({ prose: 5, word: 'Reworded' }), before), 'the same count passes').toBe('');
    expect(ratchet('README.md', doc({ prose: 4 }), before), 'a lower count passes').toBe('');
  });

  test('the same README.md and a write leaving 6: bounced naming 6 and 5, and no density line', () => {
    const out = ratchet('README.md', doc({ prose: 6 }), doc({ prose: 5 }));
    expect(out.includes('DOC PROSE: 6 paragraph lines, 5 before'), `names both counts, got: ${out}`).toBeTruthy();
    expect(!out.includes('DOC DENSITY'), `only the count that rose gets a line, got: ${out}`).toBeTruthy();
  });

  test('a tracked doc with 2 lines over 400 bytes: a write leaving 3 is bounced, one leaving 2 passes', () => {
    const before = doc({ dense: 2 });
    const out = ratchet('docs/x.md', doc({ dense: 3 }), before);
    expect(out.includes('DOC DENSITY: 3 lines over 400 bytes, 2 before'), `names both counts, got: ${out}`).toBeTruthy();
    expect(ratchet('docs/x.md', doc({ dense: 2 }), before), 'the same count passes').toBe('');
  });

  test('a write that drops a paragraph line and adds a line over 400 bytes: bounced on the density count alone', () => {
    const out = ratchet('docs/x.md', doc({ prose: 2, dense: 1 }), doc({ prose: 3 }));
    expect(out.includes('DOC DENSITY'), `the density count rose, got: ${out}`).toBeTruthy();
    expect(!out.includes('DOC PROSE'), `the prose count fell, so it has no line, got: ${out}`).toBeTruthy();
  });

  test('an old doc with paragraph lines 1 to 5 and a new one at line 200: the bounce names line 200 and none of the old', () => {
    const old = [
      ...Array.from({ length: 5 }, (_, i) => `Old paragraph ${i}.`),
      ...Array.from({ length: 194 }, (_, i) => `- bullet ${i}`),
    ];
    const out = ratchet('docs/x.md', `${[...old, 'A new paragraph line.'].join('\n')}\n`, `${old.join('\n')}\n`);
    expect(out.includes('DOC PROSE: 6 paragraph lines, 5 before'), `names both counts, got: ${out}`).toBeTruthy();
    expect(list(named(out, 'DOC PROSE')), 'only the added line is named').toBe('["line 200"]');
  });

  test('a new paragraph line whose text equals an old one: the count rose, so the second copy is named', () => {
    const out = ratchet('docs/x.md', '# Notes\nSame text.\n- a bullet\nSame text.\n', '# Notes\nSame text.\n- a bullet\n');
    expect(list(named(out, 'DOC PROSE')), 'the old text excuses one copy, not both').toBe('["line 4"]');
  });

  test('a dense line added above two old ones: the bounce names the added line, not the old ones it moved down', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((ch) => `- ${ch} ${'x'.repeat(446)}`);
    const out = ratchet('docs/x.md', `# Notes\n${c}\n${a}\n${b}\n`, `# Notes\n${a}\n${b}\n`);
    expect(out.includes('DOC DENSITY: 3 lines over 400 bytes, 2 before'), `names both counts, got: ${out}`).toBeTruthy();
    expect(list(named(out, 'DOC DENSITY')), 'only the added line is named').toBe('["line 2 (450 bytes)"]');
  });
});

describe('board-guard: the doc set (inDocSet)', () => {
  test('the default set: root AGENTS.md, root README.md and docs/a/b.md are in it, packages/x/README.md and src/pages/about.md are not', () => {
    for (const rel of ['AGENTS.md', 'README.md', 'docs/a/b.md']) expect(inSet(rel, DEFAULT_SET), `${rel} is in`).toBe(true);
    for (const rel of ['packages/x/README.md', 'src/pages/about.md']) expect(inSet(rel, DEFAULT_SET), `${rel} is out`).toBe(false);
  });

  test('["./"]: every .md in the repo, at any depth', () => {
    for (const rel of ['README.md', 'packages/x/README.md', 'src/pages/about.md']) expect(inSet(rel, ['./']), `${rel} is in`).toBe(true);
  });

  test('["packages/x/"]: packages/x/README.md and a doc deeper under it are in, root README.md is not', () => {
    expect(inSet('packages/x/README.md', ['packages/x/']), 'packages/x/README.md is in').toBe(true);
    expect(inSet('packages/x/docs/deep.md', ['packages/x/']), 'a deeper doc is in').toBe(true);
    expect(inSet('README.md', ['packages/x/']), 'root README.md is out').toBe(false);
  });
});

describe('board-guard: the gather (boardGuardGather)', () => {
  test('docs.bullets off: a paragraph write to docs/x.md passes and the index copy is never asked for', async () => {
    const { out, asked } = await gather('docs/x.md', doc({ prose: 3 }), {});
    expect(out, 'off passes').toBe('');
    expect(asked.before, 'no index read').toBe(0);
  });

  test('the default set: src/pages/about.md full of paragraphs passes, new or tracked, and its index copy is never asked for', async () => {
    for (const before of [null, doc({ prose: 1 })]) {
      const { out, asked } = await gather('src/pages/about.md', doc({ prose: 8, dense: 2 }), on(), before);
      expect(out, `passes with ${before === null ? 'no' : 'an'} index copy`).toBe('');
      expect(asked.before, 'no index read').toBe(0);
    }
  });

  test('the gather judges the set docs.paths names: ["packages/x/"] bounces packages/x/README.md and passes root README.md', async () => {
    expect((await gather('packages/x/README.md', doc({ prose: 1 }), on(['packages/x/']))).out.includes(SHAPE_BOUNCE), 'the named folder is judged').toBeTruthy();
    expect((await gather('README.md', doc({ prose: 1 }), on(['packages/x/']))).out, 'root README.md is not').toBe('');
  });

  test('["./"]: CHANGELOG.md, LICENSE.md and an issue form still pass', async () => {
    for (const rel of ['CHANGELOG.md', 'LICENSE.md', '.github/ISSUE_TEMPLATE/bug.md']) {
      expect((await gather(rel, doc({ prose: 3 }), on(['./']))).out, `${rel} passes`).toBe('');
    }
  });

  test('docs.paths not an array of strings, the switch on: a markdown write is bounced naming the key', async () => {
    const { out } = await gather('docs/x.md', '# Notes\n- a bullet\n', on(['docs/', 7]));
    expect(out.includes('board-guard: docs.paths in the settings is not an array of path strings'), `names the key, got: ${out}`).toBeTruthy();
  });

  test('the repo facts are asked only for a .md write not exempt by name', async () => {
    for (const rel of ['notes.txt', 'CHANGELOG.md', 'LICENSE.md', 'workflow/templates/issue-forms/bug.md']) {
      expect((await gather(rel, doc({ prose: 3 }), on(['./']))).asked.repo, `${rel}: not asked`).toBe(0);
    }
  });

  test('an AGENTS.md over 250 lines, the switch on or off: the budget bounce comes first, and no shape bounce', async () => {
    for (const repoFile of [{}, on()]) {
      const { out } = await gather('AGENTS.md', agentsLines(251), repoFile);
      expect(out.includes('AGENTS BUDGET'), `the budget bounce, got: ${out}`).toBeTruthy();
      expect(!out.includes(SHAPE_BOUNCE), `no shape bounce, got: ${out}`).toBeTruthy();
    }
  });
});

describe('board-guard: the index copy (boardGuardRepo) over a real repo', () => {
  const TRACKED = '# Notes\n- the committed text\n';
  const repoOf = (r, rel, io = ioIn(r.env)) => {
    const file = path.join(r.repo, rel);
    return mods('board-guard').boardGuardRepo(file, path.dirname(file), r.env, io);
  };

  // One repo the read-only cases share: docs/x.md tracked with an unstaged edit, docs/new.md untracked.
  let shared;
  before(() => {
    shared = mkRepo('bg-index', { 'docs/x.md': TRACKED });
    shared.write('docs/x.md', '# Notes\n- an unstaged edit\n');
    shared.write('docs/new.md', '# New\n');
  });

  test('a tracked doc: before resolves the index copy, not the working text', async () => {
    const facts = await repoOf(shared, 'docs/x.md');
    expect(facts.rel, 'the path from the repo root').toBe('docs/x.md');
    expect(await facts.before(), 'the index copy').toBe(TRACKED);
  });

  test('a new doc the index holds no entry for: before resolves null', async () => {
    expect(await (await repoOf(shared, 'docs/new.md')).before(), 'no index copy').toBe(null);
  });

  test('a doc in a merge conflict, the index holding no stage 0: before rejects', async () => {
    const r = mkRepo('bg-conflict', { 'docs/x.md': TRACKED });
    r.git('switch', '-q', '-c', 'side');
    r.write('docs/x.md', '# Notes\n- the side text\n');
    r.git('commit', '-q', '-am', 'side');
    r.git('switch', '-q', 'main');
    r.write('docs/x.md', '# Notes\n- the main text\n');
    r.git('commit', '-q', '-am', 'main');
    // The merge exits 1 on the conflict it leaves, which is the state under test.
    try { r.git('merge', '-q', 'side'); } catch { /* conflicted */ }
    const err = await caught(async () => (await repoOf(r, 'docs/x.md')).before());
    expect(err instanceof Error, 'a conflicted index rejects').toBeTruthy();
  });

  test('git ls-files failing after git show failed: before rejects', async () => {
    const real = ioIn(shared.env);
    const run = async (argv, init) => (argv.includes('ls-files') && argv.includes('--stage')
      ? runResult({ exitCode: 128, stderr: 'fatal: index file corrupt\n' })
      : real.run(argv, init));
    const err = await caught(async () => (await repoOf(shared, 'docs/new.md', { ...real, run })).before());
    expect(err instanceof Error, 'a failed git call rejects, never reads as a new file').toBeTruthy();
  });
});
