// Tests for safety:tree-guard's logic, treeGuardVerdict({ argv, exists, allow }) in hooks/mods/tree-guard.js:
// git's real argument list, as the git shim got it, is judged. The forms that discard a shared working tree
// (checkout with a pathspec or force, a forced switch, restore over the tree, stash but list and show, a forced
// clean, reset --hard) bounce; `allow`, WORKKIT_ALLOW_DISCARD=1 in the shim's environment, stands aside and says so.
// The shim through a real PATH and a real repo is test/scripts/gitshim.test.js.

const { describe, test, expect } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

// The folder the shim runs in, as the path probe answers for it: `src/app.js` exists, so
// it reads as a pathspec, while `feature/thing` does not and reads as a branch.
const TREE = new Set(['src', 'src/app.js', 'notes.md']);
const exists = async (rel) => TREE.has(rel.replace(/^(\.\/)+/, '').replace(/\/+$/, ''));

const judge = (argv, allow = false) => mods('tree-guard').treeGuardVerdict({ argv, exists, allow });

const BLOCK = (found) => `tree-guard: BLOCKED this command: it runs ${found}, which discards or parks working-tree state, and this tree is SHARED: reverting your own edits that way takes whatever else is uncommitted with it.\nRevert your own changes by reverse-editing your own hunks: edit each file back to what it was. If the discard is genuinely intended, the OWNER reruns the command with WORKKIT_ALLOW_DISCARD=1 in front of it.`;

const CHECKOUT = 'git checkout with a pathspec';
const SWITCH = 'git switch --discard-changes/--force';
const RESTORE = 'git restore over the working tree';
const STASH = 'git stash';
const CLEAN = 'git clean -f';
const RESET = 'git reset --hard';

const denyOf = (r) => (r && typeof r.deny === 'string' ? r.deny.replace(/\n$/, '') : null);
const shown = (argv) => `git ${argv.join(' ')}`;

const blocks = async (argv, found) => {
  expect(denyOf(await judge(argv)), `must block: ${shown(argv)}`).toBe(BLOCK(found));
};

const passes = async (argv) => {
  const r = await judge(argv);
  expect(denyOf(r), `must pass: ${shown(argv)}`).toBe(null);
  expect(textOf(r), `silently: ${shown(argv)}`).toBe('');
};

describe('tree-guard: git checkout', () => {
  test('checkout with a pathspec after --: blocked', async () => {
    for (const a of [['checkout', '--', '.'], ['checkout', '--', 'src/app.js'],
      ['checkout', 'main', '--', 'src/app.js'], ['checkout', 'HEAD', '--', 'src/app.js', 'notes.md']]) {
      await blocks(a, CHECKOUT);
    }
  });

  test('checkout with . or a path the folder holds: blocked', async () => {
    for (const a of [['checkout', '.'], ['checkout', './src'], ['checkout', 'src/app.js'], ['checkout', 'notes.md']]) {
      await blocks(a, CHECKOUT);
    }
  });

  test('checkout of two operands is the ref and pathspec form: blocked', async () => {
    await blocks(['checkout', 'main', 'app.js'], CHECKOUT);
  });

  test('a forced branch checkout discards the tree too: blocked', async () => {
    for (const a of [['checkout', '-f', 'main'], ['checkout', '--force', 'main']]) await blocks(a, CHECKOUT);
  });

  test('a plain branch checkout passes: a name the folder does not hold is a branch', async () => {
    for (const a of [['checkout', 'main'], ['checkout', '-b', 'new'], ['checkout', '-b', 'new', 'main'],
      ['checkout', 'feature/thing'], ['checkout', 'origin/main'], ['checkout', '-']]) {
      await passes(a);
    }
  });
});

describe('tree-guard: git switch', () => {
  test('a switch that overwrites local changes: blocked', async () => {
    for (const a of [['switch', '--discard-changes', 'main'], ['switch', '-f', 'main'], ['switch', '--force', 'main']]) {
      await blocks(a, SWITCH);
    }
  });

  test('a plain switch passes', async () => {
    for (const a of [['switch', 'main'], ['switch', '-c', 'new'], ['switch', '-c', 'new', 'main'], ['switch', '-'], ['switch', '--create', 'new']]) {
      await passes(a);
    }
  });
});

