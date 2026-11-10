// Tests for workflow/githooks/: git's own pre-commit and commit-msg hooks,
// installed through core.hooksPath, judging the commit git is about to make in
// a Claude session (CLAUDECODE=1). Every case is a real `git commit` in a
// scratch opted-in repo from test/lib/git-repo.js, its `gh` a stub on PATH, so
// the hooks see the real staged tree and the real message in every form a
// commit is typed; the verdicts' own cases are test/hooks/commit-gate/.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, selfRun, run, mkTmp,
} = require('../lib/harness');
const {
  SH, shellPath, gitPath, joinPath, systemPathWith, stubNode,
} = require('../lib/platform');
const { mkRepo, commitGh } = require('../lib/git-repo');
const { plantRecord, reviewMarkerPath, kitIndexTree } = require('../lib/suite-record');
const { PREFIX, T, CHANGELOG } = require('../hooks/commit-gate/helpers');
const { linkedClaudeHome, makeGhStub, runScript } = require('./workflow-standards/helpers');

const HOOKS = path.join(__dirname, '..', '..', 'workflow', 'githooks');

const pkg = (version) => `${JSON.stringify({ name: 'fixture', version, scripts: { test: 'exit 0' } }, null, 2)}\n`;

// A repo in the pipeline: a root test script, a CHANGELOG, two code files.
const SEED = {
  'package.json': pkg('1.2.2'),
  'CHANGELOG.md': CHANGELOG(),
  'README.md': '# fixture\n',
  'app.js': 'module.exports = 1;\n',
  'lib/b.js': 'module.exports = 2;\n',
};

const BAD_MSG = 'feat(x): add y';
const NEW_FILES = T.newFiles('lib/y.js');

/**
 * A scratch repo with the kit's hooks installed and `gh` answering `issues` and
 * `tags` from `ghDir`, its env a Claude session's unless `claude` is false.
 */
const mkWorld = ({ claude = true, issues, tags } = {}) => {
  const w = mkRepo('githooks-', SEED);
  // origin/HEAD as a clone has it, the default branch the heal's caller step reads.
  w.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  w.git('config', 'core.hooksPath', HOOKS);
  const gh = commitGh({ issues, tags });
  const env = { ...w.env, PATH: joinPath(gh.binDir, w.env.PATH), ...(claude ? { CLAUDECODE: '1' } : {}) };
  return { ...w, env, ghDir: gh.binDir };
};

const commits = (w) => Number(w.git('rev-list', '--count', 'HEAD').trim());

/** `cmd args` run from `cwd` with the world's env plus `env`: its exit, its stderr, and whether a commit landed. */
const attempt = (w, cmd, args, { cwd = w.repo, env = {} } = {}) => {
  const before = commits(w);
  const res = run(cmd, args, { cwd, env: { ...w.env, ...env } });
  return { code: res.status, err: res.stderr || '', landed: commits(w) > before };
};
const commit = (w, args, opts) => attempt(w, 'git', ['commit', ...args], opts);

const freshReview = (w) => {
  const marker = reviewMarkerPath(w.workflowHome, w.repo);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, '');
};

// Case 1's bad tree: a new code file staged with no test, the review fresh.
const stageUntested = (w) => {
  w.write('lib/y.js', 'module.exports = 3;\n');
  w.git('add', 'lib/y.js');
  freshReview(w);
};

// Case 1's good tree: the test beside it, and a green run recorded for the index.
const stageTested = (w) => {
  stageUntested(w);
  w.write('test/y.test.js', "require('../lib/y');\n");
  w.git('add', 'test/y.test.js');
  plantRecord(w.workflowHome, w.repo, kitIndexTree(w.repo, w.env));
};

