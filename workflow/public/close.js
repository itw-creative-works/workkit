#!/usr/bin/env node
// `workkit public close <version> <N>...`: each named private issue carrying a
// `Public:` line closes its public issue with the close comment, the issue's
// CHANGELOG entry as the summary. One already closed is a quiet skip, entry or not.
// Usage: node close.js <version> <N>...   (run inside the private repo)

const fs = require('fs');
const path = require('path');
const { META_RE, ISSUE_LINK_RE, parseEntries } = require('../changelog/changelog');
const { isSemver } = require('../ship/semver');
const {
  PublicError, runGh, ghJson, ghWrite, outLine, warnLine, pairing, publicLink, issueNumbers, main,
} = require('./lib');

const USAGE = 'usage: workkit public close <version> <N>...';

/** The close comment, worded as ruled. */
const closeComment = (version, summary) => `Fixed in v${version}: ${summary.replace(/[.\s]+$/, '')}. Thanks for reporting it.`;

/**
 * The text of issue N's CHANGELOG entry, its links and attribution off: the
 * entry in the version's section first, else the first entry naming N.
 * @param {string} text the CHANGELOG
 * @param {string} n the issue number
 * @param {string} version the version shipped
 * @returns {string|null}
 */
const entrySummary = (text, n, version) => {
  const mine = parseEntries(text).filter((e) => ISSUE_LINK_RE.exec(e.prose)?.[1] === n && e.prose.startsWith('[#'));
  const entry = mine.find((e) => e.section === version) || mine[0];
  return entry ? entry.prose.replace(META_RE, '').replace(/^\s*-\s+/, '').trim() || null : null;
};

// Whether gh says the public issue is closed already; an unread state is not
// closed, since the close that follows fails the same way when gh is down.
const publicClosed = (gh, link, root) => {
  try {
    return String(ghJson(gh, ['issue', 'view', link.number, '--repo', link.repo, '--json', 'state'], root).state).toUpperCase() === 'CLOSED';
  } catch (err) {
    if (!(err instanceof PublicError)) throw err;
    return false;
  }
};

/**
 * Closes the public issue of each named private issue.
 * @param {{args?: string[], cwd?: string, gh?: function, out?: function, warn?: function}} [opts]
 * @returns {number} 0, or 1 when any close failed
 */
const close = ({
  args = process.argv.slice(2), cwd = process.cwd(), gh = runGh,
  out = outLine, warn = warnLine,
} = {}) => {
  const [given, ...rest] = args;
  const version = String(given || '').replace(/^v/, '');
  if (!isSemver(version) || rest.length === 0) throw new PublicError(USAGE);
  const numbers = issueNumbers(rest);
  const pair = pairing(cwd);
  if (!pair) return 0;
  const { root } = pair;
  const file = path.join(root, 'CHANGELOG.md');
  const changelog = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  let failed = 0;
  for (const n of numbers) {
    try {
      const link = publicLink(ghJson(gh, ['issue', 'view', n, '--json', 'body'], root).body);
      if (!link || publicClosed(gh, link, root)) continue;
      const summary = entrySummary(changelog, n, version);
      if (!summary) throw new PublicError(`no CHANGELOG entry links #${n}`);
      ghWrite(gh, ['issue', 'close', link.number, '--repo', link.repo, '--comment', closeComment(version, summary)], root);
      out(`public: closed ${link.repo}#${link.number}, fixed in v${version}`);
    } catch (err) {
      if (!(err instanceof PublicError)) throw err;
      warn(`public: the public issue of #${n} was not closed: ${err.message}`);
      failed += 1;
    }
  }
  return failed > 0 ? 1 : 0;
};

module.exports = { close, closeComment, entrySummary };

if (require.main === module) main(() => close());
