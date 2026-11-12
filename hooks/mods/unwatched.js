/**
 * hooks/mods/unwatched.js: workflow:unwatched. A test run started in the
 * background that the supervisor does not read gets a one-line notice naming
 * the `workkit supervise` form of its step; never a deny (docs/hooks.md § workflow:unwatched).
 */

import { baseName, peelPrefixes, unredirectedIndices, writtenSteps } from './command.js';
import { isAbsolute, repoPathOf } from './optin.js';

// A `test` script name `npm run` takes: `test`, `test:unit`, `test-e2e`.
const TEST_SCRIPT = /^test(?:[:.-]|$)/;

// Each step: its folder, its command word (by any path), the words after it,
// and the step as the call spelled it from the command word on, prefixes and redirects dropped.
function commandSteps(command) {
  return writtenSteps(command).steps.map(({ dir, words, written }) => {
    const kept = unredirectedIndices(words);
    const { skip, word } = peelPrefixes(kept.map((i) => words[i]));
    const named = kept.slice(skip);
    return { dir, name: baseName(word), args: named.slice(1).map((i) => words[i]), shown: named.map((i) => written[i]).join(' ') };
  });
}

const isTestRun = ({ name, args }) => (name === 'npm' && (args[0] === 'test' || (args[0] === 'run' && TEST_SCRIPT.test(args[1] ?? ''))))
  || (name === 'workkit' && args[0] === 'test');

// The bare whole suite: `npm test` and `npm run test` in the repo root, `workkit test`
// from any folder (it moves to the root itself).
const bareNpm = ({ name, args }) => name === 'npm' && ['test', 'run test'].includes(args.join(' '));
const bareWorkkit = ({ name, args }) => name === 'workkit' && args.join(' ') === 'test';

// The folder a step runs in: stepDirs' '' is the cwd, `?` is unknown (null).
function folderOf(dir, cwd) {
  if (dir === '') return cwd || null;
  if (dir === '?') return null;
  if (isAbsolute(dir)) return dir;
  return cwd ? `${cwd}/${dir}` : null;
}

// Whether the folder is its repo's root: git's prefix there is empty.
const atRoot = async (folder, run) => folder !== null && (await repoPathOf(folder, run, '')) === '';

/**
 * unwatched's notice on a background Bash call: one line per test step the
 * supervisor does not read, naming that step under `workkit supervise`, else
 * null. Judged on the stripped text; a call naming `workkit supervise` is read already.
 * @param {{command: string, cwd: string, background: boolean, run: function}} facts
 *   the command, its folder, whether it runs in the background, and the program run
 * @returns {Promise<{context: string}|null>}
 */
export async function unwatchedGuard(facts) {
  const { command, cwd, background, run } = facts;
  if (!background || !command) return null;
  const steps = commandSteps(command);
  if (steps.some(({ name, args }) => name === 'workkit' && args[0] === 'supervise')) return null;
  const lines = [];
  for (const step of steps.filter(isTestRun)) {
    if (bareWorkkit(step) || (bareNpm(step) && (await atRoot(folderOf(step.dir, cwd), run)))) continue;
    lines.push(`workflow:unwatched: the supervisor does not read this background test run; start that step as workkit supervise -- ${step.shown}`);
  }
  return lines.length > 0 ? { context: lines.join('\n') } : null;
}
