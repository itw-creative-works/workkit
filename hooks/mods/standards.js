/**
 * hooks/mods/standards.js: workflow:standards' report at session start: the
 * setup pester above every gate, then a broken install, the offer to an
 * undecided repo, or what the daily heal and `workkit update --auto` did
 * (docs/hooks.md § workflow:standards).
 */

import { settingsOptedIn } from './gate.js';
import { homeOf, pad } from './log.js';
import { parseJson } from './settings.js';
import { LONG_RUN_MS } from './suite.js';

const ANSI = /\x1b\[[0-9;]*m/g;

const localDay = (ms) => {
  const at = new Date(ms);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
};

/**
 * The engine's report lines: colors stripped, only the lines opening with its
 * ✓ or ⚠ kept (a child tool's stderr never reads as an action), indent and
 * glyph dropped.
 * @param {string} text what the engine printed
 * @returns {string}
 */
function engineLines(text) {
  return String(text ?? '').replace(ANSI, '').split('\n')
    .filter((line) => /^\s*(✓|⚠) /.test(line))
    .map((line) => line.replace(/^ *(✓|·|›|⚠|✖|⏳) /, ''))
    .join('\n');
}

const outputOf = (result) => `${result.stdout ?? ''}${result.stderr ?? ''}`;

// A cloud session gets its own form of setup, the one that asks nothing.
const setupLine = (state) => {
  const where = state.isInCache ? ' (the engine in the plugin cache)' : '';
  if (state.isCloud) {
    return `SETUP: workkit is not set up in this cloud session (${state.cliLink} is missing). The workkit command is absent until it is. Run \`bash ${state.engine}/workkit.sh setup --cloud\` yourself${where} before other work, and hand the user only what it prints for them to do.`;
  }
  return `SETUP: workkit is not set up on this machine (${state.cliLink} is missing). The daily brief, the home repo, and the workkit command are all absent until it is. Run \`bash ${state.engine}/workkit.sh setup\` yourself${where} before other work, and hand the user only what it prints for them to do.`;
};

// The heal's report: a failure is worth a session's attention even when it
// printed no line of its own, since that is the half-finished case.
const healReport = (root, heal, update) => {
  let msg = '';
  if (heal) {
    const actions = engineLines(outputOf(heal));
    if (heal.exitCode !== 0) {
      const tail = outputOf(heal).replace(ANSI, '').replace(/\n+$/, '').split('\n').slice(-3).join('\n');
      msg = `workflow standards did not finish in ${root} (exit ${heal.exitCode}). It will retry next session:\n${actions || tail}`;
    } else if (actions) {
      msg = `workflow standards healed ${root}:\n${actions}`;
    }
  }
  const upkeep = update ? engineLines(outputOf(update)) : '';
  if (!upkeep) return msg;
  return msg ? `${msg}\n\n${upkeep}` : `workkit upkeep:\n${upkeep}`;
};

/**
 * The session-start report, or null when there is nothing to say.
 * @param {object} state what the hook found before any heal ran: `isSetUp`,
 *   `cliLink` (the CLI link setup makes), `engine` (its physical path),
 *   `isInCache`, `isCloud` (CLAUDE_CODE_REMOTE is true), `root` (null outside
 *   a repo), `broken` (a broken install's line, for a repo that said yes) and
 *   `offer` (the engine's `--announce` text for an undecided repo)
 * @param {object|null} healResult the heal's `{ exitCode, stdout, stderr }`,
 *   null when none ran today, so a result means an enabled repo
 * @param {object|null} updateResult `workkit update --auto`'s, null when none ran
 * @returns {string|null}
 */
export function standardsContext(state, healResult, updateResult) {
  const msg = state.broken || state.offer || healReport(state.root, healResult, updateResult);
  const pester = state.isSetUp ? '' : setupLine(state);
  const ctx = [pester, msg].filter(Boolean).join('\n\n');
  return ctx || null;
}

// Whether the engine is the workkit plugin's copy in Claude's plugin cache.
async function inPluginCache(io, env, engine) {
  const [kit, claudeHome] = await Promise.all([
    io.real(`${engine}/..`), io.real(env.WORKFLOW_CLAUDE_HOME || `${homeOf(env)}/.claude`),
  ]);
  if (!kit || !claudeHome || !kit.startsWith(`${claudeHome}/plugins/cache/`)) return false;
  return parseJson(await io.read(`${kit}/.claude-plugin/plugin.json`))?.name === 'workkit';
}

/**
 * The hook: the setup state, the participation the engine reports, then the
 * day's heal and upkeep, once per repo per day; the report returned.
 * @param {object} io the engine calls as plain functions: `top(cwd)`,
 *   `read(path)`, `exists(path)`, `real(path)` (the physical path, null when
 *   absent), `run(argv, init)`, `write(path, text)`, `sha1(text)`, `now()`;
 *   and `pluginRoot`, the plugin's folder
 * @param {object} env the variables the module read
 * @param {object} e the SessionStart input, for its `cwd`
 * @returns {Promise<string|null>}
 */
export async function standardsGather(io, env, e) {
  const engine = env.WORKFLOW_DIR || `${io.pluginRoot}/workflow`;
  const cliLink = `${homeOf(env)}/.local/bin/workkit`;
  const isSetUp = await io.exists(cliLink);
  const state = {
    isSetUp, cliLink, engine, isInCache: false, isCloud: env.CLAUDE_CODE_REMOTE === 'true', root: null, broken: null, offer: '',
  };
  if (!isSetUp) {
    state.engine = (await io.real(engine)) ?? engine;
    state.isInCache = await inPluginCache(io, env, engine);
  }
  state.root = await io.top(e.cwd);
  const { root } = state;
  if (!root) return standardsContext(state, null, null);
  const standards = `${engine}/standards.sh`;
  const manifest = `${engine}/labels.json`;
  // A broken install speaks once, only for a repo that said yes.
  let broken = null;
  if (!(await io.exists(standards))) broken = `workflow engine not found at ${standards}. Reinstall the workkit plugin.`;
  else if ((await io.read(manifest)) === null) broken = `workflow manifest missing or unreadable at ${manifest}. Reinstall the workkit plugin.`;
  if (broken) {
    state.broken = settingsOptedIn(await io.read(`${root}/.workkit/settings.json`)) ? broken : null;
    return standardsContext(state, null, null);
  }
  // The engine owns the participation states; its answer is stdout's last line.
  const asked = await io.run(['bash', standards, '--state', root]);
  const participation = asked.exitCode === 0 ? asked.stdout.trimEnd().split('\n').pop() : 'nogit';
  if (participation === 'undecided') {
    state.offer = (await io.run(['bash', standards, '--announce', root])).stdout.trimEnd();
  }
  if (participation !== 'enabled') return standardsContext(state, null, null);
  const marker = `${env.WORKFLOW_STANDARDS_CACHE || `${homeOf(env)}/.claude/logs/workflow-standards`}/${await io.sha1(root)}`;
  const today = localDay(await io.now());
  if ((await io.read(marker)) === today) return standardsContext(state, null, null);
  // Only a clean heal caches the day, so a partial one retries next session.
  const heal = await io.run(['bash', standards, root], { env: { QUIET: '1' }, timeoutMs: LONG_RUN_MS });
  if (heal.exitCode === 0) await io.write(marker, today);
  const cli = `${engine}/workkit.sh`;
  const update = (await io.exists(cli)) ? await io.run(['bash', cli, 'update', '--auto'], { timeoutMs: LONG_RUN_MS }) : null;
  return standardsContext(state, heal, update);
}
