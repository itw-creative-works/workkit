// Tests for jobs/lib/task-scheduler.js, the Windows half of the 9am job's
// installer, called in this process on every system: `schtasks` is a Node
// stand-in first on the PATH the install is handed, so the suite reads the calls
// and the bytes a registration would make, never the machine's Task Scheduler.

const fs = require('fs');
const path = require('path');
const { describe, test, expect, mkTmp } = require('../lib/harness');
const { pathWith } = require('../lib/platform');
const { schtasksStub } = require('../lib/schtasks-stub');
const { underEnv } = require('../lib/under-env');
const {
  renderTask, encodeTask, installTask, checkTask,
} = require('../../jobs/lib/task-scheduler');

const TEMPLATE = path.join(__dirname, '..', '..', 'jobs', 'com.workkit.claude-daily.xml');
const LABEL = 'com.workkit.claude-daily';
const TASK = 'workkit\\com.workkit.claude-daily';

const ADA = { node: 'C:\\Program Files\\nodejs\\node.exe', home: 'C:\\Users\\Ada', user: 'Ada' };

// The task file for ADA, written out whole: what Task Scheduler is handed.
const ADA_TASK = String.raw`<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>The workkit 9am daily job</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-01-01T09:00:00</StartBoundary>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>Ada</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>C:\Program Files\nodejs\node.exe</Command>
      <Arguments>"C:\Users\Ada\.claude\workkit\morning-task.js"</Arguments>
    </Exec>
  </Actions>
</Task>
`;

// A short task text with one letter outside ASCII, and its bytes as schtasks
// reads them: the byte order mark, then each letter as two bytes, low first.
const SHORT = '<T>é</T>';
const SHORT_BYTES = 'fffe3c0054003e00e9003c002f0054003e00';

// Not the installer's own text, so the installed line shows the one handed in.
const WHEN = 'every day at nine';
const INSTALLED = `${LABEL} → installed (every day at nine)`;

/**
 * A scratch machine: the stand-in in its own PATH folder answering by `state`,
 * and the kept copy's path under a machine folder whose `scheduled/` exists.
 */
const mkWorld = (state) => {
  const root = mkTmp('workkit-task-');
  const bin = path.join(root, 'bin');
  const scheduled = path.join(root, 'machine', 'scheduled');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(scheduled, { recursive: true });
  return {
    root,
    bin,
    stub: schtasksStub(bin, state),
    copy: path.join(scheduled, `${LABEL}.xml`),
    env: { ...process.env, PATH: pathWith(bin) },
  };
};

const install = async (world, text, { scheduleOk = true, env = world.env } = {}) => {
  const res = await installTask({
    label: LABEL, text, copy: world.copy, when: WHEN, scheduleOk, env,
  });
  return { code: res.code, line: res.line };
};

const check = async (world, text) => (await checkTask({ label: LABEL, text, copy: world.copy })).line;

const isQuery = (call) => call.length === 3 && call[0] === '/query' && call[1] === '/tn' && call[2] === TASK;

describe('jobs/lib/task-scheduler: the task file', () => {
  test('for a fixed Node, home and user the task file is the text written out here', () => {
    const text = renderTask(fs.readFileSync(TEMPLATE, 'utf8'), ADA);
    expect(text).toBe(ADA_TASK);
  });

  test('a home holding & and a user holding < and " are escaped in the task file', () => {
    const text = renderTask(fs.readFileSync(TEMPLATE, 'utf8'), { ...ADA, home: 'C:\\Users\\A&B', user: 'Ada<"x' });
    expect(text, 'the home').toContain('"C:\\Users\\A&amp;B\\.claude\\workkit\\morning-task.js"');
    expect(text, 'the user').toContain('<UserId>Ada&lt;&quot;x</UserId>');
    expect(text, 'no raw & is left').not.toContain('A&B');
    expect(text, 'no raw < or " is left').not.toContain('Ada<"x');
  });

  test('the bytes handed to schtasks are the byte order mark, then the text as UTF-16LE', () => {
    const bytes = encodeTask(SHORT);
    expect(bytes.subarray(0, 2).toString('hex'), 'the first two bytes').toBe('fffe');
    expect(bytes.toString('hex'), 'every byte').toBe(SHORT_BYTES);
    expect(bytes.subarray(2).toString('utf16le'), 'and they decode back to the text').toBe(SHORT);
  });
});

