/**
 * hooks/mods/gh.js: the gh reads the guards make, each spelled once: an
 * issue's JSON view and the open issues at status:building. Plain functions
 * over the `run` a gatherer hands them; the answers' readers are proof.js's.
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
 * `gh issue list [--repo <repo>] --state open --label status:building`, every
 * one up to gh's 1000 with its labels, the list `issuesBuilding` reads. Its
 * argv changes together with hook_issues_building in hooks/lib/snapshot.sh.
 * @param {function} run runs `(argv, init)`, resolving `{ exitCode, stdout }`
 * @param {{repo?: string, cwd?: string}} [init] the repo it names ('' for the folder's), and the run's options
 * @returns {Promise<string|null>} gh's JSON text, null when gh could not answer
 */
export async function buildingList(run, { repo = '', ...init } = {}) {
  return answerOf(await run(['gh', 'issue', 'list', ...repoArgs(repo), '--state', 'open', '--label', 'status:building', '--limit', '1000', '--json', 'number,labels'], init));
}
