// Tests for workflow/workkit.sh: the kit's allow and ask rules in the global
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
  COMMAND_TABLE, cleanup, mkWorld, runCli, mkSetupKit, mkPartialKit,
} = require('./helpers');

// The kit's rules, from the issue's table: one allow rule per `allow` command,
// in the table's order, then npm's publish; and an ask rule so a deploy always
// prompts.
const ALLOWED = COMMAND_TABLE.filter(([, p]) => p === 'allow').map(([c]) => c);
const rule = (command) => `Bash(workkit ${command}:*)`;
const RULES = [...ALLOWED.map(rule), 'Bash(npm publish:*)'];
const DEPLOY = rule('ship deploy');
const ASK = [DEPLOY];
// The whole ship verb's rule, which let a deploy through with no prompt.
const RETIRED = 'Bash(workkit ship:*)';
const without = (...gone) => RULES.filter((r) => !gone.includes(r));

const settingsFile = (world) => path.join(world.claudeHome, 'settings.json');

// The machine's global Claude settings, written as the owner left them.
const seedClaude = (world, text) => {
  fs.mkdirSync(world.claudeHome, { recursive: true });
  fs.writeFileSync(settingsFile(world), text);
};
const seedJson = (world, value) => seedClaude(world, `${JSON.stringify(value, null, 2)}\n`);

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const json = (value) => JSON.stringify(value);

// The attention total doctor ends on, or 0 when it calls everything current.
const attention = (said) => Number((said.match(/(\d+) item\(s\) need attention/) || [0, 0])[1]);

