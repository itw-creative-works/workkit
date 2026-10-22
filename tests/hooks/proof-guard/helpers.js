// The shared prologue of the safety:proof-guard logic suites beside this one,
// which call proofGuardVerdict({ command, cwd, root, issueView, touched,
// packages, suiteRecord, packageRecord, treeId, roster, rootOnly }) in
// hooks/mods/proof-guard.js over plain facts: the issue-view stub, the facts'
// defaults, the package lookup and the hook's exact texts.

const { assertEq } = require('../../lib/harness');
const { mods, textOf } = require('../../lib/mods-inputs');

const ROOT = '/w/repo';
const TREE = 'a'.repeat(40);
const OTHER_TREE = 'b'.repeat(40);

/** The `comments` value gh answers with, one comment per body. */
const comments = (...bodies) => bodies.map((body) => ({ body }));

// One issue with a proof, one without, in every world.
const WORLD = {
  7: { comments: comments('Proof: unit: node tests/hooks/x.test.js') },
  9: { comments: comments('looks good to me') },
};

/**
 * The issueView fact over `views` (number to gh's parsed answer): it records
 * each read as `[number, repo or null]` and answers gh's JSON text, or null
 * for a number gh does not know and for every read when `fails`.
 */
const viewer = (views = WORLD, { fails = false } = {}) => {
  const calls = [];
  const issueView = async (n, repo) => {
    calls.push([String(n), repo || null]);
    if (fails) return null;
    const view = views[String(n)];
    return view === undefined ? null : JSON.stringify(view);
  };
  return { issueView, calls };
};

/**
 * The packages fact: the nearest of `pkgs` (folders declaring a test script)
 * holding the path, else `.` while the root declares one, else null.
 */
const packagesOf = (pkgs = [], rootScript = true) => (file) => {
  const owner = pkgs.filter((p) => file.startsWith(`${p}/`)).sort((a, b) => b.length - a.length)[0];
  return owner || (rootScript ? '.' : null);
};

/** The package record a green narrowed run leaves: the tree, then one folder a line. */
const pkgRecord = (pkgs, tree = TREE) => `${[tree, ...pkgs].join('\n')}\n`;

/** The suite record a green root run leaves. */
const suiteRecord = (tree = TREE) => `${tree}\n`;

/** proofGuardVerdict over `command` and the session repo's defaults, `over` replacing any. */
const judge = (command, over = {}) => mods('proof-guard').proofGuardVerdict({
  command,
  cwd: ROOT,
  root: ROOT,
  issueView: viewer().issueView,
  touched: [],
  packages: packagesOf(),
  suiteRecord: null,
  packageRecord: null,
  treeId: TREE,
  roster: null,
  rootOnly: undefined,
  ...over,
});

const denyOf = (r) => (r && typeof r.deny === 'string' ? r.deny.replace(/\n$/, '') : null);

const QA = 'gh issue edit 3 --remove-label status:building --add-label status:qa';

const BLOCK = (n, what) => `proof-guard: BLOCKED this command. Issue #${n} carries no comment whose line starts with "Proof:", so it cannot ${what} (docs/project-state.md, "The proof": the proof is a hard gate).\nThe proof is written at the PARK by the agent that built the item, from the layers it actually ran (skills/feature/SKILL.md section 6): comment the Proof: line on the issue first, one entry per layer with the command or the reason that layer was skipped, then run this again. It is never invented at ship time and never written on the owner's behalf.`;
const UNREAD = 'proof-guard: BLOCKED this command. Its --repo value could not be read (a variable, a command substitution, a backtick or a quoted span), so the gate cannot tell which repo the flip or close acts on. Write the repo out as owner/name, then run it again.';
const CD_BOUNCE = 'proof-guard: BLOCKED this command. It changes directory (cd, pushd or popd) before a gated gh issue flip or close, so the gate cannot tell which tree and repo that command acts on. Run the cd in its own Bash call first, then the gh command alone; where the directory resets between calls (a subagent), run the flip from a session whose directory is that repo.';
const SKIPPED = (n) => `proof-guard: could not read issue #${n} (gh could not answer), so the proof gate did not run on this command.`;
const QA_BLOCK = (count, ...lines) => `proof-guard: BLOCKED this flip to status:qa: the ${count} touched test file(s) below have no green test run recorded on this tree. In each package named, run its own tests narrowed to those files (\`npm test -- <files>\` from that folder, with the paths in the form its runner takes), then flip again.\n${lines.join('\n')}`;
const HASH_BLOCK = (root) => `proof-guard: BLOCKED this flip to status:qa: the working tree of ${root} could not be hashed, so the park's test record cannot be read. Fix what stops git hashing the tree (git add -A into a throwaway index, then git write-tree), then flip again.`;
const SHAPE_NOTE = 'The settings key proof.rootOnly in .workkit/settings.json is not an array of folder strings, so no package was taken as proved by the root run alone.';
const ROOT_ONLY = 'proved by the root run alone (settings proof.rootOnly)';

/** The verdict blocked with exactly `text`. */
const assertBlocks = (r, text, what) => assertEq(denyOf(r), text, what);

/** The verdict passed, and its one notice (empty when silent) is handed back. */
const passText = (r, what) => {
  assertEq(denyOf(r), null, `must pass: ${what}`);
  return textOf(r);
};

module.exports = {
  ROOT, TREE, OTHER_TREE, WORLD, comments, viewer, packagesOf, pkgRecord, suiteRecord, judge, denyOf, textOf,
  QA, BLOCK, UNREAD, CD_BOUNCE, SKIPPED, QA_BLOCK, HASH_BLOCK, SHAPE_NOTE, ROOT_ONLY, assertBlocks, passText,
};
