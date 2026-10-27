// The shared prologue of the safety:commit-gate logic suites beside this one,
// one suite per check: a repo held in memory (HEAD, the index, the working
// tree), the facts commitGateVerdict(facts) in hooks/mods/commit-gate.js reads
// off it, and the block and notice texts, byte for byte the shell hook's. The
// stubbed reads answer from the same repo: `show`, `run` (git, the tree-hash
// entry, npm's script-shell), `issueView`; `lint` runs the real changelog
// linter over a scratch copy of the repo, `jobRewrite` the real heal rewrite.

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { assert, assertEq, mkTmp, SPAWN_DEADLINE } = require('../../lib/harness');
const { BASH, NO_RC, shellPath } = require('../../lib/platform');
const { mods, textOf, runResult } = require('../../lib/mods-inputs');
const { mkRepo: mkGitRepo, FIXTURE_ORIGIN } = require('../../lib/git-repo');

const KIT = fs.realpathSync(path.join(__dirname, '..', '..', '..'));
const WORKFLOW_DIR = path.join(KIT, 'workflow');
const JOB = path.join(WORKFLOW_DIR, 'changelog', 'changelog-job.sh');
const TEMPLATE = path.join(WORKFLOW_DIR, 'templates', 'github-workflows', 'checks.yml');
const LINTER = path.join(WORKFLOW_DIR, 'changelog', 'changelog.js');
// npm's script-shell as setup wires it: the wrapper beside this checkout's engine.
const WRAPPER = fs.realpathSync(path.join(WORKFLOW_DIR, 'script-shell.sh'));

const ROOT = '/w/repo';
const ELSEWHERE = '/w/elsewhere';
// The clock: HEAD was committed a minute before now; a fresh marker is now.
const NOW_S = 1800000000;
const HEAD_TIME = NOW_S - 60;
const OPTED = '{ "version": 1, "enabled": true }\n';

// --- The texts, the shell hook's own. ---
const PREFIX = 'commit-gate: BLOCKED this commit: ';
const OWN_DIR = "Run the commit from the repo's own directory so the gate can see its staging.";
const T = {
  wrapped: "the commit is wrapped in an interpreter string (sh -c / eval); run a plain 'git commit ...' directly so the gate can read its flags and message.",
  cd: "the command changes directory before committing; run a plain 'git commit' with the session already in the repo so the gate can see its staging.",
  stage: "the command stages and commits in one call, so the gate cannot see what the commit will carry; stage first (its own command), then run a plain 'git commit'.",
  dashC: `uses 'git -C'. ${OWN_DIR}`,
  uses: (flag) => `uses '${flag}'. ${OWN_DIR}`,
  sets: (name) => `sets ${name}. ${OWN_DIR}`,
  noRepo: "the session's directory is not inside a git repository, so the gate cannot see what this commit would carry. cd into the repo's root as its own command first, then run a plain 'git commit' there.",
  newFiles: (list) => `the commit adds new source files (${list}) but touches no test file. The test obligation scales with the change (AGENTS.md §6): write/extend tests for the new files, stage them, then commit.`,
  noReview: 'the commit contains code and no review has run. Run the workkit:review skill on the diff first (it records a marker), then commit.',
  stale: "the review marker predates the last commit. This commit's code has not been reviewed. Run the workkit:review skill again, then commit.",
  lint: 'the CHANGELOG entry does not match the format (see docs/project-state.md). ',
  fixes: 'the message closes an issue (Fixes/Closes/Resolves #N) but no CHANGELOG.md is staged. An issue closes against its CHANGELOG entry (docs/project-state.md): add the entry under [Unreleased], stage CHANGELOG.md, then commit.',
  unpassed: (list) => `the message names issues the owner has not passed: ${list}. The owner's pass moves an issue to status:complete before a commit names it (docs/project-state.md, "The park"): leave the work uncommitted until then, or drop the reference.`,
  unproved: (list) => `the message closes${list}, and no comment there opens with a \`Proof:\` line. A proof is a hard gate (docs/project-state.md, "The proof"): the agent that built the item comments the Proof: line first, one entry per layer with the command or the reason it was skipped, and only then does the trailer close the issue.`,
  pathspec: 'a pathspec commit carries a tree the gate cannot compare with the record: stage the files and commit from the index.',
  disk: 'the green run proved the tree on disk, and this commit carries a different one (an untracked file or an unstaged edit the commit leaves out): stage everything that ran (`git add -A`), or run `workkit prove` to prove the staged tree alone (the suite runs on a copy of the index, and the folder stays as it is), then commit.',
  unwired: "the commit carries code and no green run proves this tree, and npm's script-shell does not point at the kit's wrapper, so a root `npm test` writes no record. Run `workkit setup` once, then `npm test` at the repo root, then commit.",
  // The record block names the suite log, whose path no fact carries: its two ends.
  recordHead: 'the commit carries code and no green run proves this tree. Run `npm test` at the repo root (once per tree; the shell records a green run and writes its output to ',
  recordTail: '), then commit.',
};
const NOTICE = {
  nothing: 'commit-gate: nothing staged and no -a/pathspec: the gate has nothing to judge, so no check ran (suite included).',
  proved: 'commit-gate: suite proved: a green root `npm test` recorded this tree.',
  noCode: 'commit-gate: suite not run: the commit carries no code (docs-only or version-stamp-only).',
  unread: (n) => `commit-gate: could not read issue #${n} (gh could not answer), so its stage and proof checks did not run.`,
  firstCommit: 'commit-gate: first commit of this repo, no HEAD to judge against; the gate stands down',
};

