/**
 * hooks/mods/commit-attribution.js: safety:commit-attribution, the Claude
 * attribution line a repo turns off with `commit.attribution` false, judged in
 * git's commit-msg hook on the message git commits (workflow/githooks/judge.js,
 * docs/hooks.md § safety:commit-attribution).
 */

// A co-author named Claude (its first word), or one at an anthropic.com address.
const ATTRIBUTION = [
  /^[ \t]*co-authored-by:[ \t]*(claude\b|.*anthropic\.com)/i,
  /generated with \[?claude code\]?/i,
];

/**
 * commit-attribution's verdict on a commit's message: the first line carrying
 * a Claude co-author trailer or the Claude Code footer, as a deny, or null.
 * The caller asks only while the setting is off (attributionOff).
 * @param {string} message the text git commits
 * @returns {{deny: string}|null}
 */
export function commitAttributionVerdict(message) {
  const line = message.split('\n').find((text) => ATTRIBUTION.some((re) => re.test(text)));
  if (line === undefined) return null;
  return { deny: `commit-attribution: BLOCKED this commit: the message carries a Claude attribution line, and this repo turns attribution off (commit.attribution is false): ${line.trim()}\nRemove the line from the message and commit again.` };
}
