// Tests for safety:tree-guard's logic, treeGuardVerdict({ command, cwd,
// exists }) in hooks/mods/tree-guard.js: the git commands that discard a
// shared working tree (checkout with a pathspec, a forced switch, restore,
// stash, clean -f, reset --hard) bounce; the escape, read off the command
// alone, stands aside.
// Each case ports the HEAD case its name quotes. Dropped with the shell spawn:
// "malformed JSON: exit 0" and "the loader routes safety:tree-guard to the
// script" (its run line is test/mods/guards-tree-guard.test.ts).

const { group, test, assertEq, summary, selfRun } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

const CWD = '/w/repo';
// The working directory the path probe answers about: `src/app.js` exists, so
// it reads as a pathspec, while `feature/thing` does not and reads as a branch.
const TREE = new Set(['src', 'src/app.js', 'notes.md']);
const exists = async (rel) => TREE.has(rel.replace(/^(\.\/)+/, '').replace(/\/+$/, ''));

const judge = (command) => mods('tree-guard').treeGuardVerdict({ command, cwd: CWD, exists });

const BLOCK = (found) => `tree-guard: BLOCKED this command: it runs ${found}, which discards or parks working-tree state, and this tree is SHARED: reverting your own edits that way takes whatever else is uncommitted with it (issue #157).\nRevert your own changes by reverse-editing your own hunks: edit each file back to what it was. If the discard is genuinely intended, the OWNER reruns the command with WORKKIT_ALLOW_DISCARD=1 in front of it.`;
const ASIDE = (found) => `tree-guard: stood aside for a deliberate discard: WORKKIT_ALLOW_DISCARD=1 is set on this command (${found}).`;

const CHECKOUT = 'git checkout with a pathspec';
const SWITCH = 'git switch --discard-changes/--force';
const RESTORE = 'git restore over the working tree';
const STASH = 'git stash';
const CLEAN = 'git clean -f';
const RESET = 'git reset --hard';

const denyOf = (r) => (r && typeof r.deny === 'string' ? r.deny.replace(/\n$/, '') : null);

const blocks = async (command, found) => {
  const r = await judge(command);
  assertEq(denyOf(r), BLOCK(found), `must block: ${command}`);
};

const passes = async (command) => {
  const r = await judge(command);
  assertEq(denyOf(r), null, `must pass: ${command}`);
  assertEq(textOf(r), '', `silently: ${command}`);
};

