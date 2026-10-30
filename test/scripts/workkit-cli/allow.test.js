// Tests for workflow/workkit.sh: the kit's allow rules in the global
// ~/.claude/settings.json, kept by the machine steps every setup and update
// runs, and named by doctor when one is missing.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const {
  group, test, assert, assertEq, summary, selfRun, mkTmp, testUnless,
} = require('../../lib/harness');
const { IS_WINDOWS } = require('../../lib/platform');
const {
  cleanup, mkWorld, runCli, mkSetupKit, mkPartialKit,
} = require('./helpers');

// The kit's rules, by the names the issue's Contract gives them.
const RULES = ['Bash(workkit ship:*)', 'Bash(workkit review:*)', 'Bash(npm publish:*)'];

const settingsFile = (world) => path.join(world.claudeHome, 'settings.json');

// The machine's global Claude settings, written as the owner left them.
const seedClaude = (world, text) => {
  fs.mkdirSync(world.claudeHome, { recursive: true });
  fs.writeFileSync(settingsFile(world), text);
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const sorted = (list) => JSON.stringify([...list].sort());

// The attention total doctor ends on, or 0 when it calls everything current.
const attention = (said) => Number((said.match(/(\d+) item\(s\) need attention/) || [0, 0])[1]);

// Whether this machine lets a test make a file symlink: Windows without
// developer mode refuses one, and a copy would not be the case under test.
const NO_FILE_LINK = (() => {
  const dir = mkTmp('workkit-allow-');
  try {
    fs.writeFileSync(path.join(dir, 'target'), '{}\n');
    fs.symlinkSync(path.join(dir, 'target'), path.join(dir, 'link'));
    return '';
  } catch (err) {
    return `this machine refuses a file symlink (${err.code})`;
  }
})();

const cases = async () => {
  group('workkit: the allow rules in the global settings');

  await test('a settings file without the rules gains exactly the missing ones, appended', () => {
    const world = mkWorld();
    // One kit rule already there, so a run that appends the whole list
    // regardless would hold it twice.
    const before = ['Bash(git status:*)', 'Bash(npm publish:*)'];
    seedClaude(world, `${JSON.stringify({ permissions: { allow: before } }, null, 2)}\n`);
    const { code, said } = runCli(world, ['update']);
    assertEq(code, 0, `exit 0, got: ${said}`);
    const { allow } = readJson(settingsFile(world)).permissions;
    assertEq(JSON.stringify(allow.slice(0, before.length)), JSON.stringify(before), 'the owner’s rules stay first, as they were');
    assertEq(sorted(allow.slice(before.length)), sorted(['Bash(workkit ship:*)', 'Bash(workkit review:*)']),
      'and exactly the two missing kit rules follow them');
    cleanup(world.root);
  });

  await test('a file that holds every rule is byte-identical after a run', () => {
    const world = mkWorld();
    // Spaced the way no JSON writer would print it, so a rewrite of the same
    // value still shows in the bytes.
    const text = `{"permissions":{ "allow":${JSON.stringify(RULES)} },"model":"opus"}`;
    seedClaude(world, text);
    const { code, said } = runCli(world, ['update']);
    assertEq(code, 0, `exit 0, got: ${said}`);
    assertEq(fs.readFileSync(settingsFile(world), 'utf8'), text, 'the file is not written at all');
    cleanup(world.root);
  });

  await testUnless(NO_FILE_LINK, NO_FILE_LINK)('a symlinked settings file stays a symlink, and its target gains the rules', () => {
    const world = mkWorld();
    const target = path.join(world.root, 'dotfiles', 'settings.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify({ model: 'opus' }, null, 2)}\n`);
    fs.mkdirSync(world.claudeHome, { recursive: true });
    fs.symlinkSync(target, settingsFile(world));
    const { code, said } = runCli(world, ['update']);
    assertEq(code, 0, `exit 0, got: ${said}`);
    assert(fs.lstatSync(settingsFile(world)).isSymbolicLink(), `the settings file is still a link, got: ${said}`);
    assertEq(fs.readlinkSync(settingsFile(world)), target, 'pointing where it pointed');
    const written = readJson(target);
    assertEq(sorted(written.permissions.allow), sorted(RULES), 'the target holds the rules');
    assertEq(written.model, 'opus', 'and what it held before');
    cleanup(world.root);
  });

  await test('a missing settings file gets one holding only the rules', () => {
    const world = mkWorld();
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const { code, said } = runCli(world, ['update']);
    assertEq(code, 0, `exit 0, got: ${said}`);
    assert(fs.existsSync(settingsFile(world)), `a settings file is made, got: ${said}`);
    const written = readJson(settingsFile(world));
    assertEq(JSON.stringify(Object.keys(written)), '["permissions"]', 'it holds permissions and nothing else');
    assertEq(JSON.stringify(Object.keys(written.permissions)), '["allow"]', 'whose one key is the allow list');
    assertEq(sorted(written.permissions.allow), sorted(RULES), 'and the list is the kit’s rules');
    cleanup(world.root);
  });

  await test('every other key, and its order, survives the write', () => {
    const world = mkWorld();
    seedClaude(world, `${JSON.stringify({
      model: 'opus',
      permissions: { deny: ['Bash(rm -rf:*)'], allow: [], defaultMode: 'auto' },
      env: { FOO: 'bar' },
      enabledPlugins: { 'workkit@workkit': true },
    }, null, 2)}\n`);
    const { code, said } = runCli(world, ['update']);
    assertEq(code, 0, `exit 0, got: ${said}`);
    const written = readJson(settingsFile(world));
    assertEq(JSON.stringify(Object.keys(written)), '["model","permissions","env","enabledPlugins"]', 'the top-level keys keep their order');
    assertEq(JSON.stringify(Object.keys(written.permissions)), '["deny","allow","defaultMode"]', 'and so do the permissions keys');
    assertEq(JSON.stringify(written.permissions.deny), '["Bash(rm -rf:*)"]', 'the deny list is untouched');
    assertEq(written.permissions.defaultMode, 'auto', 'and so is the mode');
    assertEq(JSON.stringify(written.env), '{"FOO":"bar"}', 'and the env block');
    assertEq(JSON.stringify(written.enabledPlugins), '{"workkit@workkit":true}', 'and the plugins');
    assertEq(sorted(written.permissions.allow), sorted(RULES), 'while the allow list gains the rules');
    cleanup(world.root);
  });

  await test('a settings file that does not parse is warned about, never written over', () => {
    const world = mkWorld();
    const broken = '{ "permissions": {\n';
    seedClaude(world, broken);
    const { code, said } = runCli(world, ['update']);
    assertEq(code, 0, `a broken file is not a crash, got: ${said}`);
    assertEq(fs.readFileSync(settingsFile(world), 'utf8'), broken, 'the owner’s file is untouched');
    assert(said.split('\n').some((l) => l.includes('⚠') && l.includes('settings.json')),
      `a warning names the file, got: ${said}`);
    const auto = runCli(world, ['update', '--auto']);
    assertEq(auto.code, 0, `the daily run finishes, got: ${auto.said}`);
    assert(!auto.said.includes('settings.json'), `and says nothing of it every morning, got: ${auto.said}`);
    assertEq(fs.readFileSync(settingsFile(world), 'utf8'), broken, 'nor writes it');
    cleanup(world.root);
  });

  await test('a kit without its JSON helpers warns that it is incomplete, and update still finishes', () => {
    const world = mkWorld();
    seedClaude(world, `${JSON.stringify({ model: 'opus' }, null, 2)}\n`);
    const { kit, script } = mkPartialKit();
    for (const args of [['update'], ['doctor']]) {
      const { code, out, err } = runCli(world, args, { script });
      assertEq(code, 0, `${args[0]} finishes, got: ${out}${err}`);
      const line = err.split('\n').find((l) => l.startsWith('allow:'));
      assert(line && line.includes('incomplete'), `${args[0]} warns that the kit is incomplete, got: ${err}`);
      assert(!out.includes('allow:'), `and never as a skip line, got: ${out}`);
    }
    cleanup(world.root); cleanup(kit);
  });

  group('workkit: every machine run keeps the rules');

  // A settings file the owner already has, holding none of the kit's rules.
  const OWNER_FILE = `${JSON.stringify({ model: 'opus' }, null, 2)}\n`;

  for (const [name, args, env] of [
    ['setup', ['setup'], {}],
    ['setup --cloud', ['setup', '--cloud'], { CLAUDE_CODE_REMOTE: 'true' }],
    ['update --auto', ['update', '--auto'], {}],
  ]) {
    await test(`${name} adds the rules to the global settings`, () => {
      const world = mkWorld({ pluginInstalled: true });
      seedClaude(world, OWNER_FILE);
      const { kit, script } = mkSetupKit();
      const { code, said } = runCli(world, args, { script, env });
      assertEq(code, 0, `exit 0, got: ${said}`);
      const written = readJson(settingsFile(world));
      assertEq(sorted(written.permissions.allow), sorted(RULES), `${name} leaves the rules in place, got: ${said}`);
      assertEq(written.model, 'opus', 'beside what the file held');
      cleanup(world.root); cleanup(kit);
    });
  }

  // The file can hold secrets, so the edit must not widen who may read it.
  await testUnless(IS_WINDOWS, 'Windows has no POSIX file modes to keep')('setup keeps a 0600 settings file at 0600 while it adds the rules', () => {
    const world = mkWorld({ pluginInstalled: true });
    seedClaude(world, OWNER_FILE);
    fs.chmodSync(settingsFile(world), 0o600);
    const { kit, script } = mkSetupKit();
    const { code, said } = runCli(world, ['setup'], { script });
    assertEq(code, 0, `exit 0, got: ${said}`);
    assertEq(sorted(readJson(settingsFile(world)).permissions.allow), sorted(RULES), `the rules were written, got: ${said}`);
    assertEq((fs.statSync(settingsFile(world)).mode & 0o777).toString(8), '600', 'and the file is still owner-only');
    cleanup(world.root); cleanup(kit);
  });

  await test('update --auto on a machine with no ~/.claude creates none', () => {
    const world = mkWorld();
    const { code, said } = runCli(world, ['update', '--auto']);
    assertEq(code, 0, `exit 0, got: ${said}`);
    assert(!fs.existsSync(world.claudeHome), `the daily run makes no ~/.claude, got: ${said}`);
    cleanup(world.root);
  });

  group('workkit doctor: the allow rules');

  // Doctor on two machines alike but for the settings file, so the difference
  // in what it says and counts is the rule check's alone.
  const doctorOn = (allow, env) => {
    const world = mkWorld();
    seedClaude(world, `${JSON.stringify({ permissions: { allow } }, null, 2)}\n`);
    const res = runCli(world, ['doctor'], { env });
    cleanup(world.root);
    return res;
  };

  await test('a missing rule is named with workkit setup as its fix, and counted', () => {
    const all = doctorOn(RULES);
    const short = doctorOn(['Bash(workkit ship:*)', 'Bash(npm publish:*)']);
    assertEq(short.code, 0, `a report is a report: exit 0, got: ${short.said}`);
    const line = short.said.split('\n').find((l) => l.includes('Bash(workkit review:*)'));
    assert(line, `the missing rule is named, got: ${short.said}`);
    assert(line.includes('workkit setup'), `with workkit setup as the fix on its line, got: ${line}`);
    assertEq(attention(short.said), attention(all.said) + 1, 'and it is one more item needing attention');
  });

  await test('in a cloud session the fix a missing rule names is workkit setup --cloud', () => {
    const { said } = doctorOn(['Bash(workkit ship:*)', 'Bash(npm publish:*)'], { CLAUDE_CODE_REMOTE: 'true' });
    const line = said.split('\n').find((l) => l.includes('Bash(workkit review:*)'));
    assert(line && line.includes('`workkit setup --cloud`'), `the cloud fix on its line, got: ${said}`);
  });

  await test('with every rule present doctor names none of them', () => {
    const { code, said } = doctorOn(['Bash(git status:*)', ...RULES]);
    assertEq(code, 0, `exit 0, got: ${said}`);
    for (const rule of RULES) {
      assert(!said.includes(rule), `${rule} is not named, got: ${said}`);
    }
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
