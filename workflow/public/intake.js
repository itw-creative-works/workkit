#!/usr/bin/env node
// `workkit public intake`: each open issue on the paired public repo with no
// status label becomes a private status:inbox, type:idea issue carrying the
// `Public:` line and the quoted report, or finds the one a broken run made; the
// public issue gets the intake comment, then status:inbox. One line per issue.
// Usage: node intake.js   (run inside the private repo)

const {
  STATUS, PublicError, runGh, ghJson, ghWrite, outLine, warnLine, pairing, publicLink, linkLine, statusLabels, main,
} = require('./lib');

const INBOX = `${STATUS}inbox`;
// Every capture's labels: triage retypes it.
const CAPTURED = `${INBOX},type:idea`;
const ISSUE_URL = /https:\/\/\S+\/issues\/[0-9]+/;

/** The intake comment, worded as ruled: it never names the private repo. */
const INTAKE_COMMENT = "Thanks for the report. We're tracking this internally. This issue stays open and its label shows where the work is.";

/**
 * The private issue's body: the link line, then the report quoted whole.
 * @param {{url: string, title: string, body: string, author: {login: string}}} issue the public issue
 * @param {string} repo the public slug
 * @returns {string}
 */
const intakeBody = (issue, repo) => {
  const quoted = [`**${issue.title}**`, '', ...String(issue.body || '').replace(/\r\n/g, '\n').split('\n')]
    .map((line) => (line ? `> ${line}` : '>')).join('\n');
  return [
    linkLine(issue.url),
    '',
    '## Description',
    '',
    `Reported by @${issue.author?.login || 'unknown'} on ${repo}#${issue.number}:`,
    '',
    quoted,
    '',
    '## Spec',
    '',
    'None yet.',
    '',
  ].join('\n');
};

// An issue the intake takes: open and no status label.
const untaken = (issue) => statusLabels(issue.labels).length === 0;

/**
 * The private issue already linked to each public URL, open or closed, so a
 * run that stopped after the create finishes the public side instead of filing twice.
 * @returns {Map<string, string>} the public URL to the private issue's URL
 */
const linkedIssues = (gh, root) => new Map(ghJson(gh, ['issue', 'list', '--state', 'all', '--limit', '1000',
  '--json', 'body,url'], root).map((i) => [publicLink(i.body)?.url, i.url]).filter(([url]) => url));

// Whether the public issue already carries the intake comment.
const commented = (gh, repo, n, root) => ghJson(gh, ['issue', 'view', n, '--repo', repo, '--json', 'comments'], root)
  .comments.some((c) => String(c.body).trim() === INTAKE_COMMENT);

/**
 * Takes in every untaken public issue.
 * @param {{cwd?: string, gh?: function, out?: function, warn?: function}} [opts]
 * @returns {number} 0, or 1 when any issue could not be taken in
 */
const intake = ({
  cwd = process.cwd(), gh = runGh, out = outLine, warn = warnLine,
} = {}) => {
  const pair = pairing(cwd);
  if (!pair) return 0;
  const { root, repo } = pair;
  const issues = ghJson(gh, ['issue', 'list', '--repo', repo, '--state', 'open', '--limit', '1000',
    '--json', 'number,title,body,author,labels,url'], root).filter(untaken);
  if (issues.length === 0) {
    out(`public: nothing new on ${repo}`);
    return 0;
  }
  const linked = linkedIssues(gh, root);
  let failed = 0;
  for (const issue of issues) {
    try {
      const n = String(issue.number);
      let privateUrl = linked.get(issue.url);
      const resumed = Boolean(privateUrl);
      if (!resumed) {
        const made = ghWrite(gh, ['issue', 'create', '--title', issue.title, '--body', intakeBody(issue, repo), '--label', CAPTURED], root);
        privateUrl = (made.match(ISSUE_URL) || [])[0];
        if (!privateUrl) throw new PublicError(`gh issue create printed no issue URL for ${repo}#${issue.number}`);
      }
      // The label marks the issue taken, so it goes on last: a refused comment is retried next run.
      if (!resumed || !commented(gh, repo, n, root)) {
        ghWrite(gh, ['issue', 'comment', n, '--repo', repo, '--body', INTAKE_COMMENT], root);
      }
      ghWrite(gh, ['issue', 'edit', n, '--repo', repo, '--add-label', INBOX], root);
      out(`public: took in ${repo}#${n} as ${privateUrl}: ${issue.title}`);
    } catch (err) {
      if (!(err instanceof PublicError)) throw err;
      warn(`public: ${repo}#${issue.number} was not fully taken in: ${err.message}`);
      failed += 1;
    }
  }
  return failed > 0 ? 1 : 0;
};

module.exports = { intake, intakeBody, INTAKE_COMMENT };

if (require.main === module) main(() => intake());
