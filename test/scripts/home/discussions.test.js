// Tests for workflow/lib/discussions.sh: posting a summary and reading summaries back.
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const { cleanup, mkWorld, inHome } = require('./helpers');

describe('workflow/discussions: posting and reading back', () => {
  test('a summary is posted, and the discussion URL comes back', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true });
    const body = path.join(world.root, 'summary.md');
    fs.writeFileSync(body, '## Went well\nA day.\n');
    const { code, out } = inHome(world, [
      'wk_disc_resolve_category owner/workkit Daily',
      `wk_disc_create owner/workkit "$WK_DISC_CATEGORY_ID" "daily: 2026-07-28" ${JSON.stringify(body)}`,
    ].join('\n'));
    expect(code, 'exit 0').toBe(0);
    expect(/discussions\/3/.test(out), `the URL is what a caller logs, got: ${out}`).toBeTruthy();
    const posted = world.ghCalls().map((c) => c.join(' ')).find((c) => c.includes('createDiscussion'));
    expect(posted.includes(`body=@${body}`), `the body is sent from a file, never as an argument: ${posted}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a rollup reads prior summaries back, and the window is applied here', () => {
    // The API takes no date argument (only an order) so the period is a
    // filter on what came back, not a query the server ran.
    const world = mkWorld({ login: 'owner', discussionsOn: true });
    const { code, out } = inHome(world, 'wk_disc_list owner/workkit Daily 2026-07-21T00:00:00Z');
    expect(code, 'exit 0').toBe(0);
    const listed = JSON.parse(out.trim());
    expect(listed.length, `only the summaries inside the window: ${out}`).toBe(1);
    expect(listed[0].body, 'and they carry their bodies for the rollup to read').toBe('yesterday');
    cleanup(world.root);
  });

  test('the resolution falls back to the default category, and says which', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    const { out } = inHome(world, 'wk_disc_resolve_category owner/workkit Weekly\nprintf "%s %s\\n" "$WK_DISC_CATEGORY_NAME" "$WK_DISC_CATEGORY_ID"');
    expect(/^General DIC_0$/m.test(out.trim()), `the caller learns both name and id, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });
});
