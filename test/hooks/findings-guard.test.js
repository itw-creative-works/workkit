// Tests for safety:findings-guard's findingsVerdict({ steps, cwd, repo, facts: { route } }) in hooks/mods/findings-guard.js:
// an `issue create` step whose title starts "review notes from" bounces unless findings.file reads true, `route` being
// findingsRoute's answer over the repo and machine settings. How an argv spells the title is the caller's; the wiring,
// a real gh call through the shim, is test/scripts/identity/gh-shim.test.js.

const { describe, test, expect } = require('../lib/harness');
const { mods, textOf, mergedSettings } = require('../lib/mods-inputs');

const CWD = '/w/repo';
const create = (title) => [{
  sub: 'create', number: null, add: [], remove: [], title,
}];
const CREATE = create('review notes from the 0.19.0 ship');
const BLOCK = "findings-guard: BLOCKED this gh issue create: a review notes issue files findings, and findings.file is not on for this repo.\nSay findings in chat under 🧭 Findings instead, one bullet each, for the owner to answer file or drop; file nothing on your own. findings.file: true in the settings file (the repo's .workkit/settings.json, or ~/.workkit/settings.json) turns filing on.";

// The verdict with the route the merged view of the two settings files gives (null for no file).
const judge = (steps, { repo = null, user = null } = {}) => mods('findings-guard').findingsVerdict({
  steps, cwd: CWD, repo: null, facts: { route: mods('settings').findingsRoute(mergedSettings({ repo, user })) },
});
const denyOf = (r) => (r && typeof r.deny === 'string' ? r.deny.replace(/\n$/, '') : null);

const bounces = async (steps, layers, what) => expect(denyOf(await judge(steps, layers)), `${what} must bounce`).toBe(BLOCK);
const passes = async (steps, layers, what) => {
  const r = await judge(steps, layers);
  expect(denyOf(r), `${what} must pass`).toBe(null);
  expect(textOf(r), `${what} passes silently`).toBe('');
};

const NO_KEY = { user: { version: 1 }, repo: { enabled: true } };

describe('findings-guard: a review-notes create while findings.file is off', () => {
  test('no findings.file key in either file: the create bounces, naming the chat route and the toggle', async () => {
    await bounces(CREATE, NO_KEY, 'the review-notes create');
  });

  test('findings.file false in the global file: the same create bounces', async () => {
    await bounces(CREATE, { user: { findings: { file: false } } }, 'a create under a global false');
  });

  test('findings.file true in the global file and no repo key: it passes', async () => {
    await passes(CREATE, { user: { findings: { file: true } }, repo: { enabled: true } }, 'a create under a global true');
  });

  test('true globally and false in the repo file bounces; false globally and true in the repo file passes', async () => {
    await bounces(CREATE, { user: { findings: { file: true } }, repo: { enabled: true, findings: { file: false } } }, 'a create under a repo false');
    await passes(CREATE, { user: { findings: { file: false } }, repo: { enabled: true, findings: { file: true } } }, 'a create under a repo true');
  });

  test('the title ... bounces, letter case ignored', async () => {
    await bounces(create('Review notes from the 0.19.0 ship'), NO_KEY, 'the title in another case');
  });
});

describe('findings-guard: everything else passes', () => {
  test('another title, a comment carrying the phrase, or the phrase past the title\'s start: each passes', async () => {
    await passes(create('feat: a title'), NO_KEY, 'a create with another title');
    await passes([{
      sub: 'comment', number: 5, add: [], remove: [],
    }], NO_KEY, 'a comment');
    await passes(create('fix: review notes from the 0.19.0 ship'), NO_KEY, 'the phrase past the start');
  });
});