// --- The repo in memory. ---
const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');
const blobOf = (text) => sha1(`blob ${Buffer.byteLength(text)}\0${text}`);
const treeOf = (files) => sha1(`tree ${JSON.stringify(Object.keys(files).sort().map((p) => [p, files[p]]))}`);

/**
 * A repo at ROOT with one commit: `.workkit/settings.json` unless `optIn` is
 * false, the fixture origin unless `origin` is null (a throwaway repo).
 */
const mkRepo = ({ optIn = true, origin = FIXTURE_ORIGIN } = {}) => {
  const seed = optIn ? { '.workkit/settings.json': OPTED } : {};
  return {
    head: { ...seed },
    index: { ...seed },
    work: { ...seed },
    origin,
    headTime: HEAD_TIME,
    marker: null,
    record: null,
    issues: {},
    ghFails: false,
    scriptShell: WRAPPER,
    isWindows: false,
    autocrlf: false,
    failOn: null,
    calls: { run: [], show: [], issueView: [], lint: [], jobRewrite: [] },
  };
};

/** `git add`: the index and the working tree both hold `text`. */
const stage = (r, name, text) => { r.index[name] = text; r.work[name] = text; };
/** A write to the working tree alone: untracked when new, an unstaged edit when tracked. */
const write = (r, name, text) => { r.work[name] = text; };
/** `git rm`: gone from the index and the working tree. */
const gitRm = (r, name) => { delete r.index[name]; delete r.work[name]; };
/** A file deleted from the working tree alone. */
const unlink = (r, name) => { delete r.work[name]; };
/** `git commit` of the index. */
const commit = (r) => { r.head = { ...r.index }; };
/** The review marker the skill records, newer than HEAD. */
const touchMarker = (r) => { r.marker = { mtimeMs: NOW_S * 1000 }; };
/** A review marker recorded an hour before HEAD. */
const staleMarker = (r) => { r.marker = { mtimeMs: (r.headTime - 3600) * 1000 }; };
const dropMarker = (r) => { r.marker = null; };
/** The record a green root `npm test` leaves: the working tree's id, or `tree`. */
const proveTree = (r, tree = workTree(r)) => { r.record = `${tree}\n`; };

const workTree = (r) => treeOf(r.work);
const indexTree = (r) => treeOf(r.index);
// The tree `git commit -a` carries: the index with every tracked change taken.
const allTree = (r) => treeOf(Object.fromEntries(Object.keys(r.index).filter((p) => p in r.work).map((p) => [p, r.work[p]])));

const union = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
const stagedList = (r) => union(r.head, r.index).filter((p) => r.head[p] !== r.index[p]);
const changedList = (r) => Object.keys(r.index).sort().filter((p) => r.work[p] !== r.index[p]);
const cachedStatus = (r, p) => (!(p in r.head) ? 'A' : !(p in r.index) ? 'D' : 'M');
const workStatus = (r, p) => (!(p in r.work) ? 'D' : 'M');

// git's --diff-filter: upper case letters keep those statuses, lower case drop them.
const filtered = (list, statusOf, filter) => {
  if (!filter) return list;
  const keep = [...filter].filter((c) => c === c.toUpperCase());
  const drop = [...filter].filter((c) => c !== c.toUpperCase()).map((c) => c.toUpperCase());
  return list.filter((p) => (keep.length === 0 || keep.includes(statusOf(p))) && !drop.includes(statusOf(p)));
};

