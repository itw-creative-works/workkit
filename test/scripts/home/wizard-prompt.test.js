// Tests for workflow/home.sh: the setup wizard's question (no terminal hands over
// the command, an answer short of yes leaves everything alone, the prompt on
// stderr, something in the way stops it). The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const { cleanup, mkRemote, mkWorld, inHome, setup } = require('./helpers');

describe('workflow/home: the wizard, the question', () => {
  test('without a terminal it names workkit setup --home, and asks nothing', () => {
    const world = mkWorld({ login: 'owner' });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);

    const { code, out } = inHome(world, 'interactive() { return 1; }\nwk_home_setup');
    expect(code, 'it finishes rather than waiting for an answer').toBe(0);
    expect(out.includes('`workkit setup --home`'), `and hands over the command that does it, got: ${out}`).toBeTruthy();
    const calls = world.ghCalls().map((c) => c.join(' '));
    expect(!calls.some((c) => c.includes('repo create')), `nothing is created: ${fmtCalls(world.ghCalls())}`).toBeTruthy();
    expect(world.settings().site.repo, 'a machine that never answered gets no home').toBe(null);
    expect(!fs.existsSync(world.tower), 'and nothing is cloned').toBeTruthy();
    cleanup(world.root);
  });

  test('an answer that is not yes leaves everything alone, and the function returns 0', () => {
    for (const [label, input] of [['n', 'n\n'], ['maybe', 'maybe\n'], ['Enter alone', '\n'], ['a closed stdin', '']]) {
      const world = mkWorld({ login: 'owner' });
      const { code, out } = setup(world, { input });
      expect(code, `${label}: returns 0, got: ${out}`).toBe(0);
      expect(/home: left as it is/.test(out), `${label}: the skip line says so, got: ${out}`).toBeTruthy();
      expect(world.settings().site.repo, `${label}: and no home is recorded`).toBe(null);
      expect(!fs.existsSync(world.tower), `${label}: nothing is cloned`).toBeTruthy();
      cleanup(world.root);
    }
  });

  test('the wizard question and its [y/N] hint are on stderr, none of it on stdout', () => {
    const world = mkWorld({ login: 'owner' });
    const { out, err } = setup(world, { input: 'n\n' });
    // `out` is stdout then stderr, so stdout is what comes before stderr's text.
    const stdout = out.slice(0, out.length - err.length);
    expect(/Create the private home repo owner\/workkit and make \S+ its clone\? \[y\/N\]/.test(err),
      `the prompt and hint are on stderr, got: ${err}`).toBeTruthy();
    expect(!stdout.includes('Create the private home repo'), `the prompt is not on stdout, got: ${stdout}`).toBeTruthy();
    expect(!stdout.includes('[y/N]'), `nor the hint, got: ${stdout}`).toBeTruthy();
    cleanup(world.root);
  });

  test('something in the way stops setup before it writes anything', () => {
    const world = mkWorld({ login: 'owner' });
    fs.mkdirSync(world.tower, { recursive: true });
    fs.writeFileSync(path.join(world.tower, 'mine.txt'), 'mine\n');
    const { code, out } = setup(world);
    expect(code, 'setup never dies mid-way').toBe(0);
    expect(/move it aside/.test(out), `it names what is in the way, got: ${out}`).toBeTruthy();
    expect(!/Discussions/.test(out), 'and no later step ran').toBeTruthy();
    expect(!fs.existsSync(path.join(world.tower, 'package.json')), 'nothing was seeded over it').toBeTruthy();
    cleanup(world.root);
  });
});