const cases = async () => {
  group('tree-guard: git checkout');

  await test('ports "checkout with a pathspec after --: exit 2"', async () => {
    for (const c of ['git checkout -- .', 'git checkout -- src/app.js',
      'git checkout main -- src/app.js', 'git checkout HEAD -- src/app.js notes.md']) {
      await blocks(c, CHECKOUT);
    }
  });

  await test('ports "checkout with . or a path-looking token: exit 2"', async () => {
    for (const c of ['git checkout .', 'git checkout ./src', 'git checkout src/app.js',
      'git checkout notes.md', 'git checkout "src/*.js"']) {
      await blocks(c, CHECKOUT);
    }
  });

  await test('ports "checkout of two operands is the ref+pathspec form: exit 2"', async () => {
    await blocks('git checkout main app.js', CHECKOUT);
  });

  await test('ports "a FORCED branch switch discards the tree too: exit 2"', async () => {
    for (const c of ['git checkout -f main', 'git checkout --force main']) await blocks(c, CHECKOUT);
  });

  await test('ports "a redirection or a comment is not an operand: exit 0"', async () => {
    for (const c of ['git checkout main > /tmp/out', 'git checkout main 2> /tmp/err',
      'git checkout main >/tmp/out', 'git checkout main # words']) {
      await passes(c);
    }
  });

  await test('ports "a redirect\'s & never splits the clause: the discard after it is seen, exit 2"', async () => {
    await blocks('git checkout 2>&1 -- file.txt', CHECKOUT);
    await blocks('git clean 2>&1 -f', CLEAN);
    await blocks('git reset 2>&1 --hard', RESET);
    await blocks('git checkout &>/dev/null -- file.txt', CHECKOUT);
  });

  await test('ports "a word carrying > that is no redirect stays an operand: exit 2"', async () => {
    await blocks('git checkout HEAD~1 file.txt>/dev/null', CHECKOUT);
  });

  await test('ports "a comment does not answer for the command in front of it: exit 0"', async () => {
    for (const c of ['git reset --soft HEAD~1 # not --hard', 'git clean -n # never -f']) await passes(c);
  });

  await test('ports "a plain branch switch stays legal: exit 0"', async () => {
    for (const c of ['git checkout main', 'git checkout -b new', 'git checkout -b new main',
      'git checkout feature/thing', 'git checkout origin/main', 'git checkout -']) {
      await passes(c);
    }
  });

  group('tree-guard: git switch');

  await test('ports "switch that overwrites local modifications: exit 2"', async () => {
    for (const c of ['git switch --discard-changes main', 'git switch -f main', 'git switch --force main']) {
      await blocks(c, SWITCH);
    }
  });

  await test('ports "a plain switch stays legal: exit 0"', async () => {
    for (const c of ['git switch main', 'git switch -c new', 'git switch -c new main',
      'git switch -', 'git switch --create new']) {
      await passes(c);
    }
  });

  group('tree-guard: git restore');

  await test('ports "restore touching the working tree: exit 2"', async () => {
    for (const c of ['git restore src/app.js', 'git restore .', 'git restore --worktree src/app.js',
      'git restore --staged --worktree src/app.js', 'git restore -SW src/app.js', 'git restore']) {
      await blocks(c, RESTORE);
    }
  });

  await test('ports "restore of the INDEX alone is legal: exit 0"', async () => {
    for (const c of ['git restore --staged src/app.js', 'git restore --staged .', 'git restore -S src/app.js']) {
      await passes(c);
    }
  });

  group('tree-guard: git stash, clean, reset');

  await test('ports "every mutating stash spelling: exit 2"', async () => {
    for (const c of ['git stash', 'git stash push -m "wip"', 'git stash push src/app.js',
      'git stash pop', 'git stash apply', 'git stash drop', 'git stash clear', 'git stash save wip']) {
      await blocks(c, STASH);
    }
  });

  await test('ports "read-only stash subcommands: exit 0"', async () => {
    for (const c of ['git stash list', 'git stash show', 'git stash show -p stash@{0}',
      'git -C /other stash list', 'echo start; git stash list; echo done']) {
      await passes(c);
    }
  });

  await test('ports "clean with a force spelling: exit 2"', async () => {
    for (const c of ['git clean -f', 'git clean -fd', 'git clean -fdx', 'git clean -x -f', 'git clean --force']) {
      await blocks(c, CLEAN);
    }
  });

  await test('ports "a dry-run clean is not a discard: exit 0"', async () => {
    for (const c of ['git clean -n', 'git clean --dry-run']) await passes(c);
  });

  await test('ports "reset --hard: exit 2"', async () => {
    for (const c of ['git reset --hard', 'git reset --hard HEAD~1', 'git reset --hard origin/main']) {
      await blocks(c, RESET);
    }
  });

  await test('ports "reset that leaves the tree alone: exit 0"', async () => {
    for (const c of ['git reset --soft HEAD~1', 'git reset HEAD src/app.js', 'git reset']) await passes(c);
  });

  group('tree-guard: where the discard hides');

  await test('ports "a discard mid-compound is found: exit 2"', async () => {
    await blocks('npm test && git checkout -- src/app.js', CHECKOUT);
    await blocks('echo start; git stash pop; echo done', STASH);
    await blocks('npm run build || git reset --hard', RESET);
  });

  await test('ports "a discard aimed at another repo with -C: exit 2"', async () => {
    await blocks('git -C /other stash', STASH);
    await blocks('git -C /other checkout -- .', CHECKOUT);
  });

  await test('ports "wrapper prefixes do not hide it: exit 2"', async () => {
    for (const [c, found] of [
      ['command git stash', STASH], ['env git reset --hard', RESET], ['/usr/bin/git clean -fd', CLEAN],
      ['(git stash pop)', STASH], ['time git stash', STASH], ['builtin command git reset --hard', RESET],
      ['\\git clean -fd', CLEAN], ['if git stash', STASH], ['! git reset --hard', RESET],
      ['2>/dev/null git stash', STASH],
    ]) {
      await blocks(c, found);
    }
  });

  await test('ports "a quoted MENTION is not a command: exit 0"', async () => {
    for (const c of ['echo "never run git stash here"',
      'git commit -m "docs: say why git checkout -- . is banned"',
      'grep -rn "git reset --hard" docs/']) {
      await passes(c);
    }
  });

  await test('ports "a heredoc BODY naming a discard is file content: exit 0"', async () => {
    await passes("cat >> notes.md <<'EOF'\n- never: git checkout -- .\nEOF");
  });

  group('tree-guard: what it never touches');

  await test('ports "ordinary commands: exit 0"', async () => {
    for (const c of ['npm test', 'git status', 'git diff -- src/app.js', 'git add -A',
      'git log --oneline', 'ls -la', 'rm -rf build']) {
      await passes(c);
    }
  });

  await test('ports "a non-git command that merely carries the words: exit 0"', async () => {
    for (const c of ['npm run stash', 'make clean -f Makefile']) await passes(c);
  });

  group('tree-guard: the deliberate discard escapes');

  await test('ports "WORKKIT_ALLOW_DISCARD=1 passes, and says it stood aside"', async () => {
    for (const [c, found] of [
      ['WORKKIT_ALLOW_DISCARD=1 git checkout -- .', CHECKOUT],
      ['WORKKIT_ALLOW_DISCARD=1 git stash pop', STASH],
      ['export WORKKIT_ALLOW_DISCARD=1; git reset --hard', RESET],
    ]) {
      const r = await judge(c);
      assertEq(denyOf(r), null, `the escape passes: ${c}`);
      assertEq(textOf(r), ASIDE(found), `and says so, naming the escape: ${c}`);
    }
  });

  await test('ports "the escape inside a quoted span is not an escape: exit 2"', async () => {
    await blocks('echo "set WORKKIT_ALLOW_DISCARD=1 first" && git stash', STASH);
  });

  await test('ports "the escape without a discard is silent: exit 0"', async () => {
    const r = await judge('WORKKIT_ALLOW_DISCARD=1 npm test');
    assertEq(denyOf(r), null, 'nothing to stand aside from');
    assertEq(textOf(r), '', 'and nothing said');
  });

  group('tree-guard: fail-open and wiring');

  await test('ports "missing command: exit 0": an empty command is silence', async () => {
    await passes('');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