const relOf = (p) => String(p).replace(/\\/g, '/').replace(new RegExp(`^${ROOT}/`), '');
const inRepo = (dir) => dir === ROOT || String(dir).startsWith(`${ROOT}/`);
// A real file: an absolute path outside the world's /w/ tree that exists.
const onDisk = (p) => typeof p === 'string' && path.isAbsolute(p) && !p.startsWith('/w/') && fs.existsSync(p);
const sideOf = (r, rev) => (/^HEAD$/.test(rev) ? r.head : r.index);
const splitSpec = (spec) => [spec.slice(0, spec.indexOf(':')), spec.slice(spec.indexOf(':') + 1)];
const fatal = (msg) => runResult({ exitCode: 128, stderr: `fatal: ${msg}\n` });

// What a hash-object of `arg` reads: a repo path, else a file on disk; CRLF
// committed as LF under core.autocrlf.
function hashed(r, argv, init) {
  const file = argv.filter((a) => !a.startsWith('-')).pop();
  let text = argv.includes('--stdin') ? init.stdin ?? '' : null;
  if (text === null && file !== undefined) text = readWork(r, file);
  if (text === null) return fatal(`could not open '${file}' for reading: No such file or directory`);
  return runResult({ stdout: `${blobOf(r.autocrlf ? text.replace(/\r\n/g, '\n') : text)}\n` });
}

// git, answered from the repo: the reads the gate and its heal arms make.
function git(r, args, dir, init) {
  const rest = [...args];
  while (rest[0] === '-c' || rest[0] === '-C') {
    if (rest[0] === '-C') dir = rest[1];
    rest.splice(0, 2);
  }
  if (!inRepo(dir)) return fatal('not a git repository (or any of the parent directories): .git');
  const [sub, ...more] = rest;
  const paths = more.includes('--') ? more.slice(more.indexOf('--') + 1) : [];
  const under = (list) => (paths.length === 0 ? list : list.filter((p) => paths.some((q) => p === q || p.startsWith(`${q.replace(/\/$/, '')}/`))));
  if (sub === 'rev-parse') {
    if (more.includes('--verify')) {
      const [rev, p] = splitSpec(more.filter((a) => !a.startsWith('-')).pop());
      const side = sideOf(r, rev);
      return p in side ? runResult({ stdout: `${blobOf(side[p])}\n` }) : runResult({ exitCode: 1 });
    }
    const answers = {
      '--is-inside-work-tree': 'true', '--show-toplevel': ROOT, '--git-dir': `${ROOT}/.git`,
      '--absolute-git-dir': `${ROOT}/.git`, '--show-prefix': dir === ROOT ? '' : `${relOf(dir)}/`,
    };
    const asked = more.filter((a) => a in answers);
    return asked.length > 0 ? runResult({ stdout: asked.map((a) => `${answers[a]}\n`).join('') }) : runResult({ exitCode: 1 });
  }
  if (sub === 'remote' && more[0] === 'get-url') {
    return r.origin ? runResult({ stdout: `${r.origin}\n` }) : runResult({ exitCode: 2, stderr: "error: No such remote 'origin'\n" });
  }
  if (sub === 'diff' && more.includes('--name-only')) {
    const cached = more.includes('--cached') || more.includes('--staged');
    const filter = (more.find((a) => a.startsWith('--diff-filter=')) || '').slice('--diff-filter='.length);
    const list = cached ? filtered(stagedList(r), (p) => cachedStatus(r, p), filter) : filtered(changedList(r), (p) => workStatus(r, p), filter);
    return runResult({ stdout: under(list).map((p) => `${p}\n`).join('') });
  }
  if (sub === 'show' || (sub === 'cat-file' && more.includes('-p'))) {
    const [rev, p] = splitSpec(more.filter((a) => !a.startsWith('-')).pop());
    const side = sideOf(r, rev);
    return p in side ? runResult({ stdout: side[p] }) : fatal(`path '${p}' does not exist in '${rev || 'the index'}'`);
  }
  if (sub === 'ls-files') {
    // --cached (the default) lists the index, --others the untracked files; both lists both.
    const others = more.includes('--others') || more.includes('-o');
    const cached = more.includes('--cached') || more.includes('-c') || !others;
    const untracked = Object.keys(r.work).filter((p) => !(p in r.index));
    const list = under([...(cached ? Object.keys(r.index) : []), ...(others ? untracked : [])].sort());
    return runResult({ stdout: list.map((p) => `${p}${more.includes('-z') ? '\0' : '\n'}`).join('') });
  }
  if (sub === 'checkout-index') {
    const prefix = (more.find((a) => a.startsWith('--prefix=')) || '--prefix=').slice('--prefix='.length);
    for (const p of more.includes('-a') ? Object.keys(r.index) : paths.filter((q) => q in r.index)) {
      fs.mkdirSync(path.dirname(`${prefix}${p}`), { recursive: true });
      fs.writeFileSync(`${prefix}${p}`, r.index[p]);
    }
    return runResult();
  }
  if (sub === 'write-tree') return runResult({ stdout: `${indexTree(r)}\n` });
  if (sub === 'log') return runResult({ stdout: `${r.headTime}\n` });
  if (sub === 'hash-object') return hashed(r, more, init);
  return runResult({ exitCode: 1 });
}

