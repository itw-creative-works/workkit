/**
 * hooks/mods/gh.js: the gh reads the guards make, each spelled once: an
 * issue's JSON view and the open issues at a status: label, and the texts a
 * gh guard answers with around them. Plain functions over the `run` a gatherer
 * hands them; the answers' readers are proof.js's.
 */

// gh's answer, null when it failed or printed nothing.
const answerOf = (result) => (result.exitCode === 0 && result.stdout.trim() ? result.stdout : null);
const repoArgs = (repo) => (repo ? ['--repo', repo] : []);

/**
 * `gh issue view <n> [--repo <repo>] --json <fields>`.
 * @param {function} run runs `(argv, init)`, resolving `{ exitCode, stdout }`
 * @param {string|number} n the issue
 * @param {string} fields the `--json` fields, comma-joined
 * @param {{repo?: string, cwd?: string, timeoutMs?: number}} [init] the repo it names ('' for the folder's), and the run's options
 * @returns {Promise<string|null>} gh's JSON text, null when gh could not answer
 */
export async function issueView(run, n, fields, { repo = '', ...init } = {}) {
  return answerOf(await run(['gh', 'issue', 'view', String(n), ...repoArgs(repo), '--json', fields], init));
}

/**
 * `gh issue list [--repo <repo>] --state open --label <stage>`, every one up
 * to gh's 1000 with its labels, the list `issuesAt` reads.
 * @param {function} run runs `(argv, init)`, resolving `{ exitCode, stdout }`
 * @param {string} stage the status: label (`status:qa`)
 * @param {{repo?: string, cwd?: string}} [init] the repo it names ('' for the folder's), and the run's options
 * @returns {Promise<string|null>} gh's JSON text, null when gh could not answer
 */
export async function stageList(run, stage, { repo = '', ...init } = {}) {
  return answerOf(await run(['gh', 'issue', 'list', ...repoArgs(repo), '--state', 'open', '--label', stage, '--limit', '1000', '--json', 'number,labels'], init));
}

/**
 * The stage list at status:building. Its argv changes together with
 * wk_issues_building in workflow/lib/hold.sh.
 * @param {function} run runs `(argv, init)`, resolving `{ exitCode, stdout }`
 * @param {{repo?: string, cwd?: string}} [init] the repo it names ('' for the folder's), and the run's options
 * @returns {Promise<string|null>} gh's JSON text, null when gh could not answer
 */
export async function buildingList(run, init) {
  return stageList(run, 'status:building', init);
}

/**
 * A gh guard's deny, the notes gathered so far leading it.
 * @param {string[]} notes the notes, read when the deny is made
 * @returns {function(string): {deny: string}}
 */
export const denyAfter = (notes) => (text) => ({ deny: [...notes, text].join('\n') });

/**
 * A gh guard's notice for an issue it could not read.
 * @param {string} hook the hook (`proof-guard`)
 * @param {string} gate what did not run (`proof gate`)
 * @returns {function(string, string): string} `(n, why)` to the line
 */
export const ghSkipped = (hook, gate) => (n, why) => `${hook}: could not read issue #${n} (${why}), so the ${gate} did not run on this command.`;