describe('workkit: the allow and ask rules in the global settings', () => {
  test('a settings file with none of the rules gains every allow rule in the table\'s order, then the ask rule', () => {
    const world = mkWorld();
    seedJson(world, { permissions: { allow: ['Bash(git status:*)'] } });
    const { code, said } = runCli(world, ['update']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    const { allow, ask } = readJson(settingsFile(world)).permissions;
    expect(json(allow), `the owner’s rule first, then the kit’s in the table’s order, got: ${said}`).toBe(json(['Bash(git status:*)', ...RULES]));
    expect(json(ask), `the deploy rule is at permissions.ask, got: ${said}`).toBe(json(ASK));
    cleanup(world.root);
  });

  test('a missing settings file gets one holding only the rules, none for a command that runs other code', () => {
    const world = mkWorld();
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const { code, said } = runCli(world, ['update']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(fs.existsSync(settingsFile(world)), `a settings file is made, got: ${said}`).toBeTruthy();
    const written = readJson(settingsFile(world));
    expect(json(Object.keys(written)), 'it holds permissions and nothing else').toBe('["permissions"]');
    const { allow, ask } = written.permissions;
    expect(json(Object.keys(written.permissions).sort()), 'whose keys are the allow and ask lists').toBe('["allow","ask"]');
    expect(json(allow), `the allow list is the kit's rules in the table's order, got: ${said}`).toBe(json(RULES));
    expect(json(ask), `and the ask list the deploy rule, got: ${said}`).toBe(json(ASK));
    const runsCode = [...allow, ...ask].filter((r) => /^Bash\(workkit (test|tower|prove|supervise|proof)\b/.test(r));
    expect(json(runsCode), 'no rule names test, tower, prove, supervise or proof').toBe('[]');
    expect(![...allow, ...ask].includes('Bash(workkit:*)'), `no rule is the wide one, got: ${json(written)}`).toBeTruthy();
    expect(!allow.includes(RETIRED), `no allow rule is the whole ship verb, got: ${json(allow)}`).toBeTruthy();
    expect(!allow.some((r) => r.includes('deploy')), `no allow rule names a deploy, got: ${json(allow)}`).toBeTruthy();
    cleanup(world.root);
  });

  test('the retired ship rule is taken out, the kit rules a file holds stay where they are, and only the missing ones follow', () => {
    const world = mkWorld();
    // Two kit rules out of the table's order, around the owner's own, so a run
    // that re-sorted or re-appended them would show.
    const kept = [rule('watch'), 'Bash(git status:*)', rule('setup')];
    seedJson(world, { permissions: { allow: [kept[0], kept[1], RETIRED, kept[2]] } });
    const { code, said } = runCli(world, ['update']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    const { allow } = readJson(settingsFile(world)).permissions;
    expect(json(allow), `the retired rule is gone and the missing kit rules follow the kept ones, got: ${said}`)
      .toBe(json([...kept, ...without(rule('watch'), rule('setup'))]));
    cleanup(world.root);
  });

  test('an ask list of the owner\'s keeps its rules in order, its place among the keys, and gains the deploy rule after them', () => {
    const world = mkWorld();
    const before = ['Bash(git push:*)', 'Bash(rm:*)'];
    seedJson(world, { permissions: { deny: ['Bash(sudo:*)'], ask: before, allow: [] } });
    const { code, said } = runCli(world, ['update']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    const { permissions } = readJson(settingsFile(world));
    expect(json(permissions.ask), `the owner’s ask rules stay first, the deploy rule after, got: ${said}`).toBe(json([...before, DEPLOY]));
    expect(json(Object.keys(permissions)), 'and the permissions keys keep their order').toBe('["deny","ask","allow"]');
    cleanup(world.root);
  });

  test('a file that holds every rule and no retired one is byte-identical after a run', () => {
    const world = mkWorld();
    // Spaced the way no JSON writer would print it, so a rewrite of the same
    // value still shows in the bytes.
    const text = `{"permissions":{ "allow":${json(RULES)}, "ask":${json(ASK)} },"model":"opus"}`;
    seedClaude(world, text);
    const { code, said } = runCli(world, ['update']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(fs.readFileSync(settingsFile(world), 'utf8'), 'the file is not written at all').toBe(text);
    cleanup(world.root);
  });

  for (const key of ['allow', 'ask']) {
    test(`a settings file whose permissions.${key} is not a list is warned about, never written over`, () => {
      const world = mkWorld();
      const text = `${JSON.stringify({ permissions: { [key]: 'Bash(git status:*)' } }, null, 2)}\n`;
      seedClaude(world, text);
      const { code, said } = runCli(world, ['update']);
      expect(code, `a wrong shape is not a crash, got: ${said}`).toBe(0);
      expect(fs.readFileSync(settingsFile(world), 'utf8'), 'the owner’s file is untouched').toBe(text);
      expect(said.split('\n').some((l) => l.includes('⚠') && l.includes('settings.json') && l.includes(`permissions.${key}`)),
        `a warning names the file and the key, got: ${said}`).toBeTruthy();
      cleanup(world.root);
    });
  }

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
    expect(json(written.permissions.allow), 'the target holds the allow rules').toBe(json(RULES));
    expect(json(written.permissions.ask), 'and the ask rule').toBe(json(ASK));
    expect(written.model, 'and what it held before').toBe('opus');
    cleanup(world.root);
  });

  test('every other key, and its order, survives the write', () => {
    const world = mkWorld();
    seedJson(world, {
      model: 'opus',
      permissions: { deny: ['Bash(rm -rf:*)'], allow: [], defaultMode: 'auto' },
      env: { FOO: 'bar' },
      enabledPlugins: { 'workkit@workkit': true },
    });
    const { code, said } = runCli(world, ['update']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    const written = readJson(settingsFile(world));
    expect(json(Object.keys(written)), 'the top-level keys keep their order').toBe('["model","permissions","env","enabledPlugins"]');
    expect(json(Object.keys(written.permissions).filter((k) => k !== 'ask')), 'and so do the permissions keys').toBe('["deny","allow","defaultMode"]');
    expect(json(written.permissions.deny), 'the deny list is untouched').toBe('["Bash(rm -rf:*)"]');
    expect(written.permissions.defaultMode, 'and so is the mode').toBe('auto');
    expect(json(written.env), 'and the env block').toBe('{"FOO":"bar"}');
    expect(json(written.enabledPlugins), 'and the plugins').toBe('{"workkit@workkit":true}');
    expect(json(written.permissions.allow), 'while the allow list gains the rules').toBe(json(RULES));
    expect(json(written.permissions.ask), 'and the ask list the deploy rule').toBe(json(ASK));
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
    seedJson(world, { model: 'opus' });
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

  // Plain `update` is every case above.
  for (const [name, args, env] of [
    ['setup', ['setup'], {}],
    ['setup --cloud', ['setup', '--cloud'], { CLAUDE_CODE_REMOTE: 'true' }],
    ['update --auto', ['update', '--auto'], {}],
  ]) {
    test(`${name} adds the allow and ask rules to the global settings`, () => {
      const world = mkWorld({ pluginInstalled: true });
      seedClaude(world, OWNER_FILE);
      const { kit, script } = mkSetupKit();
      const { code, said } = runCli(world, args, { script, env });
      expect(code, `exit 0, got: ${said}`).toBe(0);
      const written = readJson(settingsFile(world));
      expect(json(written.permissions.allow), `${name} leaves the allow rules in place, got: ${said}`).toBe(json(RULES));
      expect(json(written.permissions.ask), `and the ask rule, got: ${said}`).toBe(json(ASK));
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
    const written = readJson(settingsFile(world));
    expect(json(written.permissions.allow), `the allow rules were written, got: ${said}`).toBe(json(RULES));
    expect(json(written.permissions.ask), 'and the ask rule').toBe(json(ASK));
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

describe('workkit doctor: the allow and ask rules', () => {
  // Doctor on two machines alike but for the settings file, so the difference
  // in what it says and counts is the rule check's alone.
  const doctorOn = (allow, ask, env) => {
    const world = mkWorld();
    seedJson(world, { permissions: { allow, ask } });
    const res = runCli(world, ['doctor'], { env });
    cleanup(world.root);
    return res;
  };
  // The rule whose absence let auto mode refuse a step of the ship.
  const SETUP = rule('setup');

  test('a missing allow rule is named with workkit setup as its fix, and counted', () => {
    const all = doctorOn(RULES, ASK);
    const short = doctorOn(without(SETUP), ASK);
    expect(short.code, `a report is a report: exit 0, got: ${short.said}`).toBe(0);
    const line = short.said.split('\n').find((l) => l.includes(SETUP));
    expect(line, `the missing rule is named, got: ${short.said}`).toBeTruthy();
    expect(line.includes('workkit setup'), `with workkit setup as the fix on its line, got: ${line}`).toBeTruthy();
    expect(attention(short.said), 'and it is one more item needing attention').toBe(attention(all.said) + 1);
  });

  test('a missing ask rule is named with permissions.ask and workkit setup as its fix, and counted', () => {
    const all = doctorOn(RULES, ASK);
    const short = doctorOn(RULES, []);
    expect(short.code, `a report is a report: exit 0, got: ${short.said}`).toBe(0);
    const line = short.said.split('\n').find((l) => l.includes(DEPLOY));
    expect(line, `the missing ask rule is named, got: ${short.said}`).toBeTruthy();
    expect(line.includes('permissions.ask'), `its line names permissions.ask, got: ${line}`).toBeTruthy();
    expect(line.includes('workkit setup'), `with workkit setup as the fix on its line, got: ${line}`).toBeTruthy();
    expect(attention(short.said), 'and it is one more item needing attention').toBe(attention(all.said) + 1);
  });

  test('in a cloud session the fix a missing rule names is workkit setup --cloud', () => {
    const { said } = doctorOn(without(SETUP), ASK, { CLAUDE_CODE_REMOTE: 'true' });
    const line = said.split('\n').find((l) => l.includes(SETUP));
    expect(line && line.includes('`workkit setup --cloud`'), `the cloud fix on its line, got: ${said}`).toBeTruthy();
  });

  test('a retired rule still held is named with workkit setup as its fix, and counted', () => {
    const all = doctorOn(RULES, ASK);
    const stale = doctorOn([...RULES, RETIRED], ASK);
    expect(stale.code, `a report is a report: exit 0, got: ${stale.said}`).toBe(0);
    const line = stale.said.split('\n').find((l) => l.includes(RETIRED));
    expect(line && line.includes('workkit setup'), `the retired rule is named with its fix, got: ${stale.said}`).toBeTruthy();
    expect(attention(stale.said), 'and it is one more item needing attention').toBe(attention(all.said) + 1);
  });

  test('with every rule present doctor names none of them', () => {
    const { code, said } = doctorOn(['Bash(git status:*)', ...RULES], ['Bash(git push:*)', ...ASK]);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    for (const r of [...RULES, ...ASK]) {
      expect(!said.includes(r), `${r} is not named, got: ${said}`).toBeTruthy();
    }
  });
});
