/**
 * hooks/mods/commit-gate/heal.js: the commit gate's heal-bookkeeping arms,
 * each proving a file is exactly the heal's output: the retired version key's
 * removal from .workkit/settings.json (the version-only compare the manifest
 * classifier shares), a retired linter copy's deletion, and the checks.yml rewrite. The rewrite is workflow/changelog/changelog-job.sh's,
 * reached through its entry, so the gate never accepts a change the heal would
 * not make; so are the copies and the still-runs question (wk_linter_copies,
 * wk_names_linter_copy), asked over the texts git answers.
 */

import { LONG_RUN_MS } from '../suite.js';
import { versionOnly } from './checks.js';

const CHECKS = '.github/workflows/checks.yml';

const lines = (text) => text.split('\n').filter(Boolean);

/** A tool the gate needed failed (a heal arm's, a git read): neither yes nor no, so the commit is held by name. */
export class HealHeld extends Error {}

/**
 * A tool's failure as the hold: the check, the command, its status and stderr.
 * The gatherer throws it too, for a git read of HEAD that fails.
 * @param {string} check the check that could not run
 * @param {string} cmd the command as run
 * @param {number|string|null} rc its exit status, 'non-zero' for a read that
 *   answered nothing, or 'did not start'
 * @param {string} stderr its stderr
 * @returns {HealHeld}
 */
export function held(check, cmd, rc, stderr) {
  const err = String(stderr ?? '').replace(/\n+$/, '');
  const how = rc === 'did not start' ? rc : `exited ${rc}`;
  return new HealHeld(`the ${check} check could not run: \`${cmd}\` ${how}${err ? ` (${err})` : ''}. Its answer is unknown, so the commit is held; fix what failed, then commit.`);
}

/**
 * A run the program never started for is a failure whatever status it carries.
 * @param {object} r a run's result
 * @returns {boolean}
 */
export const started = (r) => r.isStarted !== false;

/**
 * A run's exit as `held` words it: its code, or 'did not start'.
 * @param {object} r a run's result
 * @returns {number|string|null}
 */
export const exitOf = (r) => (started(r) ? r.exitCode : 'did not start');

/**
 * The heal arms over the commit's facts, the index being what it carries;
 * none writes a file, the rewrite hashed through `hashOf`.
 * @param {object} facts preCommitVerdict's facts (`run`, `show`, `jobRewrite`,
 *   `hashOf`, `kitRoot`)
 * @param {string} root the repo root
 * @returns {{versionBumpOnly: function, isBookkeeping: function}}
 */
export function healArms(facts, root) {
  const git = (argv, init = {}) => facts.run(['git', '-C', root, ...argv], { cwd: root, timeoutMs: LONG_RUN_MS, ...init });
  const job = (args, init = {}) => facts.run(['bash', `${facts.kitRoot}/workflow/changelog/changelog-job.sh`, ...args], { cwd: root, timeoutMs: LONG_RUN_MS, ...init });
  let copies = null;

  // A run whose numeric status is up to `max` is an answer; past it, never
  // started, or ended by a signal (no code), the hold.
  async function ask(check, max, cmd, result) {
    const r = await result;
    if (started(r) && typeof r.exitCode === 'number' && r.exitCode <= max) return r;
    throw held(check, cmd, exitOf(r), r.stderr);
  }
  const tool = (check, cmd, result) => ask(check, 0, cmd, result);
  const gitAsk = (check, max, argv, init) => ask(check, max, `git -C ${root} ${argv.join(' ')}`, git(argv, init));

  async function blob(check, rev, file) {
    const text = await facts.show(rev, file);
    if (text === null) throw held(check, `git -C ${root} show ${rev}:${file}`, 'non-zero', '');
    return text;
  }

  /**
   * Whether `file` differs from HEAD only in its version (versionOnly): a new
   * file, an empty one or JSON that does not parse is a no.
   * @param {string} file the repo-relative path
   * @returns {Promise<boolean>}
   */
  async function versionBumpOnly(file) {
    const check = 'version stamp';
    if ((await gitAsk(check, 1, ['rev-parse', '-q', '--verify', `HEAD:${file}`])).exitCode === 1) return false;
    const head = await blob(check, 'HEAD', file);
    if ((await gitAsk(check, 1, ['rev-parse', '-q', '--verify', `:${file}`])).exitCode === 1) return false;
    const copy = await blob(check, '', file);
    return copy !== '' && versionOnly(head, copy);
  }

  // The workflow texts of the tree the commit produces: the index's.
  async function workflowTexts(check) {
    const argv = ['ls-files', '-z', '--', '.github/workflows'];
    const files = [...new Set((await tool(check, `git -C ${root} ${argv.join(' ')}`, git(argv))).stdout.split('\0').filter(Boolean))];
    return Promise.all(files.map((file) => blob(check, '', file)));
  }

  // The copy is deleted, and no workflow in the tree the commit produces still runs it.
  async function linterCopyRetired(path) {
    const check = 'linter copy';
    const deleted = (await gitAsk(check, 0, ['diff', '--cached', '--name-only', '--diff-filter=D'])).stdout;
    if (!lines(deleted).includes(path)) return false;
    const texts = (await workflowTexts(check)).join('');
    // No workflow text names nothing, and an empty stdin reaches the entry closed.
    if (texts === '') return true;
    return (await ask(check, 1, `wk_names_linter_copy ${path}`, job(['names', '-', path], { stdin: texts }))).exitCode === 1;
  }

  // The copies an earlier heal vendored, asked once.
  async function linterCopies() {
    copies ??= lines((await tool('linter copy', 'wk_linter_copies', job(['copies']))).stdout);
    return copies;
  }

  // checks.yml's blob is byte for byte the caller the heal writes, whatever HEAD
  // held, a first caller included.
  async function checksIsJobRewrite() {
    const check = 'checks.yml rewrite';
    const answer = await facts.jobRewrite();
    const rewrite = typeof answer === 'string' ? { exitCode: 0, stdout: answer, stderr: '' } : answer ?? { exitCode: 1, stdout: '', stderr: '' };
    await tool(check, 'changelog-job.sh rewrite', rewrite);
    const want = await facts.hashOf(CHECKS, rewrite.stdout);
    const staged = await gitAsk(check, 1, ['rev-parse', '-q', '--verify', `:${CHECKS}`]);
    if (staged.exitCode === 1) return false;
    const have = staged.stdout.trim();
    if (!want) throw held(check, `git -C ${root} hash-object --path=${CHECKS} --stdin`, 'non-zero', '');
    return have !== '' && have === want;
  }

  /**
   * Whether every file is the heal's output, each proved by its arm: the
   * settings file's version key removed (only `version` differs from HEAD,
   * present or absent), checks.yml, or a linter copy's deletion.
   * @param {string[]} files the commit's paths
   * @returns {Promise<boolean>}
   */
  async function isBookkeeping(files) {
    for (const path of files) {
      if (path === '.workkit/settings.json') {
        if (!(await versionBumpOnly(path))) return false;
      } else if (path === CHECKS) {
        if (!(await checksIsJobRewrite())) return false;
      } else if (!(await linterCopies()).includes(path) || !(await linterCopyRetired(path))) {
        return false;
      }
    }
    return true;
  }

  return { versionBumpOnly, isBookkeeping };
}