// A text to hand the rewrite as a file: a path on disk as it is, a repo path as
// HEAD holds it, anything else written to a scratch file.
const asFile = (r, x, name) => {
  if (onDisk(x)) return x;
  const text = typeof x === 'string' && !x.includes('\n') && relOf(x) in r.head ? r.head[relOf(x)] : x;
  const file = path.join(mkTmp('cg-rewrite-'), name);
  fs.writeFileSync(file, text);
  return file;
};

/** wk_checks_heal_rewrite <a> <b> run for real, its stdout, or null when it fails. */
const realRewrite = (a, b) => {
  const res = spawnSync(BASH, [...NO_RC, '-c', '. "$1"; wk_checks_heal_rewrite "$2" "$3"', 'bash', shellPath(JOB), shellPath(a), shellPath(b)],
    { encoding: 'utf8', timeout: SPAWN_DEADLINE });
  return res.status === 0 ? res.stdout : null;
};

const rewriteOf = (r, a, b) => {
  const template = onDisk(b) ? b : (typeof b === 'string' && b.includes('\n') ? asFile(r, b, 'template.yml') : TEMPLATE);
  return realRewrite(asFile(r, a, 'checks.yml'), template);
};

// A working tree file's text by repo path, else a file on disk; null for none.
const readWork = (r, p) => {
  if (!onDisk(p)) return relOf(p) in r.work ? r.work[relOf(p)] : null;
  return fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf8') : null;
};

// One of the kit's own scripts run for real, from a real folder.
const realRun = (argv, init) => {
  const cwd = init.cwd && fs.existsSync(init.cwd) ? init.cwd : os.tmpdir();
  const res = spawnSync(BASH, [...NO_RC, ...argv.slice(1)], { cwd, input: init.stdin, encoding: 'utf8', timeout: SPAWN_DEADLINE });
  return runResult({ exitCode: res.status ?? 1, stdout: res.stdout || '', stderr: res.stderr || '' });
};

function runStub(r, cwd) {
  return async (argv, init = {}) => {
    r.calls.run.push({ argv: [...argv], init });
    const failed = r.failOn ? r.failOn(argv) : null;
    if (failed) return runResult(failed);
    const tool = path.basename(argv[0]);
    if (tool === 'git') return git(r, argv.slice(1), init.cwd || cwd, init);
    if (argv.some((a) => a.endsWith('tree-hash.sh'))) {
      return runResult({ stdout: `${argv.includes('-u') || argv.includes('--index') ? allTree(r) : workTree(r)}\n` });
    }
    if (argv.some((a) => a.endsWith('changelog-job.sh')) && argv.includes('rewrite')) {
      const at = argv.indexOf('rewrite');
      const out = rewriteOf(r, argv[at + 1], argv[at + 2]);
      return out === null ? runResult({ exitCode: 1 }) : runResult({ stdout: out });
    }
    if (tool === 'npm' && argv.slice(1, 4).join(' ') === 'config get script-shell') {
      return r.scriptShell === null ? runResult({ exitCode: 127, stderr: 'npm: command not found\n' }) : runResult({ stdout: `${r.scriptShell}\n` });
    }
    if (tool === 'cat') {
      const text = readWork(r, argv[argv.length - 1]);
      return text !== null ? runResult({ stdout: text }) : runResult({ exitCode: 1, stderr: `cat: ${argv[argv.length - 1]}: No such file or directory\n` });
    }
    // cygpath -u: a Windows path's drive dropped, as the hook suites' stub answers.
    if (tool === 'cygpath' && argv[1] === '-u') return runResult({ stdout: `${argv[argv.length - 1].replace(/^[A-Za-z]:/, '')}\n` });
    if (tool === 'mktemp') return runResult({ stdout: `${mkTmp('cg-gate-')}\n` });
    // tee writes its stdin to scratch files for real; a path outside the temp dir is refused.
    if (tool === 'tee') {
      const targets = argv.slice(1).filter((a) => !a.startsWith('-'));
      if (!targets.every((p) => p.startsWith(fs.realpathSync(os.tmpdir())))) return runResult({ exitCode: 1, stderr: 'tee: refused outside the temp dir\n' });
      for (const p of targets) fs.writeFileSync(p, init.stdin ?? '');
      return runResult({ stdout: init.stdin ?? '' });
    }
    // A scratch folder the gate made is removed for real; nothing else is touched.
    if (tool === 'rm') {
      for (const p of argv.slice(1).filter((a) => !a.startsWith('-') && a.startsWith(fs.realpathSync(os.tmpdir())))) fs.rmSync(p, { recursive: true, force: true });
      return runResult();
    }
    if (tool === 'bash' && argv.slice(1).some((a) => a.startsWith(KIT))) return realRun(argv, init);
    return runResult({ exitCode: 127, stderr: `${tool}: command not found\n` });
  };
}

