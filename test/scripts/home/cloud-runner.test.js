// Tests for workflow/home/runner.js and its list, workflow/home/runner-files.js:
// the cloud brief runner seeded onto the home repo, its drift healed, its
// retired files pruned. The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, SPAWN_DEADLINE,
} = require('../../lib/harness');
const {
  NODE_DIR, joinPath, spawnSync,
} = require('../../lib/platform');
const {
  block, inlineValue, listItems, childrenOf, isContent, indentOf,
} = require('../../lib/workflow-yaml');
const {
  KIT_DIR, cleanup, mkRemote, mkWorld, setup, runnerPairs, seeded, mkKitCopy, commitKit, kitCommitted,
  dropRunnerLine,
} = require('./helpers');
const {
  mkWorld: mkCloudWorld, runJob: runCloud, today,
} = require('../../jobs/morning-cloud/helpers');

// The shell an older kit seeded under brief/, none of it on the list.
const RETIRED_SHELL = [
  'jobs/morning.sh', 'workflow/lib/platform.sh',
  'jobs/morning/brief-publish.sh', 'workflow/lib.sh', 'workflow/home.sh', 'workflow/lib/participation.sh',
  'workflow/lib/slug.sh', 'workflow/lib/suite.sh', 'workflow/lib/voice.sh', 'workflow/lib/flows.sh',
  'workflow/lib/state.sh', 'workflow/lib/discussions.sh', 'workflow/lib/command-log.sh',
];

/** Every file under a folder, relative to it, `/` between its parts. */
const filesUnder = (dir) => fs.readdirSync(dir, { recursive: true })
  .filter((rel) => fs.statSync(path.join(dir, rel)).isFile())
  .map((rel) => rel.split(path.sep).join('/'));

/**
 * The command the seeded workflow's last step runs, read off the clone's
 * brief.yml: the `run:` value on its own line, or the lines of its block.
 */
const composeRun = (clone) => {
  const lines = fs.readFileSync(path.join(clone, '.github', 'workflows', 'brief.yml'), 'utf8').split(/\r?\n/);
  const jobs = block(lines, 'jobs', 0);
  const steps = block(jobs, 'steps', indentOf(jobs.slice(1).find(isContent)) + 2);
  const last = listItems(steps).pop();
  const run = block(last, 'run', indentOf(last[0]));
  const value = inlineValue(run);
  return /^[|>]/.test(value) ? childrenOf(run, 0).filter(isContent).map((l) => l.trim()).join('\n') : value;
};

