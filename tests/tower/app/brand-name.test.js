//
// Tests for the dashboard's visible name: every name a user reads says Workkit.
// "tower" stays the folder's name, so ids, classes, paths, commands and comments keep it.
//

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');

const app = path.join(__dirname, '..', '..', '..', 'tower', 'app');
const CONFIG = path.join(app, 'config', 'omega.json5');
const SRC = path.join(app, 'targets', 'web', 'src');

// Every comment form, blanked to spaces so each line keeps its number. A `//`
// or `#` counts only after whitespace or a line start, so `https://` survives;
// `#` only inside the frontmatter, where the body's `#` is a heading.
const blank = (text) => text.replace(/[^\n]/g, ' ');
const blankAfter = (pattern) => (text) => text.replace(pattern, (match, lead) => `${lead}${blank(match.slice(lead.length))}`);
const stripComments = (text) => blankAfter(/(^|[ \t])\/\/[^\n]*/gm)(text
  .replace(/^---\n[\s\S]*?\n---$/m, blankAfter(/(^|[ \t])#[^\n]*/gm))
  .replace(/<!--[\s\S]*?-->/g, blank)
  .replace(/\/\*[\s\S]*?\*\//g, blank));

// The forms no page renders: the folder, the two commands, the bare 'tower'
// mode value code compares against, and a console line.
const EXEMPT = [
  /npm run tower\b/gi,
  /workkit tower\b/gi,
  /^layout:\s*tower\/page\s*$/gim,
  /(['"`])tower\1/g,
  /\bconsole\.\w+\([^\n]*/g,
];

// "tower" glued to a hyphen, slash, underscore or dot is an id, class, data
// attribute or path; a dot only glues when a word follows it, so a sentence's
// closing period still counts.
const isGlued = (line, start, end) => /[-/_.]/.test(line[start - 1] || '')
  || /[-/_]/.test(line[end] || '')
  || (line[end] === '.' && /\w/.test(line[end + 1] || ''));

const offenders = (text) => {
  let clean = stripComments(text);
  for (const form of EXEMPT) clean = clean.replace(form, blank);
  const found = [];
  clean.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(/\btower\b/gi)) {
      if (!isGlued(line, match.index, match.index + match[0].length)) found.push(index + 1);
    }
  });
  return [...new Set(found)];
};

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return walk(full);
  return /\.(html|md|js)$/.test(entry.name) ? [full] : [];
});

const run = async () => {
  group('tower/app: brand name - every name a user reads says Workkit');

  await test('the config\'s brand.name reads Workkit', () => {
    const config = fs.readFileSync(CONFIG, 'utf8');
    const name = config.match(/\bbrand:\s*\{[\s\S]*?\bname:\s*["']([^"']*)["']/);
    assert(name, 'omega.json5 carries a brand block with a name');
    assertEq(name[1], 'Workkit', 'brand.name, capital W');
  });

  await test('no rendered-text string under targets/web/src says tower', () => {
    const files = walk(SRC);
    for (const ext of ['.html', '.md', '.js']) {
      assert(files.some((file) => file.endsWith(ext)), `the walk reaches the dashboard's ${ext} files`);
    }
    const hits = files.flatMap((file) => offenders(fs.readFileSync(file, 'utf8'))
      .map((line) => `${path.relative(SRC, file).split(path.sep).join('/')}:${line}`));
    assertEq(hits.join(', '), '', 'every file:line still saying tower to a user');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
