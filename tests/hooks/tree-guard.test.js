/* eslint-disable no-console */
//
// Tests for hooks/safety/tree-guard — the PreToolUse hook that blocks the git
// commands which DISCARD a working tree (checkout with a pathspec, restore,
// stash, clean -f, reset --hard), because the tree is shared: an agent
// reverting its own edits that way takes another agent's with it (issue #157).
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary } = require('../lib/harness');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'safety', 'tree-guard', 'run.sh');

// A working directory the path probe can answer about: `src/app.js` exists here,
// so it reads as a pathspec, while `feature/thing` does not and reads as a branch.
const mkTree = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-test-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'const x = 1;\n');
  fs.writeFileSync(path.join(dir, 'notes.md'), '# notes\n');
  return dir;
};
const rmTree = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const runHook = (command, cwd) => {
  const res = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ cwd, tool_input: { command } }),
    env: { ...process.env, HOME: os.homedir() },
    encoding: 'utf8',
    timeout: 30000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

// The stand-aside message, off the hook's JSON stdout — the channel a
// PreToolUse hook exiting 0 is heard on (the shape commit-gate's stand-down
// uses). Empty stdout is no message, and is returned as such.
const asideMessage = (out) => {
  if (!out.stdout.trim()) return '';
  const parsed = JSON.parse(out.stdout);
  assertEq(parsed.hookSpecificOutput.hookEventName, 'PreToolUse', 'the event name the harness expects');
  assertEq(parsed.hookSpecificOutput.additionalContext, parsed.systemMessage, 'the user and the model hear the same line');
  assert(parsed.permissionDecision === undefined, 'standing aside never decides the command');
  return parsed.systemMessage;
};

const blocks = (dir, command) => {
  const out = runHook(command, dir);
  assertEq(out.code, 2, `must block: ${command}, got: ${out.stderr}`);
  assert(out.stderr.includes('tree-guard'), `names itself: ${command}`);
  assert(out.stderr.includes('reverse-edit'), `names the alternative: ${command}, got: ${out.stderr}`);
  assert(out.stderr.includes('WORKKIT_ALLOW_DISCARD=1'), `names the escape: ${command}, got: ${out.stderr}`);
};

const passes = (dir, command) => {
  const out = runHook(command, dir);
  assertEq(out.code, 0, `must pass: ${command}, got: ${out.stderr}`);
  assertEq(out.stderr, '', `silently: ${command}`);
};