describe('tree-guard: git restore', () => {
  test('a restore that touches the working tree: blocked', async () => {
    for (const a of [['restore', 'src/app.js'], ['restore', '.'], ['restore', '--worktree', 'src/app.js'],
      ['restore', '--staged', '--worktree', 'src/app.js'], ['restore', '-SW', 'src/app.js'], ['restore']]) {
      await blocks(a, RESTORE);
    }
  });

  test('a restore of the index alone passes', async () => {
    for (const a of [['restore', '--staged', 'src/app.js'], ['restore', '--staged', '.'], ['restore', '-S', 'src/app.js']]) {
      await passes(a);
    }
  });
});

describe('tree-guard: git stash, clean, reset', () => {
  test('every stash but list and show: blocked', async () => {
    for (const a of [['stash'], ['stash', 'push', '-m', 'wip'], ['stash', 'push', 'src/app.js'], ['stash', 'pop'],
      ['stash', 'apply'], ['stash', 'drop'], ['stash', 'clear'], ['stash', 'save', 'wip']]) {
      await blocks(a, STASH);
    }
  });

  test('stash list and show pass', async () => {
    for (const a of [['stash', 'list'], ['stash', 'show'], ['stash', 'show', '-p', 'stash@{0}']]) await passes(a);
  });

  test('a clean with a force spelling: blocked', async () => {
    for (const a of [['clean', '-f'], ['clean', '-fd'], ['clean', '-fdx'], ['clean', '-x', '-f'], ['clean', '--force']]) {
      await blocks(a, CLEAN);
    }
  });

  test('a dry-run clean passes', async () => {
    for (const a of [['clean', '-n'], ['clean', '--dry-run']]) await passes(a);
  });

  test('reset --hard: blocked', async () => {
    for (const a of [['reset', '--hard'], ['reset', '--hard', 'HEAD~1'], ['reset', '--hard', 'origin/main']]) await blocks(a, RESET);
  });

  test('a reset that leaves the tree alone passes', async () => {
    for (const a of [['reset', '--soft', 'HEAD~1'], ['reset', 'HEAD', 'src/app.js'], ['reset', 'src/app.js'], ['reset']]) await passes(a);
  });
});

describe('tree-guard: git\'s own global options', () => {
  test('a discard behind -C, -c or --git-dir is judged as its verb: blocked', async () => {
    await blocks(['-C', '/other', 'stash'], STASH);
    await blocks(['-C', '/other', 'checkout', '--', '.'], CHECKOUT);
    await blocks(['-c', 'core.quotepath=off', 'reset', '--hard'], RESET);
    await blocks(['--git-dir=/other/.git', 'clean', '-f'], CLEAN);
  });

  test('a read-only form behind -C passes', async () => {
    await passes(['-C', '/other', 'stash', 'list']);
  });
});

describe('tree-guard: what it never touches', () => {
  test('every other verb passes, whatever words follow it', async () => {
    for (const a of [['status'], ['diff', '--', 'src/app.js'], ['add', '-A'], ['log', '--oneline'],
      ['commit', '-m', 'docs: say why git checkout -- . is banned'], ['grep', 'reset --hard']]) {
      await passes(a);
    }
  });
});

describe('tree-guard: the deliberate discard', () => {
  test('allow passes a discard and says it stood aside, naming the form', async () => {
    for (const [a, found] of [[['checkout', '--', '.'], CHECKOUT], [['stash', 'pop'], STASH], [['reset', '--hard'], RESET]]) {
      const r = await judge(a, true);
      expect(denyOf(r), `the escape passes: ${shown(a)}`).toBe(null);
      const said = textOf(r);
      expect(said.startsWith('tree-guard: stood aside'), `and says so: ${shown(a)}, got: ${said}`).toBeTruthy();
      expect(said.includes(found), `naming ${found}: got: ${said}`).toBeTruthy();
    }
  });

  test('allow with no discard is silent', async () => {
    const r = await judge(['status'], true);
    expect(denyOf(r), 'nothing to stand aside from').toBe(null);
    expect(textOf(r), 'and nothing said').toBe('');
  });
});
