// The kit's three lists of what is not Node, each read against the tree's own text: the
// test files that may use a shell, the programs a kit Node file may start, and the shell
// files that stay. A use off a list fails its case by name; a listed test file that no
// longer uses a shell fails too, so the list cannot rot.

const path = require('path');
const fs = require('fs');
const { describe, test, expect } = require('../lib/harness');
const { spawnSync } = require('../lib/platform');

const ROOT = path.join(__dirname, '..', '..');
const SELF = path.relative(ROOT, __filename).split(path.sep).join('/');

// Every file git tracks or would track, by its path from the root with `/`.
const treeFiles = () => {
  const res = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git ls-files failed: ${res.error || res.stderr}`);
  return res.stdout.split('\0').filter((rel) => rel && fs.statSync(path.join(ROOT, rel), { throwIfNoEntry: false })?.isFile());
};
const textOf = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const firstLine = (rel) => textOf(rel).split('\n', 1)[0];

// Each test file that may hold a shell `#!` line or start bash or sh, with its reason.
const TEST_SHELL = {
  'test/hooks/capture-guard/user-level.test.js': 'a skill line, run as the session\'s shell runs it',
  'test/hooks/commit-gate/marker.test.js': 'a skill line, run as the session\'s shell runs it',
  'test/hooks/commit-gate/suite.test.js': 'a staged run.sh the gate judges as code, its #! line file text, never run',
  'test/hooks/script-write.test.js': 'a script the session\'s shell runs is the subject',
  'test/hooks/twins.test.js': 'the shell twin of a Node rule is the subject',
  'test/hooks/workflow-snapshot.test.js': 'the gh shim, started from a shell',
  'test/jobs/morning-cloud/morning-d.test.js': 'a person\'s own morning.d .sh file is the subject',
  'test/jobs/morning-local/morning-d.test.js': 'a person\'s own morning.d .sh files are the subject',
  'test/jobs/morning-local/no-tools.test.js': 'a person\'s own morning.d .sh file is the subject',
  'test/lib/checks-template.js': 'an old checks.yml the heal rewrites, its shell fixture text, never run',
  'test/lib/core-repo.js': 'npm\'s script shell, reached from a person\'s shell',
  'test/lib/identity.js': 'the gh shim started from a shell, and util-linux script\'s one -c line',
  'test/lib/never-collects.js': 'a descriptor a shell hands over',
  'test/lib/platform.js': 'the shell seams themselves, and stubToolJs\'s sh head for a node path with a space',
  'test/lib/script-shell.js': 'npm\'s script shell, reached from a person\'s shell',
  'test/scripts/ci-watch.test.js': 'the shell that invokes the watch, as the session\'s shell runs a skill line',
  'test/scripts/detach.test.js': 'a shell child\'s output reaching the log is the subject',
  'test/scripts/githooks.test.js': 'git\'s hooks, reached from a shell',
  'test/scripts/gitshim.test.js': 'the git shim, started from a shell',
  'test/scripts/identity/gh-shim.test.js': 'the gh shim, started and found by name from a shell',
  'test/scripts/identity/rest-pr.test.js': 'pr checks --watch through the gh shim, started from a shell',
  'test/scripts/logs-dir.test.js': 'npm\'s script shell, reached from a person\'s shell',
  'test/scripts/pages-workflow.test.js': 'a runner runs a run: line as bash -c',
  'test/scripts/run.test.js': 'the starter\'s bash name, and a #!/bin/sh file its #! rule reads',
  'test/scripts/say.test.js': 'a descriptor a shell hands over',
  'test/scripts/script-shell-detached.test.js': 'npm\'s script shell, reached from a person\'s shell',
  'test/scripts/script-shell.test.js': 'npm\'s script shell is the subject',
  'test/scripts/supervise.test.js': 'npm\'s script shell, reached from a person\'s shell',
  'test/scripts/watch.test.js': 'npm\'s script shell, reached from a person\'s shell',
  'test/scripts/workkit-cli/sections.test.js': 'a start from Git Bash, which rewrites WORKFLOW_CLAUDE_HOME before node reads it',
  'test/spawn.test.js': 'Git Bash\'s own reading of an argument the harness\'s run hands it, and the name bash start is refused without Git Bash',
};

// A shell `#!` line; a use of the shell seams (BASH, SH, SYSTEM_BASH, spawnBash,
// spawnSystemBash); a start call handed `bash` or `sh` as a literal. A Node stand-in
// NAMED bash is written through stubToolJs, which none of these match.
const SHELL_USE = [
  /#! ?(?:\/usr\/bin\/env +|\/usr\/bin\/|\/bin\/)(?:ba)?sh\b/,
  /\b(?:BASH|SH|SYSTEM_BASH|spawnBash|spawnSystemBash)\b/,
  /\b(?:spawn|spawnSync|execFile|execFileSync|run|start)\(\s*\[?\s*(['"`])(?:\/usr)?(?:\/bin\/)?(?:ba)?sh(?:\.exe)?\1/,
];

// Each program a kit Node file outside test/ may start, with its reason.
const ALLOWED_STARTS = {
  git: 'the repo itself: its history, index and hooks',
  gh: 'GitHub, through its own command',
  npm: 'a repo\'s install, scripts and packages',
  node: 'the kit\'s own programs, each in a node of its own',
  claude: 'Claude Code itself',
  bash: 'a repo\'s own hook command and suite, a person\'s morning.d .sh file, Git Bash\'s ps table, and Git Bash for a #! file on Windows',
  sh: 'an npm script, a shell line by npm\'s design, and a file with no #! line, by the system\'s rule',
  cmd: 'Windows runs a .cmd or .bat file only through its command interpreter',
  powershell: 'the only reader of the Windows process table',
  ps: 'the only reader of the process table',
  lsof: 'the only reader of who holds a port, off Windows',
  netstat: 'the only reader of who holds a port, on Windows',
  getconf: 'the only reader of the macOS user temp folder',
  cygpath: 'Git Bash\'s own path spelling',
  plutil: 'the macOS check of a launchd plist',
  launchctl: 'the macOS job scheduler',
  schtasks: 'the Windows job scheduler',
  caffeinate: 'holds a Mac awake while a run lives',
  open: 'the macOS browser opener',
  'xdg-open': 'the Linux browser opener',
  expect: 'a pty, which Node has no call for without a native dependency',
  script: 'a pty where expect is missing',
  taskkill: 'the Windows tree end',
  csc: 'builds the Windows script shell from script-shell.cs',
  Notifly: 'the notifier app a job speaks through',
};

// A start of a program by a literal name: a call to a starter (spawn, spawnSync,
// execFile, execFileSync, exec, execSync, fork, run, runProgram, start, bounded) handed a
// string or an argv array led by one, a `program:` key, or any `<name>.exe`. A name held
// in a variable is read through its constant (heldBy).
const STARTER = String.raw`\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|fork|run|runProgram|start|bounded)\(`;
const STARTS = [
  new RegExp(String.raw`${STARTER}\s*\[?\s*(['"\`])([^'"\`\s$]+)\1`, 'g'),
  /\bprogram:\s*(['"`])([^'"`\s$]+)\1/g,
  /(['"`])([^'"`\s$]*\w\.exe)\1/gi,
];
// A starter handed a name, and the forms a constant holds a program in, its name the last
// group: a literal, either arm of a choice of two, a template's or a path.join's last part,
// and an array's head, read only below a destructure (`const [cmd] = ...`).
const BY_NAME = new RegExp(String.raw`${STARTER}\s*([A-Za-z_]\w*)\s*,`, 'g');
const HELD = [
  /^\s*(['"`])([\w.-]+)\1\s*$/g,
  /\?\s*(['"`])([\w.-]+)\1\s*:\s*['"`]/g,
  /\?\s*(['"`])[\w.-]+\1\s*:\s*(['"`])([\w.-]+)\2/g,
  /`[^`]*\/([\w.-]+)`/g,
  /\bpath(?:\.win32|\.posix)?\.join\([^)]*(['"])([\w.-]+)\1\s*\)/g,
];
const HEAD = /\[\s*(['"`])([\w.-]+)\1/g;
// What each `const <name> = <value to its first ;>` of the file holds, then what the name
// the value starts with holds (`awake`, `opener()`). Names match as text, not by scope, so a
// start handed a function's parameter stays unseen unless a constant shares its name.
const heldBy = (text, name, unpacked = false, seen = new Set()) => {
  if (seen.has(name)) return [];
  seen.add(name);
  return [...text.matchAll(new RegExp(`\\bconst\\s+(\\[\\s*)?${name}\\b[^=;]*=\\s*([^;]*)`, 'g'))].flatMap(([, bracket, value]) => {
    const inArray = unpacked || Boolean(bracket);
    const next = /^\s*([A-Za-z_]\w*)/.exec(value);
    return [
      ...(inArray ? [...HELD, HEAD] : HELD).flatMap((re) => [...value.matchAll(re)].map((m) => m.at(-1))),
      ...(next ? heldBy(text, next[1], inArray, seen) : []),
    ];
  });
};
const programOf = (literal) => path.posix.basename(literal.replace(/\\+/g, '/')).replace(/\.(exe|cmd)$/i, '');
const isKitNode = (rel) => !rel.startsWith('test/')
  && (/\.(c|m)?js$/.test(rel) || (!path.extname(rel) && /^#!.*\bnode\b/.test(firstLine(rel))));

// The shell files that stay: git's hooks and their library, the git shim, npm's
// script shell, the Windows launcher's template, the Windows script shell, the pty runner.
const SHELL_FILES = [
  ...['applypatch-msg', 'commit-msg', 'post-applypatch', 'post-checkout', 'post-commit', 'post-index-change',
    'post-merge', 'post-rewrite', 'pre-applypatch', 'pre-auto-gc', 'pre-commit', 'pre-merge-commit', 'pre-push',
    'pre-rebase', 'prepare-commit-msg', 'sendemail-validate', 'hook.sh'].map((name) => `workflow/githooks/${name}`),
  'workflow/gitshim/git',
  'workflow/script-shell.sh',
  'workflow/workkit.cmd',
  'workflow/script-shell.cs',
  'workflow/workkit/mint-pty.exp',
];
// A file another program than Node reads as its script: a #! line naming any program
// but node, or a shell, batch, PowerShell, C# or Expect name.
const isShellFile = (rel) => /\.(sh|bash|zsh|cmd|bat|ps1|cs|exp)$/i.test(rel)
  || (/^#!/.test(firstLine(rel)) && !/^#!.*\bnode\b/.test(firstLine(rel)));

describe('shell list', () => {
  const files = treeFiles();

  test('every test file using a shell is on the list, and every listed one still does', () => {
    const using = files.filter((rel) => rel.startsWith('test/') && rel !== SELF
      && SHELL_USE.some((re) => re.test(textOf(rel))));
    expect(using.filter((rel) => !TEST_SHELL[rel]), 'off the list, using a shell').toEqual([]);
    expect(Object.keys(TEST_SHELL).filter((rel) => !using.includes(rel)), 'on the list, using no shell').toEqual([]);
  });

  test('a kit Node file starts only the programs on the list, and every listed one is started', () => {
    const starts = files.filter(isKitNode).flatMap((rel) => {
      const text = textOf(rel);
      const programs = new Set([
        ...STARTS.flatMap((re) => [...text.matchAll(re)].map((m) => m[2])),
        ...[...text.matchAll(BY_NAME)].flatMap(([, name]) => heldBy(text, name)),
      ].map(programOf));
      return [...programs].map((program) => ({ rel, program }));
    });
    const offList = starts.filter(({ program }) => !Object.hasOwn(ALLOWED_STARTS, program));
    expect(offList.map(({ rel, program }) => `${rel} starts ${program}`), 'starts off the list').toEqual([]);
    expect(Object.keys(ALLOWED_STARTS).filter((program) => !starts.some((s) => s.program === program)), 'on the list, started nowhere')
      .toEqual([]);
  });

  test('the shell files are exactly the ones that stay', () => {
    const found = files.filter(isShellFile).sort();
    expect(found.filter((rel) => !SHELL_FILES.includes(rel)), 'a shell file off the list').toEqual([]);
    expect(SHELL_FILES.filter((rel) => !found.includes(rel)), 'a listed shell file gone').toEqual([]);
  });
});