// A scratch git repo holding the same three states, where the real linter runs.
const materialize = (r) => {
  // An empty HEAD cannot be committed, so it takes the opt-in file the linter never reads.
  const { repo, git: runGit, write: writeFile } = mkGitRepo('cg-lint-', r.head, undefined, { optIn: Object.keys(r.head).length === 0 });
  const every = [...new Set([...Object.keys(r.head), ...Object.keys(r.index), ...Object.keys(r.work)])];
  const settle = (files) => {
    for (const p of every) if (!(p in files)) fs.rmSync(path.join(repo, p), { force: true });
    for (const [p, text] of Object.entries(files)) writeFile(p, text);
  };
  settle(r.index);
  runGit('add', '-A');
  settle(r.work);
  return repo;
};

/**
 * commitGateVerdict's facts off the repo, for `command` run from `cwd`. Past
 * the Contract's names it carries `originless` and `read(path)` (a working
 * tree file's text, or null), the reads its list leaves out (the run stub
 * answers the origin read too); `hashOf` is the real hash-object, autocrlf in;
 * `real` answers a file on disk, null for none; `indexTreeId` is the -a tree. `lintSource` is what the linter reads: the
 * index, or the working tree (an -a/--all commit, a pathspec commit).
 */
const factsOf = (r, command, { cwd = ROOT, lintSource } = {}) => {
  const inside = inRepo(cwd);
  const source = lintSource ?? (/(^|\s)(-[A-Za-z]*a[A-Za-z]*|--all)(\s|$)/.test(command) ? 'work' : 'index');
  let scratch = null;
  return {
    command,
    cwd,
    root: inside ? ROOT : null,
    staged: inside ? stagedList(r) : [],
    changed: inside ? changedList(r) : [],
    headTime: r.headTime,
    reviewMarker: r.marker,
    suiteRecord: r.record,
    treeId: inside ? workTree(r) : null,
    isWindows: r.isWindows,
    scriptShell: r.scriptShell,
    scriptShellExe: r.scriptShellExe ?? null,
    // The machine's settings file: a real file when a case sets one, else a path nothing holds.
    userSettings: r.userSettings ?? '/w/user/settings.json',
    show: async (rev, p) => {
      r.calls.show.push([rev, p]);
      const [at, file] = p === undefined ? splitSpec(rev) : [String(rev).replace(/:$/, ''), p];
      const side = sideOf(r, at);
      return file in side ? side[file] : null;
    },
    run: runStub(r, cwd),
    issueView: async (n) => {
      r.calls.issueView.push(String(n));
      const issue = r.issues[n];
      if (r.ghFails || !issue) return null;
      const { comments = [], state = 'OPEN', labels = ['status:complete'], url = `https://github.com/o/r/issues/${n}` } = issue;
      return JSON.stringify({ state, url, labels: labels.map((name) => ({ name })), comments: comments.map((body) => ({ body })) });
    },
    lint: async (p, ...rest) => {
      r.calls.lint.push([p, ...rest]);
      scratch ??= materialize(r);
      const res = spawnSync(process.execPath, [LINTER, path.join(scratch, relOf(p)), '--added-only', ...(source === 'index' ? ['--staged'] : [])],
        { cwd: scratch, encoding: 'utf8', timeout: SPAWN_DEADLINE });
      return runResult({ exitCode: res.status, stdout: res.stdout || '', stderr: res.stderr || '' });
    },
    jobRewrite: async (a, b) => {
      r.calls.jobRewrite.push([a, b]);
      return rewriteOf(r, a, b);
    },
    originless: inside && r.origin === null,
    read: async (p) => readWork(r, p),
    kitRoot: KIT,
    // On a Windows world `real` plays the stub cygpath: a leading drive is dropped first.
    real: async (p) => {
      const q = r.isWindows && typeof p === 'string' ? p.replace(/^[A-Za-z]:/, '') : p;
      return onDisk(q) ? fs.realpathSync(q) : null;
    },
    indexTreeId: async () => (inside ? allTree(r) : null),
    hashOf: async (p, text) => {
      scratch ??= materialize(r);
      const res = spawnSync('git', ['-c', `core.autocrlf=${r.autocrlf}`, 'hash-object', `--path=${relOf(p)}`, '--stdin'], { cwd: scratch, input: text, encoding: 'utf8' });
      assertEq(res.status, 0, `git hash-object answers, stderr: ${res.stderr}`);
      return res.stdout.trim();
    },
  };
};

