// Tests for safety:script-write's logic, scriptWriteVerdict(command) in hooks/mods/script-write.js:
// a Bash command that rewrites a file in place (sed or perl with an in-place flag, or a python or node
// snippet that writes a file) is denied, so every file edit goes through the tools the write hooks see;
// WORKKIT_ALLOW_SCRIPT_WRITE=1 on the command stands the guard aside, and says so.

const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

const judge = (command) => mods('script-write').scriptWriteVerdict(command);

const PREFIX = 'script-write: BLOCKED this command:';
const ESCAPE = 'WORKKIT_ALLOW_SCRIPT_WRITE';

const denyOf = (r) => (r && typeof r.deny === 'string' ? r.deny : null);

// A refusal opens with the guard's prefix, names the tool it found and the escape.
const refuses = async (command, tool) => {
  const deny = denyOf(await judge(command));
  assert(deny !== null, `must refuse: ${command}`);
  assert(deny.startsWith(PREFIX), `opens with the prefix: ${command}, got: ${deny}`);
  assert(deny.includes(tool), `names ${tool}: ${command}, got: ${deny}`);
  assert(deny.includes(ESCAPE), `names the escape: ${command}, got: ${deny}`);
};

const passes = async (command) => {
  const r = await judge(command);
  assertEq(denyOf(r), null, `must pass: ${command}`);
  assertEq(textOf(r), '', `silently: ${command}`);
};

const cases = async () => {
  group('script-write: sed and perl in place');

  await test('every in-place spelling of sed and perl is refused', async () => {
    for (const [c, tool] of [
      ["sed -i 's/a/b/' src/x.js", 'sed'],
      ["sed -i '' -e 's/a/b/' x", 'sed'],
      ["sed -E -i.bak 's/a/b/' x", 'sed'],
      ["sed --in-place 's/a/b/' x", 'sed'],
      ["perl -pi -e 's/a/b/' x", 'perl'],
    ]) {
      await refuses(c, tool);
    }
  });

  await test('sed and perl that only read, or write through a redirect, pass', async () => {
    for (const c of ["sed -n '1,5p' x", "sed 's/a/b/' x > y", "perl -ne 'print' x"]) await passes(c);
  });

  await test('perl with a module flag and no in-place flag passes', async () => {
    await passes("perl -Mstrict -ne 'print' x");
  });

  await test('perl asked its version passes: -version, -v and -V:version', async () => {
    for (const c of ['perl -version', 'perl -v', 'perl -V:version']) await passes(c);
  });

  group('script-write: a python or node snippet');

  await test('a snippet that writes a file is refused: python -c, a python heredoc, node -e', async () => {
    for (const [c, tool] of [
      [`python3 -c "open('x.js','w').write(s)"`, 'python'],
      ["python3 - <<'EOF'\nfrom pathlib import Path\nPath(p).write_text(t)\nEOF", 'python'],
      [`node -e "fs.writeFileSync('x', t)"`, 'node'],
    ]) {
      await refuses(c, tool);
    }
  });

  await test('every python open form that writes is refused: a joined path, Path.open, a read-plus mode', async () => {
    for (const c of [
      `python3 -c "open(os.path.join('a','b'), 'w').write(s)"`,
      `python3 -c "Path(p).open('w').write(t)"`,
      `python3 -c "open(p, 'r+').write(t)"`,
    ]) {
      await refuses(c, 'python');
    }
  });

  await test('a writing snippet is refused through node --eval, -p and --print, and python3 -Bc', async () => {
    for (const [c, tool] of [
      [`node --eval "fs.writeFileSync('x', t)"`, 'node'],
      [`node -p "fs.writeFileSync('x', t)"`, 'node'],
      [`node --print "fs.appendFileSync('x', t)"`, 'node'],
      [`python3 -Bc "open('x.js','w').write(s)"`, 'python'],
    ]) {
      await refuses(c, tool);
    }
  });

  await test("a snippet flag after the script name is the script's own argument, and passes", async () => {
    for (const c of [
      'node build.js -p writeFile',
      `python3 tool.py -c "open('x','w')"`,
      `python3 -m tool -c "open('x','w')"`,
    ]) {
      await passes(c);
    }
  });

  await test("a writing snippet after a flag's value is still refused: node -r, python3 -W", async () => {
    for (const [c, tool] of [
      [`node -r ./setup.js -e "fs.writeFileSync('x', t)"`, 'node'],
      [`python3 -W ignore -c "open('x','w')"`, 'python'],
    ]) {
      await refuses(c, tool);
    }
  });

  await test('a writing snippet after the value of an unlisted flag or a redirect is still refused', async () => {
    for (const [c, tool] of [
      [`node --input-type module -e "fs.writeFileSync('x',t)"`, 'node'],
      [`node --env-file .env -e "fs.writeFileSync('x',t)"`, 'node'],
      [`node 2>/dev/null -e "fs.writeFileSync('x',t)"`, 'node'],
      [`python3 --check-hash-based-pycs always -c "open('x','w')"`, 'python'],
    ]) {
      await refuses(c, tool);
    }
  });

  await test('a quoted script argument in an earlier step leaves a later writing snippet refused', async () => {
    await refuses(`python3 tool.py "a b" && python3 -c "open('x','w')"`, 'python');
  });

  await test('a snippet that only reads a file passes', async () => {
    for (const c of [`python3 -c "print(open('x').read())"`, `node -e "console.log(fs.readFileSync('x','utf8'))"`]) {
      await passes(c);
    }
  });

  // An escaped quote that parses two ways makes sixty of them never finish: a hang here is the break,
  // and the runner's suite deadline is what reports it.
  await test('a snippet of sixty escaped-quote arguments is judged, not hung on', async () => {
    const quoted = String.raw`\"a\"`;
    const joined = `os.path.join(${Array(60).fill(quoted).join(', ')})`;
    await passes(`python3 -c "f = open(${joined})"`);
    await refuses(`python3 -c "f = open(${joined}, 'w')"`, 'python3');
    await passes(`python3 -c "x = open(${`${quoted} `.repeat(60)}"`);
  });

  group('script-write: a mention is not a command');

  await test('sed -i inside a quoted commit message or an echo passes', async () => {
    for (const c of ['git commit -m "docs: never run sed -i on a tracked file"', 'echo "sed -i is refused here"']) {
      await passes(c);
    }
  });

  group('script-write: the escape');

  await test('WORKKIT_ALLOW_SCRIPT_WRITE=1 in front of a refused command runs it, and the context says it stood aside', async () => {
    for (const c of [
      "WORKKIT_ALLOW_SCRIPT_WRITE=1 sed -i 's/a/b/' src/x.js",
      `WORKKIT_ALLOW_SCRIPT_WRITE=1 python3 -c "open('x.js','w').write(s)"`,
    ]) {
      const r = await judge(c);
      assertEq(denyOf(r), null, `the escape passes: ${c}`);
      const said = r && typeof r.context === 'string' ? r.context : '';
      assert(said.includes('stood aside'), `the context says it stood aside: ${c}, got: ${JSON.stringify(r)}`);
    }
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
