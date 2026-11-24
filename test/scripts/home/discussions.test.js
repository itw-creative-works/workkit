// Tests for workflow/lib/discussions.js: posting a summary and reading summaries back, each call asked in a node of
// its own under the world's env against its stand-in gh. The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const { kitUnder } = require('../../lib/kit-under');
const { cleanup, mkWorld } = require('./helpers');

const SLUG = 'owner/workkit';

/** `<name>(...args)` of discussions.js, once, under the world's env. */
const ask = (world, name, ...args) => kitUnder(world.env, 'discussions.js', name, [args])[0];

describe('workflow/discussions: posting and reading back', () => {
  test('a summary is posted, and the discussion URL comes back', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true });
    const body = path.join(world.root, 'summary.md');
    fs.writeFileSync(body, '## Went well\nA day.\n');
    const category = ask(world, 'resolveCategory', SLUG, 'Daily');
    expect(category, 'the asked category, no fallback').toEqual({ id: 'DIC_0', name: 'Daily', fellBack: false });
    const url = ask(world, 'create', SLUG, category.id, 'daily: 2026-07-28', body);
    expect(url, 'the URL is what a caller logs').toBe('https://github.com/owner/workkit/discussions/3');
    const posted = world.ghCalls().find((c) => c.some((a) => a.includes('createDiscussion')));
    const at = posted.indexOf(`body=@${body}`);
    expect(posted[at - 1], `the body is sent from a file, never as an argument: ${JSON.stringify(posted)}`).toBe('-F');
    expect(posted.includes('catId=DIC_0') && posted.includes('repoId=R_kdt') && posted.includes('title=daily: 2026-07-28'),
      `in the category resolved, on the repo's node id, under its title: ${JSON.stringify(posted)}`).toBe(true);
    cleanup(world.root);
  });

  test('a rollup reads prior summaries back, and the window is applied here', () => {
    // The API takes no date argument (only an order) so the period is a
    // filter on what came back, not a query the server ran.
    const world = mkWorld({ login: 'owner', discussionsOn: true });
    const listed = ask(world, 'list', SLUG, 'Daily', '2026-07-21T00:00:00Z');
    expect(listed, 'only the summaries inside the window, carrying their bodies for the rollup to read')
      .toEqual([{ title: 'daily: 2026-07-27', createdAt: '2026-07-27T09:00:00Z', body: 'yesterday' }]);
    cleanup(world.root);
  });

  test('the resolution falls back to the default category, and says which', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    expect(ask(world, 'resolveCategory', SLUG, 'Weekly'), 'the caller learns the name, the id and that it fell back')
      .toEqual({ id: 'DIC_0', name: 'General', fellBack: true });
    cleanup(world.root);
  });
});
