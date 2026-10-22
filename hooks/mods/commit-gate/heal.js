/**
 * hooks/mods/commit-gate/heal.js: the commit gate's heal-bookkeeping arms,
 * each proving a file is exactly the heal's output: the version stamp (which
 * the manifest classifier shares), a retired linter copy's deletion, and the
 * checks.yml rewrite. The rewrite is workflow/changelog/changelog-job.sh's,
 * reached through its entry, so the gate never accepts a change the heal would
 * not make; so are the copies and the still-runs question (wk_linter_copies,
 * wk_names_linter_copy), asked over the texts git answers.
 */

import { LONG_RUN_MS } from '../suite.js';
import { versionOnly } from './checks.js';

const CHECKS = '.github/workflows/checks.yml';

const lines = (text) => text.split('\n').filter(Boolean);

/** A heal arm whose tool failed: neither yes nor no, so the commit is held by name. */
export class HealHeld extends Error {}

// A tool's failure as the hold's text: the arm, the command, its status and stderr.
function held(check, cmd, rc, stderr) {
  const err = String(stderr ?? '').replace(/\n+$/, '');
  return new HealHeld(`the ${check} check could not run: \`${cmd}\` exited ${rc}${err ? ` (${err})` : ''}. Its answer is unknown, so the commit is held; fix what failed, then commit.`);
}

// A run the program never started for is a failure whatever status it carries.
const started = (r) => r.isStarted !== false;

/**
 * The heal arms over the commit's facts; none writes a file, the rewrite
 * hashed through `hashOf`.
 * @param {object} facts commitGateVerdict's facts (`run`, `show`, `read`,
 *   `jobRewrite`, `hashOf`, `kitRoot`)
 * @param {string} root the repo root
 * @param {boolean} all whether the commit runs under -a/--all, so the working tree is what it carries
 * @returns {{versionBumpOnly: function, isBookkeeping: function}}
 */
export function healArms(facts, root, all) {
  const git = (argv, init = {}) => facts.run(['git', '-C', root, ...argv], { cwd: root, timeoutMs: LONG_RUN_MS, ...init });
  const job = (args, init = {}) => facts.run(['bash', `${facts.kitRoot}/workflow/changelog/changelog-job.sh`, ...args], { cwd: root, timeoutMs: LONG_RUN_MS, ...init });
  let copies = null;

  // A run whose status up to `max` is an answer; past it, or never started, the hold.
  async function ask(check, max, cmd, result) {
    const r = await result;
    if (started(r) && r.exitCode <= max) return r;
    throw held(check, cmd, r.exitCode, r.stderr);
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
    let copy;
    if (all) {
      copy = await facts.read(`${root}/${file}`);
      if (copy === null) return false;
    } else {
      if ((await gitAsk(check, 1, ['rev-parse', '-q', '--verify', `:${file}`])).exitCode === 1) return false;
      copy = await blob(check, '', file);
    }
    return copy !== '' && versionOnly(head, copy);
  }

  // The workflow texts of the tree the commit produces: the index's, or under -a the folder's.
  async function workflowTexts(check) {
    const cmd = `git -C ${root} ls-files -z${all ? ' --cached --others' : ''} -- .github/workflows`;
    const argv = ['ls-files', '-z', ...(all ? ['--cached', '--others'] : []), '--', '.github/workflows'];
    const files = [...new Set((await tool(check, cmd, git(argv))).stdout.split('\0').filter(Boolean))];
    if (all) return Promise.all(files.map(async (file) => (await facts.read(`${root}/${file}`)) ?? ''));
    return Promise.all(files.map((file) => blob(check, '', file)));
  }

  // The copy is deleted, and no workflow in the tree the commit produces still runs it.
  async function linterCopyRetired(path) {
    const check = 'linter copy';
    let deleted = (await gitAsk(check, 0, ['diff', '--cached', '--name-only', '--diff-filter=D'])).stdout;
    if (all) deleted += (await gitAsk(check, 0, ['diff', '--name-only', '--diff-filter=D'])).stdout;
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

  // checks.yml's blob is byte for byte the heal's rewrite of HEAD's file.
  async function checksIsJobRewrite() {
    const check = 'checks.yml rewrite';
    if ((await gitAsk(check, 1, ['rev-parse', '-q', '--verify', `HEAD:${CHECKS}`])).exitCode === 1) return false;
    const head = await blob(check, 'HEAD', CHECKS);
    const answer = await facts.jobRewrite(head);
    const rewrite = typeof answer === 'string' ? { exitCode: 0, stdout: answer, stderr: '' } : answer ?? { exitCode: 1, stdout: '', stderr: '' };
    await tool(check, `wk_changelog_job_rewrite <HEAD:${CHECKS}>`, rewrite);
    const want = await facts.hashOf(CHECKS, rewrite.stdout);
    let have;
    if (all) {
      const text = await facts.read(`${root}/${CHECKS}`);
      if (text === null) return false;
      have = await facts.hashOf(CHECKS, text);
    } else {
      const staged = await gitAsk(check, 1, ['rev-parse', '-q', '--verify', `:${CHECKS}`]);
      if (staged.exitCode === 1) return false;
      have = staged.stdout.trim();
    }
    if (!want) throw held(check, `git -C ${root} hash-object --path=${CHECKS} --stdin`, 'non-zero', '');
    return have !== '' && have === want;
  }

  /**
   * Whether every file is the heal's output, each proved by its arm: the
   * settings stamp, checks.yml, or a linter copy's deletion.
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
