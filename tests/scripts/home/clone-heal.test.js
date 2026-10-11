// Tests for workflow/home.sh: the clone's own heal, the labels and issue forms
// every other repo gets at SessionStart. The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { BASH, NO_RC, shellPath } = require('../../lib/platform');
const { fmtCalls } = require('../../lib/argv-log');
const {
  WORKFLOW_DIR, cleanup, git, mkRemote, mkWorld, inHome, mkKitCopy, kitCommitted,
} = require('./helpers');

const run = async () => {
  group('workflow/home: the clone’s own heal');

  // No session ever opens in the clone, so its heal is invoked here instead,
  // scoped to what makes a repo fileable into: labels and issue forms.
  const cloned = () => {
    const world = mkWorld({
      login: 'owner',
      settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } },
    });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root, { seed: { 'package.json': '{}\n' } });
    inHome(world, 'wk_home_clone owner/workkit');
    return world;
  };
  const forms = ['bug', 'enhancement', 'idea', 'dump'];

  await test('the home repo gets the labels and the forms, and they are pushed', () => {
    const world = cloned();
    const { code, out, err } = inHome(world, 'wk_home_heal');
    assertEq(code, 0, `exit 0: ${out}${err}`);

    const names = world.labels().map((l) => l.name);
    for (const label of ['status:inbox', 'type:idea']) {
      assert(names.includes(label), `${label} was created on the home repo, got: ${names.join(', ')}`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(WORKFLOW_DIR, 'labels.json'), 'utf8'));
    const wanted = Object.entries(manifest.groups)
      .flatMap(([group_, spec]) => Object.keys(spec.values).map((v) => `${group_}:${v}`));
    assertEq(names.length, wanted.length, 'the whole manifest, not a subset');
    const inbox = world.labels().find((l) => l.name === 'status:inbox');
    assertEq(inbox.description, manifest.groups.status.values.inbox.description, 'with the manifest’s own description');

    for (const form of forms) {
      assert(fs.existsSync(path.join(world.tower, '.github', 'ISSUE_TEMPLATE', `${form}.md`)),
        `${form}.md landed in the clone`);
    }

    // The forms are files, so they are committed and pushed: a template only
    // this machine can see applies to nothing filed from a phone.
    const check = path.join(world.root, 'check');
    spawnSync('git', ['clone', '-q', world.env.WORKKIT_HOME_REMOTE, check], { encoding: 'utf8' });
    assert(fs.existsSync(path.join(check, '.github', 'ISSUE_TEMPLATE', 'idea.md')), 'the push landed the forms');
    const subject = spawnSync('git', ['-C', world.tower, 'log', '-1', '--pretty=%s'], { encoding: 'utf8' }).stdout.trim();
    assertEq(subject, 'chore(home): install the issue templates', 'in a commit that says what it is');
    cleanup(world.root);
  });

  await test('a second heal writes nothing, commits nothing and pushes nothing', () => {
    const world = cloned();
    inHome(world, 'wk_home_heal');
    const head = spawnSync('git', ['-C', world.tower, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout;
    const before = world.ghCalls().length;
    const body = fs.readFileSync(path.join(world.tower, '.github', 'ISSUE_TEMPLATE', 'bug.md'), 'utf8');

    // The commit/push is spied on rather than inferred: an empty commit and a
    // push with nothing to send both leave the same repo behind.
    const { code, out } = inHome(world,
      'wk_home_commit_push() { printf "COMMIT_PUSH %s\\n" "$1"; return 0; }\nwk_home_heal');
    assertEq(code, 0, `exit 0: ${out}`);
    assert(!/COMMIT_PUSH/.test(out), `nothing was committed or pushed, got: ${out}`);
    assertEq(spawnSync('git', ['-C', world.tower, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout, head,
      'the clone is exactly where the first run left it');
    assertEq(fs.readFileSync(path.join(world.tower, '.github', 'ISSUE_TEMPLATE', 'bug.md'), 'utf8'), body,
      'and an existing form is never rewritten');

    const second = world.ghCalls().slice(before).map((c) => c.join(' '));
    assert(second.some((c) => c.startsWith('label list')), `it still diffs the labels: ${fmtCalls(world.ghCalls())}`);
    assert(!second.some((c) => c.startsWith('label create') || c.startsWith('label edit')),
      `and finds nothing to create or correct: ${second.join(' | ')}`);
    cleanup(world.root);
  });

  await test('a commit stranded by a failed push is pushed by the next heal', () => {
    // One morning the push fails: the commit stays local and the warning names
    // it. The next heal treats ahead-of-origin as a change, so the forms the
    // home repo needs are never stranded behind one bad morning.
    const world = cloned();
    const remote = world.env.WORKKIT_HOME_REMOTE;
    fs.renameSync(remote, `${remote}.away`);
    const first = inHome(world, 'wk_home_heal');
    assertEq(first.code, 0, `the morning carries on: ${first.out}${first.err}`);
    assert(/could not push/.test(`${first.out}${first.err}`), `the failed push is named, got: ${first.out}${first.err}`);
    fs.renameSync(`${remote}.away`, remote);

    const { code, out, err } = inHome(world, 'wk_home_heal');
    assertEq(code, 0, `exit 0: ${out}${err}`);
    const check = path.join(world.root, 'check-stranded');
    spawnSync('git', ['clone', '-q', remote, check], { encoding: 'utf8' });
    assert(fs.existsSync(path.join(check, '.github', 'ISSUE_TEMPLATE', 'idea.md')),
      'the stranded templates commit landed on the remote');
    cleanup(world.root);
  });

  await test('no clone is a named warning, and the morning carries on', () => {
    const world = mkWorld({
      login: 'owner',
      settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } },
    });
    const { code, out } = inHome(world, 'wk_home_heal\nprintf "carried on\\n"');
    assertEq(code, 0, 'exit 0: a heal that cannot run never stops its caller');
    assert(/nothing is cloned at .*tower/.test(out), `it names the missing clone, got: ${out}`);
    assert(/not healed/.test(out), 'and what went unhealed is named');
    assert(/carried on/.test(out), 'the caller runs on');
    assert(!world.ghCalls().some((c) => c[0] === 'label'), 'nothing was asked of GitHub');
    cleanup(world.root);
  });

  await test('an ordinary repo is refused: the mode heals the clone and nothing else', () => {
    // The participation gate is not bypassed but inverted: --home writes into
    // the tower clone only, so it can never touch a repo that never said yes.
    const world = cloned();
    const other = path.join(world.root, 'other');
    fs.mkdirSync(other, { recursive: true });
    spawnSync('git', ['init', '-q', other], { encoding: 'utf8' });
    const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(WORKFLOW_DIR, 'standards.sh')), '--home', shellPath(other)], {
      env: world.env, encoding: 'utf8', timeout: 30000,
    });
    assertEq(res.status, 1, 'it refuses');
    assert(/not the tower clone/.test(res.stderr || ''), `and says why, got: ${res.stderr}`);
    assert(!fs.existsSync(path.join(other, '.github')), 'nothing was written into it');
    cleanup(world.root);
  });

  // The forms come from the world's kit, read the way the runner is: HEAD's
  // copy when a repo tracks the kit, the folder itself when none does.
  const FORM = 'workflow/templates/issue-forms/bug.md';
  const EDIT = '# an edit to the bug form not yet committed\n';
  const healedBug = (world) => path.join(world.tower, '.github', 'ISSUE_TEMPLATE', 'bug.md');

  await test('a git-backed kit: an uncommitted form edit is not healed in, the committed form is', () => {
    const world = cloned();
    fs.appendFileSync(path.join(world.env.WORKKIT_KIT_DIR, ...FORM.split('/')), EDIT);
    const { code, out } = inHome(world, 'wk_home_heal');
    assertEq(code, 0, `exit 0: ${out}`);
    const body = fs.readFileSync(healedBug(world), 'utf8');
    assertEq(body, kitCommitted(world, FORM), 'the clone holds the kit’s committed bug form, byte for byte');
    assert(!body.includes('not yet committed'), 'and the edit stayed in the kit folder');
    cleanup(world.root);
  });

  await test('a kit copy no repo tracks: the folder is the source, its edit is healed in', () => {
    const world = cloned();
    world.env.WORKKIT_KIT_DIR = mkKitCopy(world.root);
    fs.appendFileSync(path.join(world.env.WORKKIT_KIT_DIR, ...FORM.split('/')), EDIT);
    const { code, out } = inHome(world, 'wk_home_heal');
    assertEq(code, 0, `exit 0: ${out}`);
    assert(fs.readFileSync(healedBug(world), 'utf8').includes('not yet committed'),
      'the folder’s bug form, edit included, reached the clone');
    cleanup(world.root);
  });

  await test('a kit a repo tracks but HEAD lacks heals nothing, says so, and carries on', () => {
    // The kit folder is staged in a repo whose only commit holds none of it, so
    // the committed tree cannot be exported.
    const world = cloned();
    const holder = path.join(world.root, 'holder');
    const kit = mkKitCopy(holder, 'kit');
    fs.writeFileSync(path.join(holder, 'README.md'), '# not the kit\n');
    git(holder, 'init', '-q', '-b', 'main');
    git(holder, 'add', 'README.md');
    const res = git(holder, '-c', 'user.name=kit', '-c', 'user.email=kit@localhost', 'commit', '-q', '-m', 'chore: a readme');
    assertEq(res.status, 0, `the holder committed: ${res.stderr}`);
    git(holder, 'add', 'kit');
    world.env.WORKKIT_KIT_DIR = kit;
    const head = git(world.tower, 'rev-parse', 'HEAD').stdout;
    const before = world.ghCalls().length;

    const { code, out } = inHome(world, 'wk_home_heal');
    assertEq(code, 0, `a heal that cannot run never stops its caller: ${out}`);
    assert(out.includes('labels and issue templates were not healed'), `it names what went unhealed, got: ${out}`);
    assert(!fs.existsSync(path.join(world.tower, '.github', 'ISSUE_TEMPLATE')), 'no form was written');
    assertEq(git(world.tower, 'rev-parse', 'HEAD').stdout, head, 'and nothing was committed');
    const calls = world.ghCalls().slice(before).map((c) => c.join(' '));
    assert(!calls.some((c) => c.startsWith('label create') || c.startsWith('label edit')),
      `and no label was written, got: ${calls.join(' | ')}`);
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
