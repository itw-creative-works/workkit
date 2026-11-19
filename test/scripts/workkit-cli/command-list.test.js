// Tests for workflow/workkit/command-list.sh, the one list of the kit's commands
// with the permission each one's rule lands in: the list and its readers in
// a bare shell, and the dispatch in workflow/workkit.sh that refuses a command
// the list does not hold.
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, SPAWN_DEADLINE,
} = require('../../lib/harness');
const {
  SYSTEM_PATH, NO_RC, shellPath, spawnSystemBash,
} = require('../../lib/platform');
const {
  WORKFLOW_DIR, COMMAND_TABLE: TABLE, cleanup, mkWorld, runCli, mkPartialKit, mkSetupKit,
} = require('./helpers');

const LIST = path.join(WORKFLOW_DIR, 'workkit', 'command-list.sh');

const commandsWith = (permission, table = TABLE) => table.filter(([, p]) => p === permission).map(([c]) => c);

const lines = (text) => text.split('\n').filter(Boolean);

// A shell holding the list file and nothing else of the kit: no other piece
// sourced, no kit variable set, a scratch HOME.
const bareHome = mkTmp('workkit-cli-');
const inList = (snippet) => {
  const res = spawnSystemBash([...NO_RC, '-c', `. "${shellPath(LIST)}" || exit 9\n${snippet}`], {
    env: { PATH: SYSTEM_PATH, HOME: shellPath(bareHome) },
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  expect(res.status !== null, `the shell finished (no timeout): ${res.error || ''}`).toBeTruthy();
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

describe('command-list.sh, sourced alone', () => {
  test('the list holds exactly the table\'s entries, in its order, each <command>=<permission>', () => {
    const { code, out, err } = inList('printf \'%s\\n\' "${WORKKIT_COMMANDS[@]}"');
    expect(code, `exit 0, got: ${out}${err}`).toBe(0);
    expect(err, 'and nothing on stderr').toBe('');
    expect(JSON.stringify(lines(out)), 'the entries, in order').toBe(JSON.stringify(TABLE.map(([c, p]) => `${c}=${p}`)));
  });

  test('the readers answer from the list: each permission\'s commands in order, which first words have an entry, and each one\'s second words', () => {
    for (const permission of ['allow', 'ask', 'none']) {
      const { code, out, err } = inList(`wk_commands_with ${permission}`);
      expect(code, `wk_commands_with ${permission} exits 0, got: ${out}${err}`).toBe(0);
      expect(JSON.stringify(lines(out)), `the ${permission} commands, in order`).toBe(JSON.stringify(commandsWith(permission)));
    }
    // `red` is a second word and `shi` a prefix: neither is an entry's first word.
    const asks = ['ship', 'proof', 'nope', 'red', 'shi'];
    const { out, err } = inList(asks.map((w) => `wk_command_listed ${w}; printf '%s=%s\\n' ${w} "$?"`).join('\n'));
    expect(JSON.stringify(lines(out)), `0 for ship and proof, 1 for the rest, got: ${out}${err}`)
      .toBe(JSON.stringify(['ship=0', 'proof=0', 'nope=1', 'red=1', 'shi=1']));
    const verbs = { ship: ['items', 'release', 'watch', 'cut', 'plan', 'publish', 'deploy'], proof: ['red'], setup: [] };
    for (const [word, expected] of Object.entries(verbs)) {
      const res = inList(`wk_command_verbs ${word}`);
      expect(JSON.stringify(lines(res.out)), `wk_command_verbs ${word}, got: ${res.out}${res.err}`).toBe(JSON.stringify(expected));
    }
  });
});

describe('workkit: the dispatch reads the list', () => {
  test('a kit whose list lacks a command the dispatch has a branch for refuses it, and runs nothing of it', () => {
    const world = mkWorld();
    const { kit, script } = mkPartialKit();
    const copy = path.join(kit, 'workflow', 'workkit', 'command-list.sh');
    expect(fs.existsSync(copy), 'the kit copy holds the list file').toBeTruthy();
    const text = fs.readFileSync(copy, 'utf8');
    const edited = text.replace(/(["']?)doctor=allow\1/, '');
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
    const copy = path.join(kit, 'workflow', 'workkit', 'command-list.sh');
    const text = fs.readFileSync(copy, 'utf8');
    const edited = text.replace(/(["']?)ship deploy=ask\1/, '$1ship deploy=allow$1');
    expect(edited !== text, `the copy's deploy entry was moved to allow, got: ${text}`).toBeTruthy();
    fs.writeFileSync(copy, edited);
    const { code, said } = runCli(world, ['setup'], { script });
    expect(code, `exit 0, got: ${said}`).toBe(0);
    const moved = TABLE.map(([c, p]) => [c, c === 'ship deploy' ? 'allow' : p]);
    const written = JSON.parse(fs.readFileSync(settings, 'utf8'));
    expect(JSON.stringify(written.permissions && written.permissions.allow), `every allow rule, the deploy's among them, got: ${said}`)
      .toBe(JSON.stringify([...commandsWith('allow', moved).map((c) => `Bash(workkit ${c}:*)`), 'Bash(npm publish:*)']));
    const warned = said.split('\n').filter((l) => l.includes('⚠') && l.includes('allow:'));
    expect(JSON.stringify(warned), 'no warning about the rules').toBe('[]');
    expect(JSON.stringify(Object.keys(written.permissions)), 'and no permissions.ask key').toBe('["allow"]');
    cleanup(world.root); cleanup(kit);
  });
});