/** The verdict on `command` over the repo's facts. */
const judge = (r, command, opts) => mods('commit-gate').commitGateVerdict(factsOf(r, command, opts));

const denyOf = (v) => (v && typeof v.deny === 'string' ? v.deny.replace(/\n$/, '') : null);
const contextOf = (v) => (v && v.context !== undefined ? textOf(v.context) : '');

/** The verdict denies with exactly PREFIX + `text`. */
const blocks = (v, text, what) => assertEq(denyOf(v), `${PREFIX}${text}`, what || 'the block');
/** The verdict lets the commit through, saying `notice` (none by default). */
const passes = (v, notice = '', what) => {
  assertEq(denyOf(v), null, what || 'no block');
  assertEq(contextOf(v), notice, `${what || 'the pass'}: its notice`);
};
/** The record block, its log path anywhere in between. */
const recordBlocks = (v) => {
  const deny = denyOf(v);
  assert(deny !== null && deny.startsWith(`${PREFIX}${T.recordHead}`) && deny.endsWith(T.recordTail), `the record block, got: ${deny}`);
};
/** Whether the gate ran a suite: it never may. */
const suiteRan = (r) => r.calls.run.some((c) => /^(npm|node)$/.test(path.basename(c.argv[0])) && c.argv.includes('test'));

// The repo the check 5 cases are asked in: a root test script, package.json and
// a source file committed, so each case stages only what it is about.
const pkg = (version, extra) => `${JSON.stringify({
  name: 'fixture', version, scripts: { test: 'touch suite-ran && exit 1' }, ...extra,
}, null, 2)}\n`;
const mkReleaseRepo = (manifest = pkg('1.0.0')) => {
  const r = mkRepo();
  stage(r, 'package.json', manifest);
  stage(r, 'app.js', 'const x = 1;\n');
  commit(r);
  return r;
};

// A CHANGELOG.md in the format, holding the given bullets under
// [Unreleased] / Added, and the one entry a Fixes #4 commit closes against.
const CHANGELOG = (...bullets) => ['# Changelog', '', '## [Unreleased]', '', '### Added', '', ...bullets.flatMap((b) => [b, ''])].join('\n');
const ISSUE = '[#4](https://github.com/o/r/issues/4)';
const ENTRY = CHANGELOG(`- ${ISSUE} - The thing the issue asked for.`);

// A repo whose commit is ready for every check but 6 and 7: CHANGELOG seeded
// and its entry staged (check 4), code staged, review marker fresh.
const shipReadyRepo = () => {
  const r = mkRepo();
  stage(r, 'CHANGELOG.md', CHANGELOG());
  commit(r);
  stage(r, 'app.js', 'const x = 1;\n');
  stage(r, 'CHANGELOG.md', ENTRY);
  touchMarker(r);
  return r;
};

module.exports = {
  KIT, WORKFLOW_DIR, JOB, TEMPLATE, WRAPPER, ROOT, ELSEWHERE, NOW_S, PREFIX, T, NOTICE,
  mkRepo, stage, write, gitRm, unlink, commit, touchMarker, staleMarker, dropMarker, proveTree,
  factsOf, judge, denyOf, contextOf, blocks, passes, recordBlocks, suiteRan, realRewrite,
  pkg, mkReleaseRepo, CHANGELOG, ISSUE, ENTRY, shipReadyRepo,
};
