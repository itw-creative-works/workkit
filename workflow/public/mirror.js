#!/usr/bin/env node
// `workkit public mirror <N>... | --all`: each named private issue carrying a
// `Public:` line hands its status label to the public issue, every other status
// label there removed, no comment posted. `--all` takes every open linked
// issue, reading each public repo once. A failed mirror is one warning line.
// Usage: node mirror.js <N>... | --all   (run inside the private repo)

const {
  PublicError, runGh, ghJson, ghWrite, outLine, warnLine, pairing, publicLink, statusLabels, issueNumbers, main,
} = require('./lib');

const USAGE = 'usage: workkit public mirror <N>... | --all';

/**
 * Every issue's status labels in each public repo the issues link to, one
 * list call per repo.
 * @param {Array<{body: string}>} issues linked private issues
 * @param {function} gh the runner
 * @param {string} root the private repo's root
 * @returns {Map<string, string[]>} `<repo>#<number>` to its status labels
 */
const publicStatuses = (issues, gh, root) => {
  const known = new Map();
  for (const repo of new Set(issues.map((i) => publicLink(i.body).repo))) {
    const list = ghJson(gh, ['issue', 'list', '--repo', repo, '--state', 'all', '--limit', '1000', '--json', 'number,labels'], root);
    for (const pub of list) known.set(`${repo}#${pub.number}`, statusLabels(pub.labels));
  }
  return known;
};

/**
 * One private issue's status onto its public issue: a line when it changed
 * anything, null when there was nothing to do.
 * @param {{number: number|string, body: string, labels: Array<{name: string}>}} issue the private issue
 * @param {function} gh the runner
 * @param {string} root the private repo's root
 * @param {Map<string, string[]>} [known] public status labels already read; a miss reads the issue
 * @returns {string|null}
 */
const mirrorOne = (issue, gh, root, known = new Map()) => {
  const link = publicLink(issue.body);
  const [want] = statusLabels(issue.labels);
  if (!link || !want) return null;
  const have = known.get(`${link.repo}#${link.number}`)
    ?? statusLabels(ghJson(gh, ['issue', 'view', link.number, '--repo', link.repo, '--json', 'labels'], root).labels);
  if (have.length === 1 && have[0] === want) return null;
  const others = have.filter((name) => name !== want);
  ghWrite(gh, ['issue', 'edit', link.number, '--repo', link.repo,
    ...(have.includes(want) ? [] : ['--add-label', want]),
    ...(others.length ? ['--remove-label', others.join(',')] : [])], root);
  return `public: ${link.repo}#${link.number} now carries ${want}`;
};

/**
 * Mirrors the named issues, or every open linked one.
 * @param {{args?: string[], cwd?: string, gh?: function, out?: function, warn?: function}} [opts]
 * @returns {number} 0, or 1 when any mirror failed
 */
const mirror = ({
  args = process.argv.slice(2), cwd = process.cwd(), gh = runGh,
  out = outLine, warn = warnLine,
} = {}) => {
  const all = args.length === 1 && args[0] === '--all';
  if (!all && args.length === 0) throw new PublicError(USAGE);
  const numbers = all ? [] : issueNumbers(args);
  const pair = pairing(cwd);
  if (!pair) return 0;
  const { root } = pair;
  const issues = all
    ? ghJson(gh, ['issue', 'list', '--state', 'open', '--limit', '1000', '--json', 'number,body,labels'], root)
      .filter((i) => publicLink(i.body))
    : numbers.map((n) => ({ number: n }));
  const known = all ? publicStatuses(issues, gh, root) : new Map();
  let failed = 0;
  for (const issue of issues) {
    try {
      const read = issue.body === undefined
        ? { ...ghJson(gh, ['issue', 'view', String(issue.number), '--json', 'body,labels'], root), number: issue.number }
        : issue;
      const said = mirrorOne(read, gh, root, known);
      if (said) out(said);
    } catch (err) {
      if (!(err instanceof PublicError)) throw err;
      warn(`public: the status of #${issue.number} did not reach its public issue: ${err.message}`);
      failed += 1;
    }
  }
  return failed > 0 ? 1 : 0;
};

module.exports = { mirror, mirrorOne };

if (require.main === module) main(() => mirror());