describe('workflow/home: the cloud brief runner', () => {
  // The runner is seeded onto the home repo because a consumer cannot set
  // secrets on the distributed plugin repo. The checkout stays the one source;
  // the clone carries a copy that a later setup refreshes.

  test('every file the runner needs lands in the clone, at the path the workflow names, in HEAD’s bytes with core.autocrlf on', () => {
    // A git on Windows checks text out with CRLF, and an export that honoured
    // it would hand the runner scripts bash cannot read: the world's git says
    // core.autocrlf=true, and the clone must still hold HEAD's bytes.
    const world = mkWorld();
    Object.assign(world.env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.autocrlf', GIT_CONFIG_VALUE_0: 'true' });
    const { code, out } = seeded(world);
    expect(code, `it wrote something: ${out}`).toBe(0);
    for (const { src, dest } of runnerPairs()) {
      expect(fs.existsSync(path.join(world.tower, dest)), `${dest} is in the clone`).toBeTruthy();
      expect(fs.readFileSync(path.join(world.tower, dest), 'utf8'), `${dest} is the kit's committed ${src}, byte for byte`).toBe(kitCommitted(world, src));
    }
    expect(fs.existsSync(path.join(world.tower, '.github', 'workflows', 'brief.yml')), 'the workflow is where Actions looks for it').toBeTruthy();
    cleanup(world.root);
  });

  test('the manifest names every module the composer requires, the stats line included', () => {
    // The stats line is composed on the runner, out of jobs/morning/brief/stats.js
    // and the lib that owns its pattern: a manifest missing either publishes a
    // brief without the block and a history that quietly stops accruing.
    const dests = runnerPairs().map((pair) => pair.dest);
    for (const dest of ['brief/jobs/morning/brief/stats.js', 'brief/tower/api/lib/history.js']) {
      expect(dests.includes(dest), `${dest} is on the runner's list`).toBeTruthy();
    }
  });

  test('the seeded runner composes without reaching back into the checkout', () => {
    // The closure is the whole point: a require the seed missed would only fail
    // on a runner, a morning later. Loading the seeded composer from the clone
    // with the checkout invisible is what proves the list is complete.
    const world = mkWorld();
    seeded(world);
    const entry = path.join(world.tower, 'brief', 'jobs', 'morning', 'brief', 'brief-payload.js');
    const res = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(entry)})`], {
      encoding: 'utf8', timeout: SPAWN_DEADLINE,
    });
    expect(res.status, `the seeded composer loads from the clone alone: ${res.stderr}`).toBe(0);
    cleanup(world.root);
  });

  test('the seeded board reads its label groups from the clone alone', () => {
    // The board finds the label vocabulary by a path beside itself, so a list
    // without the vocabulary hands the runner a board with no groups.
    const world = mkWorld();
    seeded(world);
    const board = path.join(world.tower, 'brief', 'tower', 'api', 'lib', 'board.js');
    const res = spawnSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify([...require(${JSON.stringify(board)}).labelGroups()]))`], {
      encoding: 'utf8', timeout: SPAWN_DEADLINE,
    });
    expect(res.status, `the seeded board loads from the clone alone: ${res.stderr}`).toBe(0);
    expect(JSON.parse(res.stdout).includes('status'), `the copy's board reads the status group: ${res.stdout}`).toBeTruthy();
    cleanup(world.root);
  });

  test('the seeded workflow\'s command, run in the clone alone, runs a cloud morning through to the publish', () => {
    // The closure whole: the command the seeded brief.yml runs, from the
    // clone's root as Actions runs a step, with the checkout out of its reach.
    // A file the list misses, or a command naming none it seeds, fails here.
    const world = mkWorld();
    seeded(world);
    const cloud = mkCloudWorld();
    // The runner's node, after the fake tools so a global `claude` beside it stays hidden.
    const env = { ...cloud.env, PATH: joinPath(path.join(cloud.root, 'bin'), NODE_DIR, cloud.env.PATH) };
    const command = composeRun(world.tower);
    expect(/^\S+( \S+)*$/.test(command), `the step is one program start, its words plain, got: ${command}`).toBeTruthy();
    const [program, ...args] = command.split(' ');
    const res = spawnSync(program, args, {
      cwd: world.tower, encoding: 'utf8', timeout: SPAWN_DEADLINE, env,
    });
    expect(res.status, `the seeded morning ran: ${res.stdout}${res.stderr}`).toBe(0);
    expect(cloud.calls().length, 'the brief was composed and sent').toBe(1);
    expect(cloud.created().length, 'and posted as a Discussion').toBe(1);
    expect(res.stdout.includes(`posted brief: ${today()}`), `which the run says: ${res.stdout}`).toBeTruthy();
    cleanup(cloud.root);
    cleanup(world.root);
  });

  test('every file a cloud morning loads is on the list', () => {
    const pairs = runnerPairs();
    const onTheList = (src) => {
      const pair = pairs.find((p) => p.src === src);
      expect(pair, `${src} is on the runner's list`).toBeTruthy();
      // The entry loads the piece beside itself, so the copy must land at the
      // same relative place under brief/.
      expect(pair.dest, `${src} lands beside its entry`).toBe(`brief/${src}`);
    };

    // Read off the run itself: every node the morning starts
    // writes the modules in its cache as it ends, never read off the source.
    const cloud = mkCloudWorld();
    const loaded = path.join(cloud.root, 'loaded.jsonl');
    const recorder = path.join(cloud.root, 'record-loads.js');
    fs.writeFileSync(recorder, `process.on('exit', () => require('fs').appendFileSync(${JSON.stringify(loaded)}, JSON.stringify(Object.keys(require.cache)) + '\\n'));\n`);
    cloud.env.NODE_OPTIONS = `--require ${recorder}`;
    const res = runCloud(cloud);
    expect(res.status, `the cloud morning ran: ${res.stdout}${res.stderr}`).toBe(0);
    const kitFiles = [...new Set(fs.readFileSync(loaded, 'utf8').split('\n').filter(Boolean).flatMap((line) => JSON.parse(line)))]
      .map((file) => path.relative(KIT_DIR, file))
      .filter((rel) => !rel.startsWith('..') && !path.isAbsolute(rel))
      .map((rel) => rel.split(path.sep).join('/'));
    expect(kitFiles.includes('jobs/morning.js'), `the recorder saw the morning: ${kitFiles.join(', ')}`).toBeTruthy();
    for (const rel of kitFiles) onTheList(rel);
    cleanup(cloud.root);
  });

  test('a clone the older kit seeded loses its retired shell at the next seed, each counted as retired, and holds no shell after it', () => {
    const world = mkWorld();
    seeded(world);
    const old = RETIRED_SHELL.map((rel) => path.join(world.tower, 'brief', ...rel.split('/')));
    for (const file of old) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '# a file the older kit seeded\n');
    }

    const { code, out } = seeded(world);
    expect(code, `the removal counts as a change: ${out}`).toBe(0);
    expect(out.includes(`${RETIRED_SHELL.length} retired`), `and each is counted: ${out}`).toBeTruthy();
    expect(!out.includes('missing'), `with no missing warning: ${out}`).toBeTruthy();
    for (const file of old) expect(!fs.existsSync(file), `${path.relative(world.tower, file)} is gone`).toBeTruthy();
    const shell = filesUnder(path.join(world.tower, 'brief')).filter((rel) => rel.endsWith('.sh'));
    expect(shell, 'the runner the seed leaves is Node alone').toEqual([]);
    cleanup(world.root);
  });

  test('a clone an older kit seeded loses the nine shell steps at the next seed, each counted as retired', () => {
    // An older kit listed the home steps as shell files, so a clone it seeded
    // carries them under brief/; the list names the Node files now, and the
    // shell ones are what a rename left behind.
    const world = mkWorld();
    seeded(world);
    const steps = ['doctor', 'install', 'options', 'repo', 'runner', 'seed', 'services', 'stamp', 'wizard'];
    const old = steps.map((step) => path.join(world.tower, 'brief', 'workflow', 'home', `${step}.sh`));
    for (const file of old) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '# a step the older kit seeded\n');
    }

    const { code, out } = seeded(world);
    expect(code, `the removal counts as a change: ${out}`).toBe(0);
    expect(out.includes('9 retired'), `and each is counted: ${out}`).toBeTruthy();
    expect(!out.includes('missing'), `with no missing warning: ${out}`).toBeTruthy();
    for (const file of old) expect(!fs.existsSync(file), `${path.basename(file)} is gone`).toBeTruthy();
    cleanup(world.root);
  });

  test('a second seed writes nothing, and a changed source is picked up', () => {
    const world = mkWorld();
    seeded(world);
    const dest = path.join(world.tower, 'brief', 'jobs', 'morning.js');
    const before = fs.statSync(dest).mtimeMs;

    const again = seeded(world);
    expect(again.code, `nothing was written the second time: ${again.out}`).toBe(2);
    expect(/is current/.test(again.out), `and it says so: ${again.out}`).toBeTruthy();
    expect(fs.statSync(dest).mtimeMs, 'the file was not rewritten').toBe(before);

    // Drift, the only reason the copy is ever touched again: the file in the
    // clone differs from the checkout it came from.
    fs.writeFileSync(dest, '# an older runner\n');
    const refreshed = seeded(world);
    expect(refreshed.code, `the drift is healed: ${refreshed.out}`).toBe(0);
    expect(fs.readFileSync(dest, 'utf8'), 'back to the kit’s committed copy').toBe(kitCommitted(world, 'jobs/morning.js'));
    cleanup(world.root);
  });

  test('a file the manifest stopped naming is pruned from the clone', () => {
    // `brief/` in the clone is engine territory, so a file the manifest does
    // not name is what a rename left behind.
    const world = mkWorld();
    seeded(world);
    const retired = path.join(world.tower, 'brief', 'jobs', 'claude-cloud.sh');
    const retiredDeep = path.join(world.tower, 'brief', 'gone', 'nested', 'old.js');
    fs.writeFileSync(retired, '# last month’s runner\n');
    fs.mkdirSync(path.dirname(retiredDeep), { recursive: true });
    fs.writeFileSync(retiredDeep, '// also gone\n');

    const pruned = seeded(world);
    expect(pruned.code, `the removal counts as a change: ${pruned.out}`).toBe(0);
    expect(!fs.existsSync(retired), 'the retired script is gone').toBeTruthy();
    expect(!fs.existsSync(retiredDeep), 'and so is one under a folder of its own').toBeTruthy();
    expect(!fs.existsSync(path.join(world.tower, 'brief', 'gone')), 'the folder it emptied went with it').toBeTruthy();
    for (const { dest } of runnerPairs()) {
      expect(fs.existsSync(path.join(world.tower, dest)), `${dest}, which the manifest names, survived`).toBeTruthy();
    }

    // Idempotent: with nothing left to prune the run is a no-op again.
    const again = seeded(world);
    expect(again.code, `a second run removes nothing: ${again.out}`).toBe(2);
    cleanup(world.root);
  });

  test('the prune touches nothing outside the runner folder', () => {
    const world = mkWorld();
    seeded(world);
    const mine = path.join(world.tower, 'targets', 'web', 'src', 'notes.md');
    fs.mkdirSync(path.dirname(mine), { recursive: true });
    fs.writeFileSync(mine, '# the project’s own\n');
    fs.writeFileSync(path.join(world.tower, 'README.md'), '# the home repo\n');

    const again = seeded(world);
    expect(again.code, `nothing in the clone counted as a change: ${again.out}`).toBe(2);
    expect(fs.readFileSync(mine, 'utf8'), 'the project’s file is untouched').toBe('# the project’s own\n');
    expect(fs.existsSync(path.join(world.tower, 'README.md')), 'and so is what sits at the root').toBeTruthy();
    cleanup(world.root);
  });

  test('an incomplete checkout warns and seeds what it has', () => {
    const world = mkWorld();
    // The list travels with the kit's workflow/ folder, so a partial kit keeps
    // that folder and loses the composer's.
    const partial = mkKitCopy(world.root, 'partial-kit');
    fs.rmSync(path.join(partial, 'jobs', 'morning', 'brief'), { recursive: true });
    world.env.WORKKIT_KIT_DIR = partial;

    const { out } = seeded(world);
    expect(/runner is incomplete/.test(out), `it names the state: ${out}`).toBeTruthy();
    expect(/brief-payload\.js/.test(out), `and what is missing: ${out}`).toBeTruthy();
    expect(fs.existsSync(path.join(world.tower, 'brief', 'jobs', 'morning.js')), 'what was there still landed').toBeTruthy();
    cleanup(world.root);
  });

  test('a git-backed kit: an uncommitted edit is not the runner, the clone keeps the committed bytes', () => {
    const world = mkWorld();
    const script = path.join(world.env.WORKKIT_KIT_DIR, 'jobs', 'morning.js');
    const before = fs.readFileSync(script, 'utf8');
    const first = seeded(world);
    expect(first.code, `the first seed wrote the runner: ${first.out}`).toBe(0);

    fs.appendFileSync(script, '# an edit not yet committed\n');
    const again = seeded(world);
    expect(again.code, `the refresh is already current: ${again.out}`).toBe(2);
    const clone = fs.readFileSync(path.join(world.tower, 'brief', 'jobs', 'morning.js'), 'utf8');
    expect(!clone.includes('# an edit not yet committed'), 'the edit stayed in the kit folder').toBeTruthy();
    expect(clone, 'the clone holds the committed bytes').toBe(before);
    cleanup(world.root);
  });

  test('a git-backed kit: a new commit is the runner the refresh writes', () => {
    const world = mkWorld();
    seeded(world);

    fs.writeFileSync(path.join(world.env.WORKKIT_KIT_DIR, 'jobs', 'morning.js'), '# a committed runner\n');
    commitKit(world.env.WORKKIT_KIT_DIR, 'fix: a newer runner');
    const { code, out } = seeded(world);
    expect(code, `the refresh wrote it: ${out}`).toBe(0);
    expect(/seeded the cloud brief/.test(out), `and said so: ${out}`).toBeTruthy();
    expect(fs.readFileSync(path.join(world.tower, 'brief', 'jobs', 'morning.js'), 'utf8'), 'the clone holds the new commit').toBe('# a committed runner\n');
    cleanup(world.root);
  });

  test('a kit missing a listed file prunes nothing: the retired file waits, the rest lands', () => {
    // A missing file is a broken kit, not a retirement, so the prune holds off
    // until the kit is whole again.
    const world = mkWorld();
    const first = seeded(world);
    expect(first.code, `the whole kit seeded first: ${first.out}`).toBe(0);
    const retired = path.join(world.tower, 'brief', 'jobs', 'claude-cloud.sh');
    fs.writeFileSync(retired, '# last month’s runner\n');
    const kit = world.env.WORKKIT_KIT_DIR;
    fs.rmSync(path.join(kit, 'jobs', 'morning', 'brief', 'stats.js'));
    fs.writeFileSync(path.join(kit, 'jobs', 'morning.js'), '# a committed runner\n');
    commitKit(kit, 'chore: a kit missing a file');

    const { out } = seeded(world);
    expect(out.includes('this kit is missing'), `it warns: ${out}`).toBeTruthy();
    expect(out.includes('stats.js'), `and names what is missing: ${out}`).toBeTruthy();
    expect(fs.existsSync(retired), 'the retired file is still there: the prune waited').toBeTruthy();
    expect(fs.readFileSync(retired, 'utf8'), 'untouched').toBe('# last month’s runner\n');
    expect(fs.readFileSync(path.join(world.tower, 'brief', 'jobs', 'morning.js'), 'utf8'), 'what the kit has still landed').toBe('# a committed runner\n');
    cleanup(world.root);
  });

  // The list is read from the same tree as the files: a pair dropped from the
  // kit's runner-files.js changes the runner only once it is committed.
  const STATS = 'jobs/morning/brief/stats.js';

  test('a git-backed kit: a list line dropped but not committed retires nothing', () => {
    const world = mkWorld();
    const first = seeded(world);
    expect(first.code, `the whole kit seeded first: ${first.out}`).toBe(0);
    dropRunnerLine(world.env.WORKKIT_KIT_DIR, STATS);

    const { code, out } = seeded(world);
    expect(code === 2 && /is current/.test(out), `the refresh is current: ${out}`).toBeTruthy();
    expect(!out.includes('missing'), `with no missing warning: ${out}`).toBeTruthy();
    const copy = path.join(world.tower, 'brief', 'jobs', 'morning', 'brief', 'stats.js');
    expect(fs.existsSync(copy), 'the clone keeps the copy HEAD still ships').toBeTruthy();
    expect(fs.readFileSync(copy, 'utf8'), 'byte for byte as committed').toBe(kitCommitted(world, STATS));
    cleanup(world.root);
  });

  test('a git-backed kit: a commit that drops a line and its file prunes the clone’s copy', () => {
    const world = mkWorld();
    seeded(world);
    const kit = world.env.WORKKIT_KIT_DIR;
    dropRunnerLine(kit, STATS);
    fs.rmSync(path.join(kit, ...STATS.split('/')));
    commitKit(kit, 'refactor: retire the stats module');

    const { code, out } = seeded(world);
    expect(code, `the removal counts as a change: ${out}`).toBe(0);
    expect(out.includes('1 retired'), `and is counted: ${out}`).toBeTruthy();
    expect(!out.includes('missing'), `with no missing warning: ${out}`).toBeTruthy();
    expect(!fs.existsSync(path.join(world.tower, 'brief', 'jobs', 'morning', 'brief', 'stats.js')),
      'the clone’s copy is gone').toBeTruthy();
    cleanup(world.root);
  });

  test('setup pushes the runner, and a checkout that moved on is its own commit', () => {
    const world = mkWorld({ login: 'owner' });
    const remote = mkRemote(world.root);
    world.env.WORKKIT_HOME_REMOTE = remote;
    world.env.WORKKIT_KIT_DIR = mkKitCopy(world.root);
    setup(world);

    const check = path.join(world.root, 'check');
    spawnSync('git', ['clone', '-q', remote, check], { encoding: 'utf8' });
    expect(fs.existsSync(path.join(check, '.github', 'workflows', 'brief.yml')), 'the workflow reached the home repo').toBeTruthy();
    expect(fs.existsSync(path.join(check, 'brief', 'jobs', 'morning.js')), 'and the script it runs').toBeTruthy();

    // The checkout moves on, the way it does between releases. The next setup
    // finds a seeded clone, refreshes the copy, and pushes that on its own.
    fs.writeFileSync(path.join(world.env.WORKKIT_KIT_DIR, 'jobs', 'morning.js'), '# a newer runner\n');
    const { out } = setup(world);
    expect(/seeded the cloud brief/.test(out), `the refresh happened: ${out}`).toBeTruthy();
    expect(fs.readFileSync(path.join(world.tower, 'brief', 'jobs', 'morning.js'), 'utf8'), 'the clone carries the new one').toBe('# a newer runner\n');
    const subject = spawnSync('git', ['-C', world.tower, 'log', '-1', '--pretty=%s'], { encoding: 'utf8' }).stdout.trim();
    expect(subject, 'in a commit that says what it is').toBe('chore(home): refresh the cloud brief runner');
    cleanup(world.root);
  });
});