describe('jobs/lib/task-scheduler: the install', () => {
  test('a first install: one /create of the task from a UTF-16LE file, the copy kept, the installed line', async () => {
    const world = mkWorld({ exists: false, create: 0 });
    expect(await install(world, SHORT)).toEqual({ code: 0, line: INSTALLED });
    const creates = world.stub.creates();
    expect(creates.length, `one /create: ${JSON.stringify(world.stub.calls())}`).toBe(1);
    const [verb, tn, task, xml, , force] = creates[0];
    expect([verb, tn, task, xml, force, creates[0].length], 'the call').toEqual(['/create', '/tn', TASK, '/xml', '/f', 6]);
    expect(world.stub.kept().toString('hex'), 'the file it named holds the encoded text').toBe(SHORT_BYTES);
    expect(fs.readFileSync(world.copy, 'utf8'), 'and the copy keeps the text').toBe(SHORT);
  });

  test('a second run with the task registered: no /create, the already-installed line', async () => {
    const world = mkWorld({ exists: false, create: 0 });
    await install(world, SHORT);
    world.stub.set({ exists: true, create: 0 });
    const before = world.stub.calls().length;
    expect(await install(world, SHORT)).toEqual({ code: 0, line: `${LABEL} → already installed` });
    const added = world.stub.calls().slice(before);
    expect(added.some((c) => c[0] === '/create'), `no /create: ${JSON.stringify(added)}`).toBe(false);
    expect(added.some(isQuery), `the task is asked for: ${JSON.stringify(added)}`).toBe(true);
  });

  // A new template and another Node both reach installTask as another text.
  test('a changed task file: /create again and the installed line', async () => {
    const world = mkWorld({ exists: false, create: 0 });
    await install(world, SHORT);
    world.stub.set({ exists: true, create: 0 });
    expect(await install(world, '<T>other</T>')).toEqual({ code: 0, line: INSTALLED });
    expect(world.stub.creates().length, `a second /create: ${JSON.stringify(world.stub.calls())}`).toBe(2);
    expect(world.stub.kept().subarray(2).toString('utf16le'), 'of the new text').toBe('<T>other</T>');
  });

  test('a task removed by hand: /create again and the registered-again line', async () => {
    const world = mkWorld({ exists: false, create: 0 });
    await install(world, SHORT);
    world.stub.set({ exists: false, create: 0 });
    const before = world.stub.calls().length;
    expect(await install(world, SHORT)).toEqual({ code: 0, line: `${LABEL} → registered again (task file unchanged)` });
    const added = world.stub.calls().slice(before);
    expect(added.some(isQuery), `the task is asked for: ${JSON.stringify(added)}`).toBe(true);
    expect(added.filter((c) => c[0] === '/create').length, `and made again: ${JSON.stringify(added)}`).toBe(1);
  });

  test('a /create that fails: its code, no copy, so the next run tries again', async () => {
    const world = mkWorld({ exists: false, create: 5 });
    expect(await install(world, SHORT)).toEqual({ code: 5, line: `${LABEL} → the task was not registered (schtasks exit 5)` });
    expect(fs.existsSync(world.copy), 'no copy is written').toBe(false);
    world.stub.set({ exists: false, create: 0 });
    expect(await install(world, SHORT)).toEqual({ code: 0, line: INSTALLED });
    expect(world.stub.creates().length, 'the next run asked again').toBe(2);
  });

  test('a /create that fails saying why: the line ends on the last line it wrote to stderr', async () => {
    const world = mkWorld({
      exists: false,
      create: 1,
      createErr: 'WARNING: first\r\n  ERROR: The task XML contains a value which is incorrectly formatted.  \r\n\r\n',
    });
    expect(await install(world, SHORT)).toEqual({
      code: 1,
      line: `${LABEL} → the task was not registered (schtasks exit 1: ERROR: The task XML contains a value which is incorrectly formatted.)`,
    });
    expect(fs.existsSync(world.copy), 'no copy is written').toBe(false);
  });

  test('a schtasks that cannot start: the code of a command that never started, and no copy', async () => {
    const world = mkWorld({});
    const empty = path.join(world.root, 'empty');
    fs.mkdirSync(empty);
    const res = await install(world, SHORT, { env: { ...process.env, PATH: empty } });
    expect(res).toEqual({ code: 127, line: `${LABEL} → the task was not registered (schtasks exit 127)` });
    expect(fs.existsSync(world.copy), 'no copy is written').toBe(false);
  });

  test('a home that is not the account\'s: no schtasks call, no copy, the would-register line', async () => {
    const world = mkWorld({ exists: false, create: 0 });
    expect(await install(world, SHORT, { scheduleOk: false })).toEqual({
      code: 0,
      line: `${LABEL} → would register it (skipped: HOME is not this account's home; set WORKKIT_SCHEDULE_OK=1 to force)`,
    });
    expect(world.stub.calls(), 'not one schtasks call').toEqual([]);
    expect(world.stub.kept(), 'nothing handed over').toBe(null);
    expect(fs.existsSync(world.copy), 'and no copy').toBe(false);
  });
});

describe('jobs/lib/task-scheduler: --check', () => {
  test('its three answers, and no schtasks call in any of them', async () => {
    const world = mkWorld({ exists: true, create: 0 });
    const answers = await underEnv({ PATH: pathWith(world.bin) }, async () => {
      const none = await check(world, SHORT);
      const noneCalls = world.stub.calls();
      await install(world, SHORT);
      const before = world.stub.calls().length;
      const drifted = await check(world, '<T>other</T>');
      const current = await check(world, SHORT);
      return { none, drifted, current, noneCalls, added: world.stub.calls().slice(before) };
    });
    expect(answers.none, 'no copy').toBe(`${LABEL} → not installed`);
    expect(answers.drifted, 'a copy of another text').toBe(`${LABEL} → out of date for this kit`);
    expect(answers.current, 'a copy of this text').toBe('');
    expect(answers.noneCalls, 'no schtasks call for a missing copy').toEqual([]);
    expect(answers.added, 'nor for a copy').toEqual([]);
  });
});
