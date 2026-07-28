#!/usr/bin/env node
//
// The nightly payload — what the summaries step hands to Claude.
//
// The day's two records, gathered without reading either: an INDEX of the
// session transcripts that moved in the last 24 hours (path, size, mtime) and
// the commits that landed across the roster in the same window. The transcripts
// are named, never inlined — a day's sessions are far past any budget, so the
// model samples them itself with Read/Grep/Glob, newest first, and stops when it
// has enough. The index is what makes "newest first" possible at all.
//
// The roster it walks is the same `discoverRepos` the morning brief uses, so
// the two halves of the daily job agree about which repos are the owner's work.
//
// Pure gather: no writes, no Claude, no notification. `claude-nightly.sh` owns
// the sending AND owns writing the summary the model returns — this file never
// touches HQ.
//
// Usage:
//   node jobs/nightly-payload.js                    // the payload on stdout
//   composeNightly({ projectsRoot, root, exec })    // offline, against fixtures
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { discoverRepos } = require('../tower/api/lib/repos');

const WINDOW_HOURS = 24;
const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000;

// The reflection instruction. It names the payload's two sections, hands the
// model its own reading budget over the transcript index, and fixes the output
// EXACTLY: the response is not a report about a summary, it IS the summary, and
// claude-nightly.sh writes it to disk byte for byte.
const INSTRUCTION = `You are writing the owner's DAILY SUMMARY — a reflection on the day that just ended.

The payload below is JSON with two parts. \`transcripts\` is an INDEX of the
Claude Code session transcripts that changed in the last 24 hours, newest first,
each with its path, size in bytes, and modification time — the contents are NOT
here. \`commits\` is what landed in the owner's repos in the same window.

Read the day before you judge it:
- Sample the transcripts yourself with the Read, Grep, and Glob tools, working
  down the index from the newest.
- Skip any file larger than 10 MB — the cost of one is the cost of many smaller
  ones, and the smaller ones say more.
- A transcript is JSONL, one event per line; skimming and grepping beats reading
  a whole file end to end.
- Stop when the reading budget feels spent. A grounded summary from half the day
  beats a thin one from all of it.

Then output ONLY the finished daily summary as markdown, with EXACTLY these four
sections and no others:

## Went well
What worked — shipped work, decisions that held, friction that stayed away.

## Went poorly
What did not — rework, dead ends, things that took far longer than they should
have, repeated corrections.

## Improvements
Each bullet is ONE line, phrased as a candidate issue: what would change and
why, tight enough to file as-is. Nothing is filed from this document — a human
triages these — so write them to be read cold.

## Facts learned
Durable things now known that were not known this morning: how a tool actually
behaves, a constraint of the stack, a convention of a repo.

Ground every claim in something you read; write "no evidence in today's record"
rather than inventing one. No preamble, no closing remarks, no code fence around
the document itself.

--- DAY ---`;

const defaultExec = (cmd, args, opts = {}) => execFileSync(cmd, args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
  ...opts,
});

/**
 * The session transcripts that moved inside the window, newest first.
 *
 * One level down from the projects root, which is how Claude Code lays it out
 * (a directory per project, `.jsonl` files inside). An unreadable directory is
 * skipped rather than fatal — the day's record is still worth summarizing
 * without it.
 *
 * @param {object} [opts]
 * @param {string} [opts.projectsRoot] the transcripts root (default ~/.claude/projects)
 * @param {string} [opts.home] overrides ~ for the default root
 * @param {number} [opts.now] epoch ms the window ends at, injectable so the suite is not a clock test
 * @returns {Array<{path: string, bytes: number, modifiedAt: string}>}
 */
const transcriptIndex = (opts = {}) => {
  const home = opts.home || os.homedir();
  const root = opts.projectsRoot
    || process.env.WORKKIT_CLAUDE_PROJECTS
    || path.join(home, '.claude', 'projects');
  const now = opts.now === undefined ? Date.now() : opts.now;
  const cutoff = now - WINDOW_MS;

  let projects;
  try {
    projects = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const found = [];
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const dir = path.join(root, project.name);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const file = path.join(dir, entry.name);
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      if (stat.mtimeMs < cutoff) continue;
      found.push({ path: file, bytes: stat.size, modifiedAt: new Date(stat.mtimeMs).toISOString() });
    }
  }

  found.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : a.modifiedAt > b.modifiedAt ? -1 : 0));
  return found;
};

/**
 * Today's commits across the roster, one entry per repo that has any.
 *
 * A repo git cannot answer for is reported with its error rather than dropped:
 * a day with no commits and a day whose log could not be read are different
 * facts, and the model is told which it is looking at.
 *
 * @param {object} [opts]
 * @param {string} [opts.root] the Repositories root to walk
 * @param {string} [opts.workflowHome] the user's ~/.workkit
 * @param {string} [opts.home] overrides ~ for the libs that resolve it
 * @param {Function} [opts.exec] (cmd, args) => stdout — the git seam
 * @returns {Array<{repo: string, slug: string|null, path: string, commits: Array<{sha: string, subject: string}>, error?: string}>}
 */
const commitsToday = (opts = {}) => {
  const exec = opts.exec || defaultExec;

  let repos;
  try {
    repos = discoverRepos({
      root: opts.root,
      workflowHome: opts.workflowHome,
      home: opts.home,
      exec,
    });
  } catch {
    return [];
  }

  const out = [];
  for (const repo of repos) {
    const entry = { repo: repo.name, slug: repo.slug, path: repo.path, commits: [] };
    let log;
    try {
      log = exec('git', ['-C', repo.path, 'log', `--since=${WINDOW_HOURS} hours ago`, '--pretty=%h\t%s']);
    } catch (err) {
      out.push({ ...entry, error: `git log failed: ${err.message}` });
      continue;
    }
    for (const line of String(log).split('\n')) {
      if (line.trim() === '') continue;
      const tab = line.indexOf('\t');
      if (tab === -1) continue;
      entry.commits.push({ sha: line.slice(0, tab), subject: line.slice(tab + 1) });
    }
    if (entry.commits.length > 0) out.push(entry);
  }
  return out;
};

/**
 * The day, as the payload the reflection reads.
 *
 * `quiet` is the one field the runner acts on: no transcripts and no commits
 * means there was no day to summarize, and a summary invented from nothing is
 * worse than none.
 *
 * @param {object} [opts] every option passes through to the two gathers
 * @returns {object} the nightly payload
 */
const composeNightly = (opts = {}) => {
  const now = opts.now === undefined ? Date.now() : opts.now;
  const transcripts = transcriptIndex(opts);
  const commits = commitsToday(opts);

  return {
    generatedAt: opts.generatedAt || new Date(now).toISOString(),
    quiet: transcripts.length === 0 && commits.length === 0,
    window: { hours: WINDOW_HOURS, since: new Date(now - WINDOW_MS).toISOString() },
    transcripts,
    commits,
  };
};

/**
 * The instruction, then the payload as JSON a human could read over a shoulder.
 * @param {object} payload what composeNightly returned
 */
const render = (payload) => `${INSTRUCTION}\n\n${JSON.stringify(payload, null, 2)}\n`;

module.exports = { composeNightly, transcriptIndex, commitsToday, render, INSTRUCTION, WINDOW_HOURS };

if (require.main === module) {
  process.stdout.write(render(composeNightly()));
}
