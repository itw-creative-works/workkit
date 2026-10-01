// README and docs/setup.md links: every relative link and image path in the
// two files resolves to a real file or folder, and the README shows the hero
// and the mark from docs/assets/.
const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, selfRun, summary } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const README = path.join(REPO, 'README.md');
const SETUP = path.join(REPO, 'docs', 'setup.md');

const EXTERNAL = /^(https?:|mailto:|#)/i;

// Code is shown, never followed, so a fenced block or an inline span drops out
// before the links are read.
const withoutCode = (text) => text.replace(/^(```|~~~)[\s\S]*?^\1/gm, '').replace(/`[^`\n]*`/g, '');

// Every markdown link or image target, every <img src> and every srcset path, as written.
const targetsIn = (text) => {
  const prose = withoutCode(text);
  const out = [];
  for (const m of prose.matchAll(/\]\(\s*(<[^>]*>|[^)\s]+)[^)]*\)/g)) out.push(m[1].replace(/^<|>$/g, ''));
  for (const m of prose.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) out.push(m[1]);
  for (const m of prose.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)) for (const one of m[1].split(',')) out.push(one.trim().split(/\s+/)[0]);
  return out;
};

// A relative target's absolute path: from the repo root when it starts at the
// root, else from the file's own folder, with any #fragment stripped.
const resolvedLinks = (file) =>
  targetsIn(fs.readFileSync(file, 'utf8'))
    .filter((t) => !EXTERNAL.test(t))
    .map((t) => {
      const bare = decodeURIComponent(t.replace(/#.*$/, ''));
      const abs = bare.startsWith('/') ? path.join(REPO, bare) : path.resolve(path.dirname(file), bare);
      return { target: t, abs };
    });

const missing = (file) =>
  resolvedLinks(file).filter(({ abs }) => !fs.existsSync(abs)).map(({ target }) => target);

const run = async () => {
  group('README: links and images');

  await test('every relative link and image path in README.md resolves to a file or folder', () => {
    assertEq(missing(README).join(', '), '', 'README.md links that resolve to nothing');
  });

  await test('README.md shows docs/assets/hero.gif and docs/assets/mark.svg, and both exist', () => {
    const linked = resolvedLinks(README).map(({ abs }) => path.relative(REPO, abs).split(path.sep).join('/'));
    for (const asset of ['docs/assets/hero.gif', 'docs/assets/mark.svg']) {
      assert(linked.includes(asset), `README.md has no link or image pointing at ${asset}`);
      assert(fs.statSync(path.join(REPO, asset), { throwIfNoEntry: false })?.isFile(), `${asset} is not a file in the repo`);
    }
  });

  group('docs/setup.md: links');

  await test('every relative link in docs/setup.md resolves to a file or folder', () => {
    assert(fs.existsSync(SETUP), 'docs/setup.md does not exist');
    assertEq(missing(SETUP).join(', '), '', 'docs/setup.md links that resolve to nothing');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
