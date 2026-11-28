// Tests for the opt-in gate's logic: folderOpted(io, dir) in hooks/mods/guards.js, whether the repo holding a
// call's real folder opted in, and rosterOf and rosterPath in hooks/mods/optin.js, the one roster read and its lookup. The folder is the call's
// own ($.session.cwd() before a Bash call, the event's cwd after it), never one read off the command's text: the
// wiring cases, the hooks-log and HOOK_DISABLE ones included, are test/mods/guards-tree-guard.test.ts.

const { describe, test, expect } = require('../lib/harness');
const { mods } = require('../lib/mods-inputs');
const { OPT_IN_SHAPES } = require('../lib/git-repo');

// Each repo's .workkit/settings.json as text, the form the gate reads.
const SETTINGS = {
  enabled: OPT_IN_SHAPES.current,
  declined: '{ "version": 1, "enabled": false }\n',
  unanswered: '{ "version": 1 }\n',
};

// An io over one repo at /w/r whose settings are `settings` (null for no file); /w/nowhere is in no repo.
const ioWith = (settings) => ({
  top: async (dir) => (dir === '/w/r' || dir.startsWith('/w/r/') ? '/w/r' : null),
  read: async (p) => (p === '/w/r/.workkit/settings.json' ? settings : null),
  exists: async () => false,
  run: async () => null,
  stat: async () => null,
  now: () => 0,
  pluginRoot: '/kit',
});

const opted = async (settings, dir = '/w/r') => Boolean(await mods('guards').folderOpted(ioWith(settings), dir));

describe('optin: the repo holding the folder', () => {
  test('enabled runs the hooks, from the root and from a folder under it', async () => {
    expect(await opted(SETTINGS.enabled), 'the root').toBe(true);
    expect(await opted(SETTINGS.enabled, '/w/r/packages/core'), 'a folder under it').toBe(true);
  });

  test('no settings file, "enabled": false and a file with no enabled key each stand the hooks down', async () => {
    for (const [answer, settings] of [['none', null], ['declined', SETTINGS.declined], ['no enabled key', SETTINGS.unanswered]]) {
      expect(await opted(settings), `a repo answering ${answer}`).toBe(false);
    }
  });

  test('outside any git repo: the gate says no', async () => {
    expect(await opted(SETTINGS.enabled, '/w/nowhere'), 'no repo').toBe(false);
  });
});

describe('optin.js: rosterOf, the one roster read', () => {
  test('rosterOf parses the machine folder\'s .repos.json, WORKFLOW_HOME moving it, null when absent or broken', async () => {
    const { rosterOf } = mods('optin');
    const roster = { repos: { '/w/o/repo': 'enabled' } };
    const files = { '/w/home/.workkit/.repos.json': JSON.stringify(roster), '/w/moved/.repos.json': '{ "repos": ' };
    const read = async (p) => files[p] ?? null;
    expect(JSON.stringify(await rosterOf({ HOME: '/w/home' }, read)), 'the roster under HOME').toBe(JSON.stringify(roster));
    expect(await rosterOf({ HOME: '/w/home', WORKFLOW_HOME: '/w/moved' }, read), 'WORKFLOW_HOME moves it, and a broken file is null').toBe(null);
    expect(await rosterOf({ HOME: '/w/empty' }, read), 'no roster is null').toBe(null);
  });
});

describe('optin.js: rosterPath, the rostered folder of a slug', () => {
  // One enabled and one declined folder, each with its origin's slug.
  const ROSTER = { version: 1, repos: { '/w/mine': 'enabled', '/w/theirs': 'declined' } };
  const ORIGINS = { '/w/mine': 'Owner/Mine', '/w/theirs': 'owner/theirs' };
  const slugOf = async (dir) => ORIGINS[dir] ?? '';

  test('an enabled entry whose origin is the slug answers its folder, in any letter case', async () => {
    const { rosterPath } = mods('optin');
    expect(await rosterPath('Owner/Mine', ROSTER, slugOf), 'as the origin spells it').toBe('/w/mine');
    expect(await rosterPath('owner/MINE', ROSTER, slugOf), 'another letter case').toBe('/w/mine');
  });

  test('a declined entry, a slug no entry carries and no roster at all answer null', async () => {
    const { rosterPath } = mods('optin');
    expect(await rosterPath('owner/theirs', ROSTER, slugOf), 'a declined repo has not opted in').toBe(null);
    expect(await rosterPath('owner/absent', ROSTER, slugOf), 'not on the roster').toBe(null);
    expect(await rosterPath('Owner/Mine', null, slugOf), 'no roster').toBe(null);
  });

  test('with several folders answering the slug, the first enabled one in the roster wins, a declined one before it passed over', async () => {
    const { rosterPath } = mods('optin');
    // Each folder names acme/public, as the bot's public-repo read answers for a pairing.
    const roster = { version: 1, repos: { '/w/declined': 'declined', '/w/one': 'enabled', '/w/two': 'enabled' } };
    expect(await rosterPath('Acme/Public', roster, async () => 'acme/public'), 'the first enabled folder').toBe('/w/one');
  });
});
