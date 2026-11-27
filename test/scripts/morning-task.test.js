// Tests for workflow/morning-task.js, the starter the Windows task runs: it
// starts a job as a process of its own, its output appended to a log, and
// answers once the job has started. Each job is a scratch Node file of the case's.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, until, SPAWN_DEADLINE,
} = require('../lib/harness');
const {
  nodeHomeEnv, jsPath, samePath, spawnSync, stubToolJs,
} = require('../lib/platform');
const { escapeRegex } = require('../../workflow/lib/regex');

const KIT = path.join(__dirname, '..', '..');
const STARTER = path.join(KIT, 'workflow', 'morning-task.js');

// Required at the call, so a starter that does not load fails its case alone.
const starter = () => require(STARTER);

/** A log under a home that holds no Library/Logs yet: the starter makes the folder. */
const logIn = (dir) => path.join(dir, 'home', 'Library', 'Logs', 'com.workkit.claude-daily.log');

describe('workflow/morning-task: the starter', () => {
  test('it answers 0 while its job still waits, and the log keeps every line the job wrote, the later ones too', async (t) => {
    const dir = mkTmp('morning-task-');
    const go = path.join(dir, 'go');
    const done = path.join(dir, 'done');
    const job = path.join(dir, 'job.js');
    // One line to each stream, then a wait on the case's go file, then the last line.
    fs.writeFileSync(job, [
      "const fs = require('fs');",
      "process.stdout.write('first: on stdout\\n');",
      "process.stderr.write('second: on stderr\\n');",
      'const giveUp = Date.now() + 60000;',
      'const tick = setInterval(() => {',
      `  const go = fs.existsSync(${JSON.stringify(go)});`,
      '  if (!go && Date.now() < giveUp) return;',
      '  clearInterval(tick);',
      "  process.stdout.write(go ? 'last: after the answer\\n' : 'last: no go came\\n');",
      `  fs.writeFileSync(${JSON.stringify(done)}, '');`,
      '}, 20);',
    ].join('\n'));
    // Released at the case's end as well, so a failed assertion leaves no job waiting.
    const release = () => fs.writeFileSync(go, '');
    t.after(release);
    const log = logIn(dir);

    const code = await starter().morningTask({ job, log });
    expect(code, 'the job started').toBe(0);
    expect(fs.existsSync(done), 'and the answer came while the job still waited').toBe(false);

    release();
    expect(await until(() => fs.existsSync(done)), 'the job ended once the case let it').toBeTruthy();
    const lines = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
    const at = ['first: on stdout', 'second: on stderr', 'last: after the answer'].map((line) => lines.indexOf(line));
    expect(at.every((i) => i >= 0), `the log holds both streams' lines, the one after the answer too: ${lines.join(' | ')}`).toBeTruthy();
    expect(at[0] < at[1] && at[1] < at[2], `in the order the job wrote them: ${lines.join(' | ')}`).toBeTruthy();
  });

  test('a job that cannot start is one line in the log, and 1', async () => {
    const dir = mkTmp('morning-task-');
    const job = path.join(dir, 'job.js');
    fs.writeFileSync(job, "process.stdout.write('ran\\n');\n");
    const log = logIn(dir);

    const code = await starter().morningTask({ job, log, node: path.join(dir, 'no-such-node') });
    expect(code, 'nothing started').toBe(1);
    expect(fs.readFileSync(log, 'utf8'), 'one line, naming the job and why').toMatch(new RegExp(`^morning-task: could not start ${escapeRegex(job)}: \\S[^\\n]*\\n$`));
  });

  test('a job that is not a file is one line in the log, and 1, with no child started', async () => {
    const dir = mkTmp('morning-task-');
    const job = path.join(dir, 'no-such-job.js');
    const mark = path.join(dir, 'started');
    const node = stubToolJs(dir, 'node', `require('fs').writeFileSync(${JSON.stringify(mark)}, '');`);
    const log = logIn(dir);

    const code = await starter().morningTask({ job, log, node });
    expect(code, 'nothing started').toBe(1);
    const last = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).pop();
    expect(last, 'the last line names the job and why').toMatch(new RegExp(`^morning-task: could not start ${escapeRegex(job)}: \\S`));
    expect(fs.existsSync(mark), 'and no node was started').toBe(false);
  });

  test('the log under a home is its Library/Logs/com.workkit.claude-daily.log', () => {
    const home = path.join(mkTmp('morning-task-'), 'home');
    expect(starter().logFile(home)).toBe(path.join(home, 'Library', 'Logs', 'com.workkit.claude-daily.log'));
  });

  test('loaded through a link to the kit\'s workflow folder, it names the real kit\'s jobs/morning.js', () => {
    const dir = mkTmp('morning-task-link-');
    // A jobs folder beside the link: a `..` read before the link is followed lands here.
    fs.mkdirSync(path.join(dir, 'jobs'));
    fs.writeFileSync(path.join(dir, 'jobs', 'morning.js'), '');
    const link = path.join(dir, 'workkit');
    fs.symlinkSync(path.join(KIT, 'workflow'), link, 'junction');
    const home = path.join(dir, 'home');
    fs.mkdirSync(home);

    const res = spawnSync(process.execPath, ['-e', `process.stdout.write(require(${jsPath(path.join(link, 'morning-task.js'))}).jobFile())`], {
      encoding: 'utf8',
      timeout: SPAWN_DEADLINE,
      env: nodeHomeEnv(home, { ...process.env, WORKFLOW_HOME: path.join(home, '.workkit') }),
    });
    expect(res.status, `the starter loads through the link: ${res.stderr}`).toBe(0);
    const real = fs.realpathSync(path.join(KIT, 'jobs', 'morning.js'));
    expect(samePath(res.stdout, real, process.platform), `the real kit's job, got: ${res.stdout}`).toBeTruthy();
  });
});
