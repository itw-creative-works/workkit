// Tests for workflow/workkit.sh: the kit's allow rules in the global
// ~/.claude/settings.json, kept by the machine steps every setup and update
// runs, and named by doctor when one is missing.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const {
  describe, test, expect,
} = require('../../lib/harness');
const { IS_WINDOWS, skipWithoutFileLink } = require('../../lib/platform');
const {
  cleanup, mkWorld, runCli, mkSetupKit, mkPartialKit,
} = require('./helpers');

// The kit's rules, by the names the issue's Contract gives them: every ship
// verb but deploy, so a deploy outside a ship still prompts.
const SHIP_RULES = ['items', 'release', 'watch', 'cut', 'plan', 'publish'].map((verb) => `Bash(workkit ship ${verb}:*)`);
const RULES = [...SHIP_RULES, 'Bash(workkit review:*)', 'Bash(workkit watch:*)', 'Bash(npm publish:*)'];
// The whole ship verb's rule, which let a deploy through with no prompt.
const RETIRED = 'Bash(workkit ship:*)';
const without = (rule) => RULES.filter((r) => r !== rule);

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

describe('workkit: the allow rules in the global settings', () => {
  test('a settings file without the rules gains exactly the missing ones, appended', () => {
    const world = mkWorld();
    // One kit rule already there, so a run that appends the whole list
    // regardless would hold it twice.
    const before = ['Bash(git status:*)', 'Bash(npm publish:*)'];
    seedClaude(world, `${JSON.stringify({ permissions: { allow: before } }, null, 2)}\n`);
    const { code, said } = runCli(world, ['update']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    const { allow } = readJson(settingsFile(world)).permissions;
    expect(JSON.stringify(allow.slice(0, before.length)), 'the owner’s rules stay first, as they were').toBe(JSON.stringify(before));
    expect(sorted(allow.slice(before.length)), 'and exactly the missing kit rules follow them').toBe(sorted(without('Bash(npm publish:*)')));
    cleanup(world.root);
  });

  test('the retired whole-verb ship rule is taken out, the owner\'s rules kept in order', () => {
    const world = mkWorld();
    seedClaude(world, `${JSON.stringify({ permissions: { allow: ['Bash(git status:*)', RETIRED, 'Bash(npm publish:*)'] } }, null, 2)}\n`);
    const { code, said } = runCli(world, ['update']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    const { allow } = readJson(settingsFile(world)).permissions;
    expect(JSON.stringify(allow.slice(0, 2)), 'the rules kept stay first, in order').toBe(JSON.stringify(['Bash(git status:*)', 'Bash(npm publish:*)']));
    expect(sorted(allow.slice(2)), 'the missing kit rules follow them').toBe(sorted(without('Bash(npm publish:*)')));
    expect(!allow.includes(RETIRED), `and the retired rule is gone, got: ${JSON.stringify(allow)}`).toBeTruthy();
    expect(!allow.includes('Bash(workkit ship deploy:*)'), 'no rule lets a deploy through').toBeTruthy();
    cleanup(world.root);
  });

  test('a file that holds every rule is byte-identical after a run', () => {
    const world = mkWorld();
    // Spaced the way no JSON writer would print it, so a rewrite of the same
    // value still shows in the bytes.
    const text = `{"permissions":{ "allow":${JSON.stringify(RULES)} },"model":"opus"}`;
    seedClaude(world, text);
    const { code, said } = runCli(world, ['update']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(fs.readFileSync(settingsFile(world), 'utf8'), 'the file is not written at all').toBe(text);
    cleanup(world.root);
  });

  test('a symlinked settings file stays a symlink, and its target gains the rules', { skip: skipWithoutFileLink() }, () => {
    const world = mkWorld();
    const target = path.join(world.root, 'dotfiles', 'settings.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify({ model: 'opus' }, null, 2)}\n`);
    fs.mkdirSync(world.claudeHome, { recursive: true });
    fs.symlinkSync(target, settingsFile(world));
    const { code, said } = runCli(world, ['update']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(fs.lstatSync(settingsFile(world)).isSymbolicLink(), `the settings file is still a link, got: ${said}`).toBeTruthy();
    expect(fs.readlinkSync(settingsFile(world)), 'pointing where it pointed').toBe(target);
    const written = readJson(target);
    expect(sorted(written.permissions.allow), 'the target holds the rules').toBe(sorted(RULES));
    expect(written.model, 'and what it held before').toBe('opus');
    cleanup(world.root);
  });

  test('a missing settings file gets one holding only the rules', () => {
    const world = mkWorld();
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const { code, said } = runCli(world, ['update']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(fs.existsSync(settingsFile(world)), `a settings file is made, got: ${said}`).toBeTruthy();
    const written = readJson(settingsFile(world));
    expect(JSON.stringify(Object.keys(written)), 'it holds permissions and nothing else').toBe('["permissions"]');
    expect(JSON.stringify(Object.keys(written.permissions)), 'whose one key is the allow list').toBe('["allow"]');
    expect(sorted(written.permissions.allow), 'and the list is the kit’s rules').toBe(sorted(RULES));
    cleanup(world.root);
  });

  test('every other key, and its order, survives the write', () => {
    const world = mkWorld();
    seedClaude(world, `${JSON.stringify({
      model: 'opus',
      permissions: { deny: ['Bash(rm -rf:*)'], allow: [], defaultMode: 'auto' },
      env: { FOO: 'bar' },
      enabledPlugins: { 'workkit@workkit': true },
    }, null, 2)}\n`);
    const { code, said } = runCli(world, ['update']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    const written = readJson(settingsFile(world));
    expect(JSON.stringify(Object.keys(written)), 'the top-level keys keep their order').toBe('["model","permissions","env","enabledPlugins"]');
    expect(JSON.stringify(Object.keys(written.permissions)), 'and so do the permissions keys').toBe('["deny","allow","defaultMode"]');
    expect(JSON.stringify(written.permissions.deny), 'the deny list is untouched').toBe('["Bash(rm -rf:*)"]');
    expect(written.permissions.defaultMode, 'and so is the mode').toBe('auto');
    expect(JSON.stringify(written.env), 'and the env block').toBe('{"FOO":"bar"}');
    expect(JSON.stringify(written.enabledPlugins), 'and the plugins').toBe('{"workkit@workkit":true}');
    expect(sorted(written.permissions.allow), 'while the allow list gains the rules').toBe(sorted(RULES));
    cleanup(world.root);
  });

  test('a settings file that does not parse is warned about, never written over', () => {
    const world = mkWorld();
    const broken = '{ "permissions": {\n';
    seedClaude(world, broken);
    const { code, said } = runCli(world, ['update']);
    expect(code, `a broken file is not a crash, got: ${said}`).toBe(0);
    expect(fs.readFileSync(settingsFile(world), 'utf8'), 'the owner’s file is untouched').toBe(broken);
    expect(said.split('\n').some((l) => l.includes('⚠') && l.includes('settings.json')),
      `a warning names the file, got: ${said}`).toBeTruthy();
    const auto = runCli(world, ['update', '--auto']);
    expect(auto.code, `the daily run finishes, got: ${auto.said}`).toBe(0);
    expect(!auto.said.includes('settings.json'), `and says nothing of it every morning, got: ${auto.said}`).toBeTruthy();
    expect(fs.readFileSync(settingsFile(world), 'utf8'), 'nor writes it').toBe(broken);
    cleanup(world.root);
  });

  test('a kit without its JSON helpers warns that it is incomplete, and update still finishes', () => {
    const world = mkWorld();
    seedClaude(world, `${JSON.stringify({ model: 'opus' }, null, 2)}\n`);
    const { kit, script } = mkPartialKit();
    for (const args of [['update'], ['doctor']]) {
      const { code, out, err } = runCli(world, args, { script });
      expect(code, `${args[0]} finishes, got: ${out}${err}`).toBe(0);
      const line = err.split('\n').find((l) => l.startsWith('allow:'));
      expect(line && line.includes('incomplete'), `${args[0]} warns that the kit is incomplete, got: ${err}`).toBeTruthy();
      expect(!out.includes('allow:'), `and never as a skip line, got: ${out}`).toBeTruthy();
    }
    cleanup(world.root); cleanup(kit);
  });
});

describe('workkit: every machine run keeps the rules', () => {
  // A settings file the owner already has, holding none of the kit's rules.
  const OWNER_FILE = `${JSON.stringify({ model: 'opus' }, null, 2)}\n`;

  for (const [name, args, env] of [
    ['setup', ['setup'], {}],
    ['setup --cloud', ['setup', '--cloud'], { CLAUDE_CODE_REMOTE: 'true' }],
    ['update --auto', ['update', '--auto'], {}],
  ]) {
    test(`${name} adds the rules to the global settings`, () => {
      const world = mkWorld({ pluginInstalled: true });
      seedClaude(world, OWNER_FILE);
      const { kit, script } = mkSetupKit();
      const { code, said } = runCli(world, args, { script, env });
      expect(code, `exit 0, got: ${said}`).toBe(0);
      const written = readJson(settingsFile(world));
      expect(sorted(written.permissions.allow), `${name} leaves the rules in place, got: ${said}`).toBe(sorted(RULES));
      expect(written.model, 'beside what the file held').toBe('opus');
      cleanup(world.root); cleanup(kit);
    });
  }

  // The file can hold secrets, so the edit must not widen who may read it.
  test('setup keeps a 0600 settings file at 0600 while it adds the rules', { skip: IS_WINDOWS && 'Windows has no POSIX file modes to keep' }, () => {
    const world = mkWorld({ pluginInstalled: true });
    seedClaude(world, OWNER_FILE);
    fs.chmodSync(settingsFile(world), 0o600);
    const { kit, script } = mkSetupKit();
    const { code, said } = runCli(world, ['setup'], { script });
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(sorted(readJson(settingsFile(world)).permissions.allow), `the rules were written, got: ${said}`).toBe(sorted(RULES));
    expect((fs.statSync(settingsFile(world)).mode & 0o777).toString(8), 'and the file is still owner-only').toBe('600');
    cleanup(world.root); cleanup(kit);
  });

  test('update --auto on a machine with no ~/.claude creates none', () => {
    const world = mkWorld();
    const { code, said } = runCli(world, ['update', '--auto']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(!fs.existsSync(world.claudeHome), `the daily run makes no ~/.claude, got: ${said}`).toBeTruthy();
    cleanup(world.root);
  });
});

describe('workkit doctor: the allow rules', () => {
  // Doctor on two machines alike but for the settings file, so the difference
  // in what it says and counts is the rule check's alone.
  const doctorOn = (allow, env) => {
    const world = mkWorld();
    seedClaude(world, `${JSON.stringify({ permissions: { allow } }, null, 2)}\n`);
    const res = runCli(world, ['doctor'], { env });
    cleanup(world.root);
    return res;
  };

  test('a missing rule is named with workkit setup as its fix, and counted', () => {
    const all = doctorOn(RULES);
    const short = doctorOn(without('Bash(workkit review:*)'));
    expect(short.code, `a report is a report: exit 0, got: ${short.said}`).toBe(0);
    const line = short.said.split('\n').find((l) => l.includes('Bash(workkit review:*)'));
    expect(line, `the missing rule is named, got: ${short.said}`).toBeTruthy();
    expect(line.includes('workkit setup'), `with workkit setup as the fix on its line, got: ${line}`).toBeTruthy();
    expect(attention(short.said), 'and it is one more item needing attention').toBe(attention(all.said) + 1);
  });

  test('in a cloud session the fix a missing rule names is workkit setup --cloud', () => {
    const { said } = doctorOn(without('Bash(workkit review:*)'), { CLAUDE_CODE_REMOTE: 'true' });
    const line = said.split('\n').find((l) => l.includes('Bash(workkit review:*)'));
    expect(line && line.includes('`workkit setup --cloud`'), `the cloud fix on its line, got: ${said}`).toBeTruthy();
  });

  test('a retired rule still held is named with workkit setup as its fix, and counted', () => {
    const all = doctorOn(RULES);
    const stale = doctorOn([...RULES, RETIRED]);
    expect(stale.code, `a report is a report: exit 0, got: ${stale.said}`).toBe(0);
    const line = stale.said.split('\n').find((l) => l.includes(RETIRED));
    expect(line && line.includes('workkit setup'), `the retired rule is named with its fix, got: ${stale.said}`).toBeTruthy();
    expect(attention(stale.said), 'and it is one more item needing attention').toBe(attention(all.said) + 1);
  });

  test('with every rule present doctor names none of them', () => {
    const { code, said } = doctorOn(['Bash(git status:*)', ...RULES]);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    for (const rule of RULES) {
      expect(!said.includes(rule), `${rule} is not named, got: ${said}`).toBeTruthy();
    }
  });
});
