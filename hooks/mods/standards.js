/**
 * hooks/mods/standards.js: workflow:standards' report at session start: the
 * setup pester above every gate, then a broken install, the offer to an
 * undecided repo, or what the daily heal and `workkit update --auto` did
 * (docs/hooks.md § workflow:standards).
 */

const ANSI = /\x1b\[[0-9;]*m/g;

/**
 * The engine's report lines: colors stripped, only the lines opening with its
 * ✓ or ⚠ kept (a child tool's stderr never reads as an action), indent and
 * glyph dropped.
 * @param {string} text what the engine printed
 * @returns {string}
 */
export function engineLines(text) {
  return String(text ?? '').replace(ANSI, '').split('\n')
    .filter((line) => /^\s*(✓|⚠) /.test(line))
    .map((line) => line.replace(/^ *(✓|·|›|⚠|✖|⏳) /, ''))
    .join('\n');
}

const outputOf = (result) => `${result.stdout ?? ''}${result.stderr ?? ''}`;

const setupLine = (state) => {
  const where = state.isInCache ? ' (the engine in the plugin cache)' : '';
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
 *   `isInCache`, `root` (null outside a repo), `broken` (a broken install's
 *   line, for a repo that said yes) and `offer` (the engine's `--announce`
 *   text for an undecided repo)
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
