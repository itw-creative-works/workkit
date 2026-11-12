// The Bash text parsers stay where nothing sees the real action: the files
// under hooks/mods/ that import hooks/mods/command.js, read from their import
// lines, are the kept parsers and nothing else, so a new
// guard that reads command text fails here. The kept set: release-taken's
// publish half, tree-guard, bare-call, unwatched, capture-guard, script-write and optin.js's cd fold.

const fs = require('fs');
const path = require('path');
const { group, test, assertEq, summary, selfRun } = require('../lib/harness');

const MODS = path.join(__dirname, '..', '..', 'hooks', 'mods');
const PARSERS = ['command.js'].map((name) => path.join(MODS, name));
const KEPT = ['bare-call.js', 'capture-guard.js', 'optin.js', 'release-taken.js', 'script-write.js', 'tree-guard.js', 'unwatched.js'];

// A static import or re-export, a bare import, and a dynamic import, each by its quoted specifier.
const IMPORTS = [
  /(?:^|[;\n])\s*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Every .js file under `dir`, recursively. */
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) return walk(full);
  return e.name.endsWith('.js') ? [full] : [];
});

/** The files a module's import lines name, resolved from its folder. */
const importsOf = (file) => {
  const text = fs.readFileSync(file, 'utf8');
  return IMPORTS.flatMap((re) => [...text.matchAll(re)].map((m) => m[1]))
    .filter((spec) => spec.startsWith('.'))
    .map((spec) => path.resolve(path.dirname(file), spec));
};

const cases = async () => {
  group('parsers-kept: who reads Bash command text');

  await test('case 4: the hooks/mods files importing command.js are the kept parsers alone', () => {
    const importers = walk(MODS)
      .filter((file) => importsOf(file).some((target) => PARSERS.includes(target)))
      .map((file) => path.relative(MODS, file).split(path.sep).join('/'))
      .sort();
    assertEq(importers.join(', '), KEPT.join(', '), 'the files that import a command-text parser');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