const bounced = (res, text, what) => {
  assertEq(res.code, 1, `${what}: the commit ends 1, stderr: ${res.err}`);
  assert(res.err.includes(text), `${what}: stderr names the bounce, got: ${res.err}`);
  assert(!res.landed, `${what}: no commit landed`);
};
const landed = (res, what) => {
  assertEq(res.code, 0, `${what}: the commit exits 0, stderr: ${res.err}`);
  assert(res.landed, `${what}: the commit landed`);
};

// The kit's id of HEAD's tree with `paths` taken from the folder: what a pathspec
// commit, or an -a over those edits alone, carries; HEAD's own with none.
const treeWith = (w, ...paths) => {
  const env = { ...w.env, GIT_INDEX_FILE: path.join(mkTmp('githooks-index-'), 'index') };
  for (const args of [['read-tree', 'HEAD'], ...(paths.length ? [['add', '--', ...paths]] : [])]) {
    const res = spawnSync('git', args, { cwd: w.repo, env, encoding: 'utf8' });
    assertEq(res.status, 0, `git ${args.join(' ')}: ${res.stderr}`);
  }
  return kitIndexTree(w.repo, env);
};

// An executable hook body at `file`.
const hookAt = (file, lines) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${['#!/bin/sh', ...lines].join('\n')}\n`, { mode: 0o755 });
};

// What a hook that appends to `file` wrote there, '' when it never ran.
const wrote = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

const cases = async () => {
  group('githooks: pre-commit judges the staged tree');

  await test('a new code file with no test bounces on check 1; with its test, a fresh review and a proved tree it lands', () => {
    const bad = mkWorld();
    stageUntested(bad);
    bounced(commit(bad, ['-m', BAD_MSG]), NEW_FILES, 'no test staged');

    const good = mkWorld();
    stageTested(good);
    landed(commit(good, ['-m', BAD_MSG]), 'the test staged');
  });

  await test('git -C, sh -c with a cd, and -F <file> all meet the same bounce', () => {
    const forms = [
      ['git -C', (w) => attempt(w, 'git', ['-C', w.repo, 'commit', '-m', BAD_MSG], { cwd: w.dir })],
      ["sh -c 'cd && git commit'", (w) => attempt(w, SH, ['-c', `cd "${shellPath(w.repo)}" && git commit -m "${BAD_MSG}"`], { cwd: w.dir })],
      ['-F msg.txt', (w) => {
        const file = path.join(w.tmp, 'msg.txt');
        fs.writeFileSync(file, `${BAD_MSG}\n`);
        return commit(w, ['-F', file]);
      }],
    ];
    for (const [form, go] of forms) {
      const w = mkWorld();
      stageUntested(w);
      bounced(go(w), NEW_FILES, form);
    }
  });

  await test('git commit -a is judged on the tree it carries: proved, it lands; with the index proved alone, check 5 bounces', () => {
    const w = mkWorld();
    w.write('app.js', 'module.exports = 10;\n');
    freshReview(w);
    plantRecord(w.workflowHome, w.repo, kitIndexTree(w.repo, w.env));
    bounced(commit(w, ['-a', '-m', 'fix: tweak app']), 'no green run proves this tree', 'the index tree proved, not the -a tree');
    plantRecord(w.workflowHome, w.repo, treeWith(w, 'app.js'));
    landed(commit(w, ['-a', '-m', 'fix: tweak app']), 'the -a tree proved');
  });

  await test('a pathspec commit is judged on that file\'s tree, never the index it leaves behind', () => {
    const w = mkWorld();
    w.write('lib/b.js', 'module.exports = 20;\n');
    w.git('add', 'lib/b.js');
    w.write('app.js', 'module.exports = 10;\n');
    freshReview(w);
    plantRecord(w.workflowHome, w.repo, kitIndexTree(w.repo, w.env));
    bounced(commit(w, ['-m', 'fix: tweak app', '--', 'app.js']), 'no green run proves this tree', 'the index it leaves behind proved');
    const carried = treeWith(w, 'app.js');
    plantRecord(w.workflowHome, w.repo, carried);
    landed(commit(w, ['-m', 'fix: tweak app', '--', 'app.js']), 'the pathspec tree proved');
    assertEq(treeWith(w), carried, 'the commit carries the tree the hook judged');
  });

  group('githooks: commit-msg judges the real message');

  await test('two issues on one closing line bounce on check 8', () => {
    const w = mkWorld();
    w.write('README.md', '# fixture, noted\n');
    w.git('add', 'README.md');
    const res = commit(w, ['-m', 'docs: note\n\nFixes #1 #2']);
    bounced(res, PREFIX, 'Fixes #1 #2');
    assert(/Fixes #1[ \t]*\r?\n[ \t]*Fixes #2/.test(res.err), `the bounce shows one line per issue, got: ${res.err}`);
  });

  await test('Fixes #1 for an open issue at status:building bounces on check 7', () => {
    const w = mkWorld({
      issues: {
        1: {
          state: 'OPEN',
          url: 'https://github.com/owner/repo/issues/1',
          labels: [{ name: 'status:building' }],
          comments: [{ body: 'Proof: unit: npm test' }],
        },
      },
    });
    w.write('CHANGELOG.md', CHANGELOG('- [#1](https://github.com/owner/repo/issues/1) - The thing the issue asked for.'));
    w.git('add', 'CHANGELOG.md');
    bounced(commit(w, ['-m', 'docs: changelog\n\nFixes #1']), `${PREFIX}${T.unpassed('#1 is at status:building')}`, 'an issue still building');
  });

  await test('every #-led body line is judged: #497 by check 7, and a # line that says kill by commit-language', () => {
    const at = (label) => ({
      497: { state: 'OPEN', url: 'https://github.com/owner/repo/issues/497', labels: [{ name: label }], comments: [] },
    });
    const stageReadme = (w) => {
      w.write('README.md', '# fixture, noted\n');
      w.git('add', 'README.md');
    };
    const building = mkWorld({ issues: at('status:building') });
    stageReadme(building);
    bounced(commit(building, ['-m', 'fix: x\n\n#497 is the ruling\n# a comment']), `${PREFIX}${T.unpassed('#497 is at status:building')}`, 'the #497 line kept');

    const passed = mkWorld({ issues: at('status:complete') });
    stageReadme(passed);
    bounced(commit(passed, ['-m', 'fix: x\n\n#497 is the ruling\n# kill the old watcher']),
      'commit-language: BLOCKED this commit: the message uses non-neutral vocabulary: kill', 'the # line git keeps');
  });

  await test('a --verbose commit is judged above the scissors alone: the diff below it saying kill and #497 never reaches check 7 or commit-language', () => {
    const w = mkWorld({
      issues: { 497: { state: 'OPEN', url: 'https://github.com/owner/repo/issues/497', labels: [{ name: 'status:building' }], comments: [] } },
    });
    w.write('README.md', '# fixture\n\nkill the old watcher before #497 lands.\n');
    w.git('add', 'README.md');
    // The editor keeps git's scissors line and the diff under it, and writes the body above;
    // with no scissors in the file it exits 1, so the commit never lands.
    const editor = path.join(w.tmp, 'editor.sh');
    hookAt(editor, ['grep -q \' >8 \' "$1" || exit 1', '{ printf \'docs: note the watcher\\n\\nA plain body.\\n\'; sed -n \'/ >8 /,$p\' "$1"; } > "$1.new"', 'mv "$1.new" "$1"']);
    landed(commit(w, ['-v'], { env: { GIT_EDITOR: gitPath(editor) } }), 'the diff text under the scissors');
  });

  await test('an amend with nothing newly staged is judged on its message: two issues on one closing line bounce on check 8', () => {
    const w = mkWorld();
    const head = w.git('rev-parse', 'HEAD').trim();
    const res = commit(w, ['--amend', '-m', 'fix: x\n\nFixes #1 #2']);
    assertEq(res.code, 1, `the amend ends 1, stderr: ${res.err}`);
    assert(res.err.includes(PREFIX) && res.err.includes('#2'), `stderr names the check 8 bounce, got: ${res.err}`);
    assertEq(w.git('rev-parse', 'HEAD').trim(), head, 'HEAD is still the commit the amend would have replaced');
  });

  await test('a body that says kill, read from a -F file, bounces on commit-language', () => {
    const w = mkWorld();
    w.write('README.md', '# fixture, noted\n');
    w.git('add', 'README.md');
    const file = path.join(w.tmp, 'msg.txt');
    fs.writeFileSync(file, 'docs: note the watcher\n\nkill the process before a relaunch.\n');
    bounced(commit(w, ['-F', file]), 'commit-language: BLOCKED this commit: the message uses non-neutral vocabulary: kill', 'the -F body');
  });

  await test('chore(release): 1.2.3 bounces on release-taken when the GitHub release v1.2.3 exists', () => {
    const w = mkWorld({ tags: ['v1.2.3'] });
    w.write('package.json', pkg('1.2.3'));
    w.git('add', 'package.json');
    bounced(commit(w, ['-m', 'chore(release): 1.2.3']), 'release-taken: BLOCKED this release commit: github-release already has v1.2.3', 'a taken tag');
  });

  await test('a Merge branch subject lands', () => {
    const w = mkWorld();
    w.write('README.md', '# fixture, noted\n');
    w.git('add', 'README.md');
    landed(commit(w, ['-m', "Merge branch 'topic'"]), 'a merge subject');
  });

  group('githooks: reached through the engine link');

  await test('core.hooksPath naming the engine link\'s githooks: check 1 still bounces, and the repo\'s own hook runs once ours passed', () => {
    const w = mkWorld();
    w.git('config', 'core.hooksPath', path.join(linkedClaudeHome().link, 'githooks'));
    const ran = path.join(w.tmp, 'theirs-ran');
    hookAt(path.join(w.repo, '.git', 'hooks', 'pre-commit'), [`echo ran >> "${shellPath(ran)}"`]);
    stageUntested(w);
    bounced(commit(w, ['-m', BAD_MSG]), NEW_FILES, 'the hook found its kit through the link');
    stageTested(w);
    landed(commit(w, ['-m', BAD_MSG]), 'ours passes through the link');
    assertEq(wrote(ran), 'ran\n', 'their hook ran once, after ours');
  });

  await test('workkit.hooksPath saving the kit\'s real folder under the link spelling: the commit lands once, the repo\'s own hook runs once', () => {
    const w = mkWorld();
    w.git('config', 'core.hooksPath', path.join(linkedClaudeHome().link, 'githooks'));
    const ran = path.join(w.tmp, 'theirs-ran');
    hookAt(path.join(w.repo, '.git', 'hooks', 'pre-commit'), [`echo ran >> "${shellPath(ran)}"`]);
    stageTested(w);
    w.git('config', '--local', 'workkit.hooksPath', fs.realpathSync(HOOKS));
    const before = commits(w);
    landed(commit(w, ['-m', BAD_MSG]), 'ours never chains to itself');
    assertEq(commits(w), before + 1, 'one commit landed');
    assertEq(wrote(ran), 'ran\n', 'the chain skipped the kit\'s folder to .git/hooks, which ran once');
  });

  group('githooks: who is judged');

  await test('outside a Claude session, and under HOOK_DISABLE=1, case 1\'s bad commit lands', () => {
    const terminal = mkWorld({ claude: false });
    stageUntested(terminal);
    landed(commit(terminal, ['-m', BAD_MSG]), 'CLAUDECODE unset');

    const disabled = mkWorld();
    stageUntested(disabled);
    landed(commit(disabled, ['-m', BAD_MSG], { env: { HOOK_DISABLE: '1' } }), 'HOOK_DISABLE=1');
  });

  await test('with only a node older than 22.12 on PATH and none under nvm, case 1\'s bad commit lands, the hook saying it did not run', () => {
    const w = mkWorld();
    const old = path.join(w.dir, 'old-node');
    stubNode(old, '20.15.1');
    stageUntested(w);
    const res = commit(w, ['-m', BAD_MSG], { env: { PATH: systemPathWith(w.ghDir, old) } });
    landed(res, 'a node 20 alone');
    assert(res.err.includes('did not run (no node 22.12 or newer found)'), `stderr names the stand-down, got: ${res.err}`);
  });

  await test('the hook\'s node found but none on PATH: a CHANGELOG commit lands, check 3 standing down out loud', () => {
    const w = mkWorld();
    w.write('CHANGELOG.md', CHANGELOG('- [#1](https://github.com/owner/repo/issues/1) - The thing the issue asked for.'));
    w.git('add', 'CHANGELOG.md');
    const res = commit(w, ['-m', 'docs: changelog'], { env: { WORKKIT_NODE: process.execPath, PATH: systemPathWith(w.ghDir) } });
    landed(res, 'a linter that did not start');
    assert(/^commit-gate: check 3 stood down: the CHANGELOG linter did not start \(.+\)$/m.test(res.err), `the one stand-down line, got: ${res.err}`);
    assert(!res.err.includes('does not match the format'), `never a format verdict, got: ${res.err}`);
  });

  await test('--no-verify skips the hooks: case 1\'s bad commit lands', () => {
    const w = mkWorld();
    stageUntested(w);
    landed(commit(w, ['--no-verify', '-m', BAD_MSG]), '--no-verify');
  });

  group('githooks: the repo\'s own hooks run after ours');

  await test('.git/hooks/pre-commit does not run when ours bounced, and runs once ours passed', () => {
    const w = mkWorld();
    const ran = path.join(w.tmp, 'theirs-ran');
    hookAt(path.join(w.repo, '.git', 'hooks', 'pre-commit'), [`echo ran >> "${shellPath(ran)}"`]);
    stageUntested(w);
    bounced(commit(w, ['-m', BAD_MSG]), NEW_FILES, 'ours bounces first');
    assert(!fs.existsSync(ran), 'their hook never ran behind our bounce');
    stageTested(w);
    landed(commit(w, ['-m', BAD_MSG]), 'ours passes');
    assertEq(fs.readFileSync(ran, 'utf8'), 'ran\n', 'their hook ran once, after ours');
  });

  await test('the folder workkit.hooksPath saved holds a pre-commit that refuses: the commit ends 1 after ours passed', () => {
    const w = mkWorld();
    const saved = path.join(w.repo, '.husky', '_');
    hookAt(path.join(saved, 'pre-commit'), ["echo 'theirs: refused' >&2", 'exit 1']);
    w.git('config', '--local', 'workkit.hooksPath', saved);
    stageTested(w);
    const res = commit(w, ['-m', BAD_MSG]);
    bounced(res, 'theirs: refused', 'their refusal');
    assert(!res.err.includes(PREFIX), `ours passed, so no bounce of ours, got: ${res.err}`);
  });

  await test('a repo\'s own folder that merely ends /workflow/githooks is saved by the heal, and a good commit runs its hook once', () => {
    const w = mkWorld();
    const own = path.join(w.repo, 'tools', 'workflow', 'githooks');
    const ran = path.join(w.tmp, 'own-ran');
    hookAt(path.join(own, 'pre-commit'), [`echo ran >> "${shellPath(ran)}"`]);
    w.git('config', 'core.hooksPath', own);
    const healed = runScript(w.repo, { pathPrefix: makeGhStub().binDir });
    assertEq(healed.code, 0, `the heal runs clean: ${healed.output}`);
    assertEq(w.git('config', '--local', 'workkit.hooksPath').trim(), own, 'the repo\'s own folder is saved for ours to chain to');
    assertEq(fs.realpathSync(w.git('config', '--local', 'core.hooksPath').trim()), fs.realpathSync(HOOKS), 'core.hooksPath is ours');
    stageTested(w);
    landed(commit(w, ['-m', BAD_MSG]), 'ours passes');
    assertEq(wrote(ran), 'ran\n', 'the saved folder\'s pre-commit ran once through the chain');
  });

  await test('outside a Claude session the repo\'s own hook still runs', () => {
    const w = mkWorld({ claude: false });
    const ran = path.join(w.tmp, 'theirs-ran');
    hookAt(path.join(w.repo, '.git', 'hooks', 'pre-commit'), [`echo ran >> "${shellPath(ran)}"`]);
    stageUntested(w);
    landed(commit(w, ['-m', BAD_MSG]), 'the owner\'s terminal');
    assertEq(fs.readFileSync(ran, 'utf8'), 'ran\n', 'their hook ran');
  });

  group('githooks: every other client-side hook passes through');

  // Each session the pass-through serves: the chain runs whatever the session.
  const SESSIONS = [['a Claude session', true], ['the owner\'s terminal', false]];

  await test('.git/hooks/pre-push runs on a real git push to a bare remote, in a Claude session and outside one', () => {
    for (const [who, claude] of SESSIONS) {
      const w = mkWorld({ claude });
      const ran = path.join(w.tmp, 'pre-push-ran');
      hookAt(path.join(w.repo, '.git', 'hooks', 'pre-push'), [`echo ran >> "${shellPath(ran)}"`]);
      const bare = path.join(w.dir, 'remote.git');
      w.git('init', '-q', '--bare', bare);
      const res = attempt(w, 'git', ['push', '-q', bare, 'main']);
      assertEq(res.code, 0, `${who}: the push exits 0, stderr: ${res.err}`);
      assertEq(wrote(ran), 'ran\n', `${who}: their pre-push ran once`);
    }
  });

  await test('.git/hooks/post-commit runs after a commit lands, in a Claude session and outside one', () => {
    for (const [who, claude] of SESSIONS) {
      const w = mkWorld({ claude });
      const ran = path.join(w.tmp, 'post-commit-ran');
      hookAt(path.join(w.repo, '.git', 'hooks', 'post-commit'), [`git rev-parse HEAD >> "${shellPath(ran)}"`]);
      w.write('README.md', '# fixture, noted\n');
      w.git('add', 'README.md');
      landed(commit(w, ['-m', 'docs: note']), `${who}: a docs commit`);
      assertEq(wrote(ran), `${w.git('rev-parse', 'HEAD').trim()}\n`,
        `${who}: their post-commit ran once, on the new commit`);
    }
  });

  await test('the folder workkit.hooksPath saved holds the pre-push that runs, in place of .git/hooks\'s', () => {
    for (const [who, claude] of SESSIONS) {
      const w = mkWorld({ claude });
      const savedRan = path.join(w.tmp, 'saved-ran');
      const gitRan = path.join(w.tmp, 'git-hooks-ran');
      const saved = path.join(w.repo, '.husky', '_');
      hookAt(path.join(saved, 'pre-push'), [`echo ran >> "${shellPath(savedRan)}"`]);
      hookAt(path.join(w.repo, '.git', 'hooks', 'pre-push'), [`echo ran >> "${shellPath(gitRan)}"`]);
      w.git('config', '--local', 'workkit.hooksPath', saved);
      const bare = path.join(w.dir, 'remote.git');
      w.git('init', '-q', '--bare', bare);
      const res = attempt(w, 'git', ['push', '-q', bare, 'main']);
      assertEq(res.code, 0, `${who}: the push exits 0, stderr: ${res.err}`);
      assertEq(wrote(savedRan), 'ran\n', `${who}: the saved folder's pre-push ran once`);
      assert(!fs.existsSync(gitRan), `${who}: .git/hooks/pre-push never ran beside it`);
    }
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
