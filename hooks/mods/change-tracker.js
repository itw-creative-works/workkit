/**
 * hooks/mods/change-tracker.js: docs:change-tracker, the Stop nag that keeps
 * the work item true, promotes durable findings out of `.workkit/` and checks
 * doc parity while code sits uncommitted or captures sit unfiled; once per
 * change, remembered by fingerprint in `.workkit/agents/.change-tracker`,
 * and only on the Stop of a turn that parked, blocked or closed an issue
 * (docs/hooks.md § docs:change-tracker). It reads files and git, never gh.
 */

import { ghClauseSub, ghFlagValues, ghNames, ghSteps, hasLabel } from './gh-edit.js';
import { sha1Hex } from './markers.js';
import { rowsOf } from './session-guard.js';
import { findingsOn, settingsLayers } from './settings.js';
import { CODE_EXT } from './test-reminder.js';
import { turnMessages } from './turn.js';

const STATE_FILE = '.workkit/agents/.change-tracker';
const PROMPT = 'hooks/mods/change-tracker/prompt.md';

const FINDINGS_ON = 'FINDINGS: findings.file is on. File each finding outside the issue in hand as a `status:inbox` issue and print the `Filed:` trail for what you filed. If GitHub cannot be reached, put the finding in chat and stop there. The owner decides.';
const FINDINGS_OFF = 'FINDINGS: findings.file is off. Build a finding that belongs to the issue in hand into it; say every other finding in chat under **🧭 Findings**, one bullet each in the cold-reader line, for the owner to answer file or drop. File nothing on your own.';
const BOARD = "BOARD: PROGRESS.md still exists in this repo. Migrate it to issues (recipe: the workkit plugin's docs/project-state.md § Migration), then delete the file. Until that happens, keep it true this turn.";

// What a command substitution keeps of a text: every trailing newline dropped.
const chomp = (text) => text.replace(/\n+$/, '');

// A clause that ends work in hand: a park or a block flip, or a close.
function endsWork(clause, detect) {
  const sub = ghClauseSub(detect);
  if (sub === 'close') return true;
  if (sub !== 'edit') return false;
  const labels = ghFlagValues(clause, '--add-label');
  return hasLabel(labels, 'status:qa') || hasLabel(labels, 'status:blocked');
}

/**
 * Whether the turn reached an endpoint: a Bash tool use after the last owner
 * prompt runs `gh issue edit` adding status:qa or status:blocked, or `gh issue close`.
 * @param {object[]} messages the transcript, the session's SessionMessage rows
 * @returns {boolean}
 */
export function endpointTurn(messages) {
  return turnMessages(messages).some((message) => (message.toolUses ?? []).some((use) => {
    const command = use.tool === 'Bash' ? String(use.input?.command ?? '') : '';
    return ghNames(command, 'edit|close') && [...ghSteps(command)].some(({ clause, detect }) => endsWork(clause, detect));
  }));
}

/**
 * The unfiled entries of a capture surface: lines that are not a heading, a
 * quote or blank; 0 for a file that is not there.
 * @param {string|null} text the file's text
 * @returns {number}
 */
