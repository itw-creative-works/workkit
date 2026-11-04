// The shared prologue of the safety:proof-guard logic suites beside this one,
// which call proofVerdict({ steps, cwd, repo, facts }) in hooks/mods/proof-guard.js,
// one step per issue ({ sub, number, add, remove }) and `facts` the plain facts
// { root, issueView, touched, packages, suiteRecord, packageRecord, treeId, pkgTree,
// roster, rootOnly, settingsFaults }: the steps, the issue-view stub, the facts' defaults, the
// package lookup, the real-facts flip and its session, and the hook's exact texts.

const { assertEq } = require('../../lib/harness');
const { mods, textOf } = require('../../lib/mods-inputs');
const { shellPath, spawnSync } = require('../../lib/platform');
const { scratchWorkflowHome } = require('../../lib/workflow-home');
const { ioIn, runResult } = require('../../../workflow/lib/io');

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

/** The package record green narrowed runs leave: one `<tree> <folder>` line per package. */
const pkgRecord = (pkgs, tree = TREE) => pkgs.map((pkg) => `${tree} ${pkg}\n`).join('');

/** The suite record a green root run leaves. */
const suiteRecord = (tree = TREE) => `${tree}\n`;

/** One step: issue `number`'s `sub` call, adding and removing those labels. */
const step = (sub, number, add = [], remove = []) => ({
  sub, number, add, remove,
});

/**
 * proofVerdict over `steps` and the session repo's defaults, `over` replacing
 * any: `cwd` and `repo` (null: the session's) at the top, every other key a fact.
 * Every package's own id is the whole tree's, with no note, unless `pkgTree`
 * (resolving `{ id, note }`) says otherwise, as in a repo with no workspaces.
 */
const judge = (steps, { cwd = ROOT, repo = null, ...over } = {}) => mods('proof-guard').proofVerdict({
  steps,
  cwd,
  repo,
  facts: {
    root: ROOT,
    issueView: viewer().issueView,
    touched: [],
    packages: packagesOf(),
    suiteRecord: null,
    packageRecord: null,
    treeId: TREE,
    pkgTree: async () => ({ id: 'treeId' in over ? over.treeId : TREE, note: null }),
    roster: null,
    rootOnly: undefined,
    settingsFaults: [],
    ...over,
  },
});

const denyOf = (r) => (r && typeof r.deny === 'string' ? r.deny.replace(/\n$/, '') : null);

const QA = [step('edit', 3, ['status:qa'], ['status:building'])];

// The issue's view, a Proof: line on it, the one read no machine answers for a scratch repo.
const VIEW = JSON.stringify({ state: 'OPEN', labels: [{ name: 'status:building' }], comments: [{ body: 'Proof: unit: npm test' }], body: '' });

/**
 * proofVerdict on the qa flip in <dir>, its facts the real proofFacts over the io of a session whose variables are <env>;
 * <answer>(argv) stands in for any run it answers (a run result), the rest run for real.
 */
const flip = async (dir, env, answer = () => undefined) => {
  const io = ioIn(env);
  const run = (argv, init) => {
    if (argv[0] === 'gh') return Promise.resolve(runResult({ stdout: VIEW }));
    const stood = answer(argv);
    return stood ? Promise.resolve(stood) : io.run(argv, init);
  };
  const { proofVerdict, proofFacts } = mods('proof-guard');
  const facts = await proofFacts(mods('guards').bashFacts({ ...io, run }, env, { command: '', cwd: dir }));
  return proofVerdict({ steps: QA, cwd: dir, repo: null, facts });
};

/** The session flip reads <dir> in, over a scratch workflow home, and the repo's root as git names it. */
const sessionOf = (dir, prefix) => {
  const { env: homeEnv } = scratchWorkflowHome(prefix);
  const env = { ...process.env, ...homeEnv, WORKKIT_NODE: shellPath(process.execPath) };
  const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
  return { dir, env, root };
};

const BLOCK = (n, what) => `proof-guard: BLOCKED this command. Issue #${n} carries no comment whose line starts with "Proof:", so it cannot ${what} (docs/project-state.md, "The proof": the proof is a hard gate).\nThe proof is written at the PARK by the agent that built the item, from the layers it actually ran (skills/feature/SKILL.md section 6): comment the Proof: line on the issue first, one entry per layer with the command or the reason that layer was skipped, then run this again. It is never invented at ship time and never written on the owner's behalf.`;
const SKIPPED = (n) => `proof-guard: could not read issue #${n} (gh could not answer), so the proof gate did not run on this command.`;
const QA_BLOCK = (count, ...lines) => `proof-guard: BLOCKED this flip to status:qa: the ${count} touched test file(s) below have no green test run recorded on this tree. In each package named, run its own tests narrowed to those files (\`npm test -- <files>\` from that folder, with the paths in the form its runner takes), then flip again.\n${lines.join('\n')}`;
const WHOLE_TREE = (note) => `${note}; put the node it names on the gate's PATH, or set WORKKIT_NODE.`;
// <why> is `exited <rc>`, or `did not start`.
const DIFF_BLOCK = (root, args, why) => `proof-guard: BLOCKED this flip to status:qa: the working diff of ${root} could not be read (git ${args} ${why}), so the touched test files are unknown. Fix git, then flip again.`;
const HASH_BLOCK = (root) => `proof-guard: BLOCKED this flip to status:qa: the working tree of ${root} could not be hashed, so the park's test record cannot be read. Fix what stops git hashing the tree (git add -A into a throwaway index, then git write-tree), then flip again.`;
const ROOT_ONLY = 'proved by the root run alone (settings proof.rootOnly)';

/** The verdict blocked with exactly `text`. */
const assertBlocks = (r, text, what) => assertEq(denyOf(r), text, what);

/** The verdict passed, and its one notice (empty when silent) is handed back. */
const passText = (r, what) => {
  assertEq(denyOf(r), null, `must pass: ${what}`);
  return textOf(r);
};

module.exports = {
  ROOT, TREE, OTHER_TREE, WORLD, comments, viewer, packagesOf, pkgRecord, suiteRecord, step, judge, denyOf, textOf,
  QA, VIEW, flip, sessionOf, BLOCK, SKIPPED, QA_BLOCK, WHOLE_TREE, DIFF_BLOCK, HASH_BLOCK, ROOT_ONLY, assertBlocks, passText,
};
