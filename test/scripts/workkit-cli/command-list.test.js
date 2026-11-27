// Tests for workflow/workkit/command-list.js, the one list of the kit's commands
// with the permission each one's rule lands in: the list and its readers in this
// process, and the dispatch in workflow/workkit.js that refuses a command the list
// does not hold.
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const {
  WORKFLOW_DIR, COMMAND_TABLE: TABLE, cleanup, mkWorld, runCli, mkPartialKit, mkSetupKit,
} = require('./helpers');

const {
  COMMANDS, commandsWith, commandListed, commandVerbs,
} = require(path.join(WORKFLOW_DIR, 'workkit', 'command-list.js'));

const tableWith = (permission, table = TABLE) => table.filter(([, p]) => p === permission).map(([c]) => c);

// One entry of the list file in a kit copy, `{ command: '<command>', permission: '<permission>' }` in any spacing or quote.
const entryOf = (command, permission) => new RegExp(`\\{\\s*command:\\s*(['"])${command}\\1\\s*,\\s*permission:\\s*(['"])${permission}\\2\\s*\\}\\s*,?`);

describe('command-list.js', () => {
  test('the list holds exactly the table\'s entries, in its order, each { command, permission }', () => {
    expect(COMMANDS).toEqual(TABLE.map(([command, permission]) => ({ command, permission })));
  });

  test('ship deploy is the one ask, the seven ship verbs come in their order, and ship is listed where nope is not', () => {
    expect(commandsWith('ask')).toEqual(['ship deploy']);
    expect(commandVerbs('ship')).toEqual(['items', 'release', 'watch', 'cut', 'plan', 'publish', 'deploy']);
    expect(commandListed('ship'), 'ship').toBe(true);
    expect(commandListed('nope'), 'nope').toBe(false);
  });

  test('the readers answer from the list: each permission\'s commands in order, which first words have an entry, and each one\'s second words', () => {
    for (const permission of ['allow', 'none']) {
      expect(commandsWith(permission), `the ${permission} commands, in order`).toEqual(tableWith(permission));
    }
    expect(commandsWith('deny'), 'a permission no entry has').toEqual([]);
    // `red` is a second word and `shi` a prefix: neither is an entry's first word.
    for (const [word, listed] of [['proof', true], ['help', true], ['red', false], ['shi', false], ['', false]]) {
      expect(commandListed(word), `commandListed(${JSON.stringify(word)})`).toBe(listed);
    }
    expect(commandVerbs('proof'), 'proof\'s second words').toEqual(['red']);
    expect(commandVerbs('setup'), 'a command with none').toEqual([]);
  });
});

describe('workkit: the dispatch reads the list', () => {
  test('a kit whose list lacks a command the dispatch has a branch for refuses it, and runs nothing of it', () => {
    const world = mkWorld();
    const { kit, script } = mkPartialKit();
    const copy = path.join(kit, 'workflow', 'workkit', 'command-list.js');
    expect(fs.existsSync(copy), 'the kit copy holds the list file').toBeTruthy();
    const text = fs.readFileSync(copy, 'utf8');
    const edited = text.replace(entryOf('doctor', 'allow'), '');
    expect(edited !== text, `the copy's doctor entry was taken out, got: ${text}`).toBeTruthy();
    fs.writeFileSync(copy, edited);
    const { code, out, err } = runCli(world, ['doctor'], { script });
    expect(code, `exit 1, got: ${out}${err}`).toBe(1);
    expect(err.includes('unknown command doctor'), `names the command, got: ${err}`).toBeTruthy();
    expect(err.includes('usage: workkit'), `and shows the map, got: ${err}`).toBeTruthy();
    expect(out, 'no report on stdout').toBe('');
    expect(world.ghCalls().length + world.claudeCalls().length, 'and none of doctor\'s checks asked gh or claude').toBe(0);
    cleanup(world.root); cleanup(kit);
  });

  test('every way to ask for the map prints it, and a word with no entry is refused with it', () => {
    const world = mkWorld();
    const map = runCli(world, []);
    expect(map.code, `no arguments exit 0, got: ${map.said}`).toBe(0);
    expect(map.out.includes('usage: workkit'), `and print the map, got: ${map.said}`).toBeTruthy();
    for (const args of [['help'], ['-h'], ['--help']]) {
      const { code, out, said } = runCli(world, args);
      expect(code, `${args[0]} exits 0, got: ${said}`).toBe(0);
      expect(out, `${args[0]} prints the same map`).toBe(map.out);
    }
    const { code, out, err, said } = runCli(world, ['nope']);
    expect(code, `nope exits 1, got: ${said}`).toBe(1);
    expect(err.includes('unknown command nope'), `names the word, got: ${err}`).toBeTruthy();
    expect(err.includes('usage: workkit'), `beside the map, got: ${err}`).toBeTruthy();
    expect(out, 'and nothing on stdout').toBe('');
    cleanup(world.root);
  });

  test('an unknown ship verb names the seven verbs in their order', () => {
    const world = mkWorld();
    const { code, err, said } = runCli(world, ['ship', 'nope']);
    expect(code, `exit 1, got: ${said}`).toBe(1);
    expect(err.includes('items, release, watch, cut, plan, publish or deploy'), `the verbs in order, got: ${err}`).toBeTruthy();
    cleanup(world.root);
  });
});

describe('workkit setup: a list with no ask entry', () => {
  test('the deploy moved to allow still keeps every allow rule, warns of nothing, and makes no ask list', () => {
    const world = mkWorld({ pluginInstalled: true });
    const settings = path.join(world.claudeHome, 'settings.json');
    fs.mkdirSync(world.claudeHome, { recursive: true });
    fs.writeFileSync(settings, `${JSON.stringify({ model: 'opus' }, null, 2)}\n`);
    const { kit, script } = mkSetupKit();
    const copy = path.join(kit, 'workflow', 'workkit', 'command-list.js');
    const text = fs.readFileSync(copy, 'utf8');
    const deploy = text.match(entryOf('ship deploy', 'ask'));
    expect(deploy !== null, `the copy holds the deploy's ask entry, got: ${text}`).toBeTruthy();
    fs.writeFileSync(copy, text.replace(deploy[0], deploy[0].replace(/(['"])ask\1/, '$1allow$1')));
    const { code, said } = runCli(world, ['setup'], { script });
    expect(code, `exit 0, got: ${said}`).toBe(0);
    const moved = TABLE.map(([c, p]) => [c, c === 'ship deploy' ? 'allow' : p]);
    const written = JSON.parse(fs.readFileSync(settings, 'utf8'));
    expect(JSON.stringify(written.permissions && written.permissions.allow), `every allow rule, the deploy's among them, got: ${said}`)
      .toBe(JSON.stringify([...tableWith('allow', moved).map((c) => `Bash(workkit ${c}:*)`), 'Bash(npm publish:*)']));
    const warned = said.split('\n').filter((l) => l.includes('⚠') && l.includes('allow:'));
    expect(JSON.stringify(warned), 'no warning about the rules').toBe('[]');
    expect(JSON.stringify(Object.keys(written.permissions)), 'and no permissions.ask key').toBe('["allow"]');
    cleanup(world.root); cleanup(kit);
  });
});