export function unfiledCount(text) {
  return typeof text === 'string' ? rowsOf(text).filter((row) => !/^#|^>|^\s*$/.test(row)).length : 0;
}

// A porcelain line names code: a docs path is docs unless a code extension
// wins; `.workkit/` and the docs basenames are docs wherever they sit.
function namesCode(line) {
  let path = line.slice(3);
  if (path.includes(' -> ')) path = path.slice(path.lastIndexOf(' -> ') + 4);
  path = path.replace(/"$/, '').replace(/^"/, '');
  const base = path.split('/').filter(Boolean).pop() ?? '';
  if (path === '.workkit' || path.startsWith('.workkit/')) return false;
  if (/\.md$|^CHANGELOG$|^CHANGELOG\.|^LICENSE$|^LICENSE\./.test(base)) return false;
  return CODE_EXT.test(base) || !(path.startsWith('docs/') || path.includes('/docs/'));
}

/**
 * The block's reason when there is something to nag about (uncommitted code,
 * unfiled entries, or both), else null: the gather asks it before it reads
 * the diff, so a clean tree costs two reads.
 * @param {string} porcelain `git status --porcelain`'s output
 * @param {number} inbox INBOX.md's unfiled entries
 * @param {number} capture `.workkit/capture.md`'s unfiled entries
 * @returns {string|null}
 */
function nagReason(porcelain, inbox, capture) {
  const code = chomp(porcelain).split('\n').some((line) => line !== '' && namesCode(line));
  const unfiled = inbox > 0 || capture > 0;
  if (code && unfiled) return 'Change tracker: uncommitted code changes + unfiled entries detected.';
  if (code) return 'Change tracker: uncommitted code changes detected.';
  return unfiled ? 'Change tracker: unfiled entries detected.' : null;
}

/**
 * The change tracker's verdict on one Stop: the reason, the nag and the
 * fingerprint of what it nags about, or null when there is nothing new.
 * @param {object} facts `stopHookActive`; `porcelain` (`git status
 *   --porcelain`); `diff` (`git diff HEAD`, `git diff` with no HEAD);
 *   `untracked` (`[{ path, text }]`); `inbox` and `capture` (the unfiled
 *   counts); `previous` (the remembered fingerprint or null); `prompt` (the
 *   nag text); and for the lines after it `cwd`, `findings` (findings.file on),
 *   `board` (a PROGRESS.md left), `surfaces` (INBOX.md's then capture.md's text)
 * @returns {Promise<{block: string, context: string, fingerprint: string}|null>}
 */
export async function changeTrackerVerdict(facts) {
  const { stopHookActive, porcelain, diff, untracked, inbox, capture, previous, prompt } = facts;
  if (stopHookActive) return null;
  const block = nagReason(porcelain, inbox, capture);
  if (!block) return null;
  const sorted = [...untracked].sort((a, b) => (a.path < b.path ? -1 : Number(a.path > b.path)));
  const fingerprint = await sha1Hex(`${chomp(porcelain)}\n${diff}${sorted.map((f) => f.text).join('')}${facts.surfaces ?? ''}`);
  if (previous !== null && previous === fingerprint) return null;
  const lines = [chomp(prompt), facts.findings ? FINDINGS_ON : FINDINGS_OFF];
  if (facts.board) lines.push(BOARD);
  if (inbox > 0) {
    lines.push(`INBOX: ${inbox} unfiled entries in ${facts.cwd}/INBOX.md. Surface the count to the user and offer the workkit:triage skill. Filing stays deliberate: never empty the inbox as a side effect.`);
  }
  if (capture > 0) {
    lines.push(`SCRATCH: ${capture} unfiled entries in ${facts.cwd}/.workkit/capture.md. Surface the count and offer the workkit:triage skill. Filing stays deliberate: never drain the local capture file as a side effect.`);
  }
  return { block, context: lines.join('\n\n'), fingerprint };
}

// Each untracked file's text, `git ls-files` relative to the folder; an unreadable one is left out.
async function untrackedOf(io, cwd) {
  const listing = await io.run(['git', 'ls-files', '--others', '--exclude-standard', '-z'], { cwd });
  const paths = listing.exitCode === 0 ? listing.stdout.split('\0').filter(Boolean) : [];
  const files = await Promise.all(paths.map(async (path) => ({ path, text: await io.read(`${cwd}/${path}`) })));
  return files.filter((file) => file.text !== null);
}

// Whether this repo keeps the memory: a `.workkit/` folder that gitignores the
// state file, so it is never a file the repo would be asked to commit.
async function keepsMemory(io, cwd) {
  if ((await io.stat(`${cwd}/.workkit`))?.kind !== 'dir') return false;
  return (await io.run(['git', 'check-ignore', '-q', STATE_FILE], { cwd })).exitCode === 0;
}

/**
 * The change tracker's Stop: on an endpoint turn only, gathers the tree, asks
 * the verdict, writes the new fingerprint whole where the repo keeps the
 * memory, and answers the block carrying the reason and the nag.
 * @param {object} io the engine calls register.js hands over (`ioOf`), the turn through `messages()`
 * @param {object} env the variables the module read
 * @param {object} e the Stop event's input
 * @returns {Promise<{block: string}|null>}
 */
export async function changeTrackerGather(io, env, e) {
  const { cwd } = e;
  if (String(e.stop_hook_active) === 'true' || !cwd) return null;
  if (!endpointTurn(await io.messages())) return null;
  const git = (args) => io.run(['git', ...args], { cwd });
  if ((await git(['rev-parse', '--is-inside-work-tree'])).exitCode !== 0) return null;
  const [status, inboxText, captureText] = await Promise.all([
    git(['status', '--porcelain']), io.read(`${cwd}/INBOX.md`), io.read(`${cwd}/.workkit/capture.md`),
  ]);
  const porcelain = status.exitCode === 0 ? status.stdout : '';
  const [inbox, capture] = [unfiledCount(inboxText), unfiledCount(captureText)];
  if (!nagReason(porcelain, inbox, capture)) return null;
  const promptPath = `${io.pluginRoot}/${PROMPT}`;
  const prompt = await io.read(promptPath);
  // The prompt is the plugin's own file: missing is a broken install, never a built-in string.
  if (prompt === null) {
    io.log(`change-tracker: prompt missing at ${promptPath}`);
    return null;
  }
  const head = await git(['diff', 'HEAD']);
  const memory = await keepsMemory(io, cwd);
  const [diff, untracked, previous, board, layers] = await Promise.all([
    head.exitCode === 0 ? head.stdout : git(['diff']).then((r) => (r.exitCode === 0 ? r.stdout : '')),
    untrackedOf(io, cwd),
    memory ? io.read(`${cwd}/${STATE_FILE}`).then((text) => (text === null ? null : chomp(text))) : null,
    io.exists(`${cwd}/PROGRESS.md`),
    settingsLayers(cwd, env, io),
  ]);
  const verdict = await changeTrackerVerdict({
    stopHookActive: false, porcelain, diff, untracked, inbox, capture, previous, prompt,
    cwd, findings: findingsOn(...layers), board, surfaces: `${inboxText ?? ''}${captureText ?? ''}`,
  });
  if (!verdict) return null;
  if (memory) {
    if ((await io.stat(`${cwd}/.workkit/agents`))?.kind !== 'dir') await io.run(['mkdir', '-p', `${cwd}/.workkit/agents`]);
    await io.write(`${cwd}/${STATE_FILE}`, `${verdict.fingerprint}\n`);
  }
  return { block: `${verdict.block}\n\n${verdict.context}` };
}