const run = async () => {
  group('tree-guard: git checkout');

  await test('checkout with a pathspec after -- — exit 2', () => {
    const dir = mkTree();
    for (const c of ['git checkout -- .', 'git checkout -- src/app.js',
      'git checkout main -- src/app.js', 'git checkout HEAD -- src/app.js notes.md']) {
      blocks(dir, c);
    }
    rmTree(dir);
  });

  await test('checkout with . or a path-looking token — exit 2', () => {
    const dir = mkTree();
    for (const c of ['git checkout .', 'git checkout ./src', 'git checkout src/app.js',
      'git checkout notes.md', 'git checkout "src/*.js"']) {
      blocks(dir, c);
    }
    rmTree(dir);
  });

  await test('checkout of two operands is the ref+pathspec form — exit 2', () => {
    const dir = mkTree();
    blocks(dir, 'git checkout main app.js');
    rmTree(dir);
  });

  await test('a FORCED branch switch discards the tree too — exit 2', () => {
    const dir = mkTree();
    for (const c of ['git checkout -f main', 'git checkout --force main']) blocks(dir, c);
    rmTree(dir);
  });

  await test('a redirection or a comment is not an operand — exit 0', () => {
    // The counter used to walk every remaining word, so a redirection's separate
    // target and a trailing comment read as the second operand of the
    // ref+pathspec form and bounced a legal branch switch.
    const dir = mkTree();
    for (const c of ['git checkout main > /tmp/out', 'git checkout main 2> /tmp/err',
      'git checkout main >/tmp/out', 'git checkout main # words']) {
      passes(dir, c);
    }
    rmTree(dir);
  });

  await test('two REAL operands still block — exit 2', () => {
    const dir = mkTree();
    blocks(dir, 'git checkout a b');
    rmTree(dir);
  });

  await test('a comment does not answer for the command in front of it — exit 0', () => {
    // The same walk fed every subcommand, so a `--hard` or a `-f` sitting in a
    // trailing comment used to block the harmless command carrying it.
    const dir = mkTree();
    for (const c of ['git reset --soft HEAD~1 # not --hard', 'git clean -n # never -f']) {
      passes(dir, c);
    }
    rmTree(dir);
  });

  await test('a plain branch switch stays legal — exit 0', () => {
    const dir = mkTree();
    // The ship PR path uses these, and git refuses them on conflicts anyway.
    for (const c of ['git checkout main', 'git checkout -b new', 'git checkout -b new main',
      'git checkout feature/thing', 'git checkout origin/main', 'git checkout -']) {
      passes(dir, c);
    }
    rmTree(dir);
  });

  group('tree-guard: git switch');

  await test('switch that overwrites local modifications — exit 2', () => {
    const dir = mkTree();
    for (const c of ['git switch --discard-changes main', 'git switch -f main',
      'git switch --force main']) {
      blocks(dir, c);
    }
    rmTree(dir);
  });

  await test('a plain switch stays legal — exit 0', () => {
    // switch takes no pathspec at all, so only the two overwriting spellings are
    // a discard.
    const dir = mkTree();
    for (const c of ['git switch main', 'git switch -c new', 'git switch -c new main',
      'git switch -', 'git switch --create new']) {
      passes(dir, c);
    }
    rmTree(dir);
  });

  group('tree-guard: git restore');

  await test('restore touching the working tree — exit 2', () => {
    const dir = mkTree();
    for (const c of ['git restore src/app.js', 'git restore .', 'git restore --worktree src/app.js',
      'git restore --staged --worktree src/app.js', 'git restore -SW src/app.js', 'git restore']) {
      blocks(dir, c);
    }
    rmTree(dir);
  });

  await test('restore of the INDEX alone is legal — exit 0', () => {
    const dir = mkTree();
    for (const c of ['git restore --staged src/app.js', 'git restore --staged .', 'git restore -S src/app.js']) {
      passes(dir, c);
    }
    rmTree(dir);
  });

  group('tree-guard: git stash, clean, reset');

  await test('every mutating stash spelling — exit 2', () => {
    const dir = mkTree();
    for (const c of ['git stash', 'git stash push -m "wip"', 'git stash push src/app.js',
      'git stash pop', 'git stash apply', 'git stash drop', 'git stash clear', 'git stash save wip']) {
      blocks(dir, c);
    }
    rmTree(dir);
  });

  await test('read-only stash subcommands — exit 0 (issue #193)', () => {
    const dir = mkTree();
    for (const c of ['git stash list', 'git stash show', 'git stash show -p stash@{0}',
      'git -C /other stash list', 'echo start; git stash list; echo done']) {
      passes(dir, c);
    }
    rmTree(dir);
  });

  await test('clean with a force spelling — exit 2', () => {
    const dir = mkTree();
    for (const c of ['git clean -f', 'git clean -fd', 'git clean -fdx', 'git clean -x -f', 'git clean --force']) {
      blocks(dir, c);
    }
    rmTree(dir);
  });

  await test('a dry-run clean is not a discard — exit 0', () => {
    const dir = mkTree();
    for (const c of ['git clean -n', 'git clean --dry-run']) passes(dir, c);
    rmTree(dir);
  });

  await test('reset --hard — exit 2', () => {
    const dir = mkTree();
    for (const c of ['git reset --hard', 'git reset --hard HEAD~1', 'git reset --hard origin/main']) {
      blocks(dir, c);
    }
    rmTree(dir);
  });

  await test('reset that leaves the tree alone — exit 0', () => {
    const dir = mkTree();
    for (const c of ['git reset --soft HEAD~1', 'git reset HEAD src/app.js', 'git reset']) passes(dir, c);
    rmTree(dir);
  });

  group('tree-guard: where the discard hides');

  await test('a discard mid-compound is found — exit 2', () => {
    const dir = mkTree();
    for (const c of ['npm test && git checkout -- src/app.js',
      'echo start; git stash pop; echo done',
      'npm run build || git reset --hard']) {
      blocks(dir, c);
    }
    rmTree(dir);
  });

  await test('a discard aimed at another repo with -C — exit 2', () => {
    const dir = mkTree();
    for (const c of ['git -C /other stash', 'git -C /other checkout -- .']) blocks(dir, c);
    rmTree(dir);
  });

  await test('wrapper prefixes do not hide it — exit 2', () => {
    const dir = mkTree();
    for (const c of ['command git stash', 'env git reset --hard', '/usr/bin/git clean -fd',
      '(git stash pop)']) {
      blocks(dir, c);
    }
    rmTree(dir);
  });

  await test('a quoted MENTION is not a command — exit 0', () => {
    const dir = mkTree();
    for (const c of ['echo "never run git stash here"',
      'git commit -m "docs: say why git checkout -- . is banned"',
      'grep -rn "git reset --hard" docs/']) {
      passes(dir, c);
    }
    rmTree(dir);
  });

  await test('a heredoc BODY naming a discard is file content — exit 0', () => {
    const dir = mkTree();
    passes(dir, "cat >> notes.md <<'EOF'\n- never: git checkout -- .\nEOF");
    rmTree(dir);
  });

  group('tree-guard: what it never touches');

  await test('ordinary commands — exit 0', () => {
    const dir = mkTree();
    for (const c of ['npm test', 'git status', 'git diff -- src/app.js', 'git add -A',
      'git log --oneline', 'ls -la', 'rm -rf build']) {
      passes(dir, c);
    }
    rmTree(dir);
  });

  await test('a non-git command that merely carries the words — exit 0', () => {
    const dir = mkTree();
    for (const c of ['npm run stash', 'make clean -f Makefile']) passes(dir, c);
    rmTree(dir);
  });

  group('tree-guard: the deliberate discard escapes');

  await test('WORKKIT_ALLOW_DISCARD=1 passes, and says it stood aside', () => {
    const dir = mkTree();
    for (const c of ['WORKKIT_ALLOW_DISCARD=1 git checkout -- .',
      'WORKKIT_ALLOW_DISCARD=1 git stash pop',
      'export WORKKIT_ALLOW_DISCARD=1; git reset --hard']) {
      const out = runHook(c, dir);
      assertEq(out.code, 0, `the escape passes: ${c}, got: ${out.stderr}`);
      const msg = asideMessage(out);
      assert(msg.includes('stood aside'), `and says so: ${c}, got: ${out.stdout}`);
      assert(msg.includes('WORKKIT_ALLOW_DISCARD'), `naming the escape: ${c}, got: ${out.stdout}`);
    }
    rmTree(dir);
  });

  await test('the escape inside a quoted span is not an escape — exit 2', () => {
    const dir = mkTree();
    blocks(dir, 'echo "set WORKKIT_ALLOW_DISCARD=1 first" && git stash');
    rmTree(dir);
  });

  await test('the escape without a discard is silent — exit 0', () => {
    const dir = mkTree();
    const out = runHook('WORKKIT_ALLOW_DISCARD=1 npm test', dir);
    assertEq(out.code, 0, 'nothing to stand aside from');
    assertEq(asideMessage(out), '', `and nothing said, got: ${out.stdout}`);
    rmTree(dir);
  });

  group('tree-guard: fail-open and wiring');

  await test('missing command — exit 0', () => {
    const res = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ tool_input: {} }),
      env: { ...process.env, HOME: os.homedir() },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0, 'no command → fail open');
  });

  await test('malformed JSON — exit 0', () => {
    const res = spawnSync('bash', [HOOK], {
      input: 'not json',
      env: { ...process.env, HOME: os.homedir() },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0, 'unreadable payload → fail open');
  });

  await test('the loader routes safety:tree-guard to the script', () => {
    const LOADER = path.join(__dirname, '..', '..', 'hooks', 'loader.sh');
    const res = spawnSync('bash', [LOADER, 'safety:tree-guard'], {
      input: JSON.stringify({ cwd: os.tmpdir(), tool_input: { command: 'git stash' } }),
      env: { ...process.env, HOME: os.homedir() },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 2, 'the loader must reach the guard and propagate its block');
    assert((res.stderr || '').includes('tree-guard'), 'the guard answered, not the loader fail-open');
  });

  await test('hooks.json registers the guard under PreToolUse Bash', () => {
    const settings = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    const bashEntries = settings.hooks.PreToolUse.filter((e) => e.matcher === 'Bash');
    const wired = bashEntries.some((e) => e.hooks.some((h) => h.command.includes('safety:tree-guard')));
    assert(wired, 'safety:tree-guard is registered on PreToolUse Bash');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) {
  module.exports().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
