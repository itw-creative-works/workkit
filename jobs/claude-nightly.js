#!/usr/bin/env node
/**
 * jobs/claude-nightly.js: the summaries step, the first of the 9am job: writes
 * up the day that just ended and publishes it as a Discussion on the home repo
 * (a Sunday adds the week, the 1st the month, read back from the API). Every
 * reason not to publish is one logged line and exit 0 (jobs/README.md § The summaries step).
 * Usage: node jobs/claude-nightly.js [--now]   (the manual trigger, `npm run nightly`)
 * Log: ~/Library/Logs/claude-nightly.log, appended, one timestamped block per note.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { lastLines } = require('../workflow/lib/attach');
const { today } = require('../workflow/lib/day');
const { codeOf } = require('../workflow/lib/detach');
const {
  CATEGORIES, ready, list, create, resolveCategory,
} = require('../workflow/lib/discussions');
const { holdSignals, Interrupted } = require('../workflow/lib/interrupt');
const { withScratch } = require('../workflow/lib/scratch');
const { homeSlug } = require('../workflow/lib/settings');
const { spin } = require('../workflow/lib/spin');
const { userDir } = require('../workflow/user-dir');
const { enterMachine, machineHome, projectsRoot } = require('./lib/machine');
const { fileNotes, logStamp } = require('./lib/notes');

const PAYLOAD = path.join(__dirname, 'claude-nightly', 'nightly-payload.js');

// How many of the send's last stderr lines its warning carries.
const STDERR_LINES = 20;

/** The step's log, under the home the shell's `$HOME` names. */
const logFile = () => path.join(machineHome(), 'Library', 'Logs', 'claude-nightly.log');

/** The transcripts root the payload indexes, so the send's grant names the same one. */
const transcriptsRoot = () => process.env.WORKKIT_CLAUDE_PROJECTS || projectsRoot(machineHome());

/**
 * The cadences due on <now>: daily always, weekly on a Sunday, monthly on the 1st.
 * @param {Date} now
 * @returns {string[]}
 */
const cadencesOn = (now) => {
  const due = ['daily'];
  if (now.getDay() === 0) due.push('weekly');
  if (now.getDate() === 1) due.push('monthly');
  return due;
};

/**
 * The category a cadence publishes in: its name, capitalized, of the four setup checks for.
 * @param {string} cadence
 * @returns {string}
 */
const categoryOf = (cadence) => CATEGORIES.find((name) => name.toLowerCase() === cadence);

// The category a rollup reads the daily summaries back from.
const DAILY_CATEGORY = categoryOf('daily');

/**
 * Where a rollup's window opens: 7 days (weekly) or 1 month (monthly) before
 * <now>'s local date, at `00:00:00Z` of that date. A day the month before lacks
 * is that month's last, as `date -v-1m` reads it.
 * @param {string} cadence 'weekly' or 'monthly'
 * @param {Date} now
 * @returns {string}
 */
const sinceOf = (cadence, now) => {
  const [year, month, day] = [now.getFullYear(), now.getMonth(), now.getDate()];
  const opens = cadence === 'weekly'
    ? new Date(year, month, day - 7)
    : new Date(year, month - 1, Math.min(day, new Date(year, month, 0).getDate()));
  return `${today(opens)}T00:00:00Z`;
};

/**
 * <cmd> run to its end in the work folder under the run's signal hold, so an
 * end signal reaches it and stops the run: the file <from> on stdin when
 * given, stdout into the file <out>, stderr into the file <err> or dropped.
 * @returns {Promise<number>} its code as the shell's `$?` reads it, startFailed for one that never started
 */
const runInto = async (run, cmd, args, { out, err, from }) => {
  const fds = [[from, 'r'], [out, 'w'], [err, 'w']].map(([file, mode]) => (file ? fs.openSync(file, mode) : 'ignore'));
  try {
    const res = await run.hold.run(cmd, args, { stdio: fds, windowsHide: true });
    return codeOf(res);
  } finally {
    for (const fd of fds) if (fd !== 'ignore') fs.closeSync(fd);
  }
};

/** Whether the post titled `<cadence>: <date>` is already in its category, read since that date opened. */
const alreadyPublished = async (run, cadence) => {
  const posted = await list(run.slug, categoryOf(cadence), `${run.date}T00:00:00Z`);
  return posted !== null && posted.some((post) => post.title === `${cadence}: ${run.date}`);
};

/**
 * The payload of <cadence> composed into its file: the day's for daily, else
 * the rollup over the daily summaries already published. Nothing to roll up
 * is a quiet period, not a failure.
 * @returns {Promise<string|null>} the payload's text, null when the cadence ends here
 */
const compose = async (run, cadence) => {
  const out = path.join(run.work, `${cadence}-payload.txt`);
  let status;
  if (cadence === 'daily') {
    status = await runInto(run, process.execPath, [PAYLOAD], { out });
  } else {
    const since = sinceOf(cadence, run.now);
    const prior = await list(run.slug, DAILY_CATEGORY, since);
    if (prior === null || prior.length === 0) {
      run.notes.noteSkip(`summaries: no daily summaries published since ${since}; the ${cadence} rollup has nothing to roll up`);
      return null;
    }
    const from = path.join(run.work, `${cadence}-prior.json`);
    fs.writeFileSync(from, JSON.stringify(prior));
    status = await runInto(run, process.execPath, [PAYLOAD, '--cadence', cadence], { out, from });
  }
  if (status !== 0) {
    run.notes.noteWarn(`summaries: the ${cadence} payload could not be composed (exit ${status}); skipped`);
    return null;
  }
  return fs.readFileSync(out, 'utf8');
};

/**
 * Claude's summary of <payload>, written into its file: three read tools on
 * the root the payload indexed. stderr goes to its own file and on to the log,
 * never the body; the payload goes as `$(cat …)` hands it, trailing newlines dropped.
 * @returns {Promise<string|null>} the summary's file, null when none was written
 */
const send = async (run, cadence, payload) => {
  const summary = path.join(run.work, `${cadence}-summary.md`);
  const err = path.join(run.work, `${cadence}-stderr.log`);
  const args = [
    '-p', payload.replace(/\n+$/, ''),
    '--model', 'sonnet',
    '--safe-mode',
    '--no-session-persistence',
    '--tools', 'Read,Grep,Glob',
    '--add-dir', transcriptsRoot(),
    '--max-budget-usd', '1.00',
  ];
  const status = await spin(`asking Claude for the ${cadence} summary`, () => runInto(run, 'claude', args, { out: summary, err }));
  const said = fs.readFileSync(err);
  if (said.length > 0) {
    run.notes.noteWarn(`summaries: the ${cadence} send wrote to stderr:${`\n${lastLines(said, STDERR_LINES)}`.replace(/\n+$/, '')}`);
  }
  if (status !== 0 || fs.statSync(summary).size === 0) {
    run.notes.noteWarn(`summaries: the ${cadence} summary was not written (exit ${status}); skipped`);
    return null;
  }
  return summary;
};

/** The summary in <file> posted in <cadence>'s category, or the fallback it resolved to, said so. */
const post = async (run, cadence, file) => {
  const category = categoryOf(cadence);
  const found = await resolveCategory(run.slug, category);
  if (found === null) {
    run.notes.noteWarn(`summaries: ${run.slug} has no discussion category to publish the ${cadence} summary in; skipped, and nothing was written to disk`);
    return;
  }
  const url = await create(run.slug, found.id, `${cadence}: ${run.date}`, file);
  if (!url) {
    run.notes.noteWarn(`summaries: the ${cadence} summary could not be posted to ${run.slug}; skipped, and nothing was written to disk`);
    return;
  }
  if (found.fellBack) {
    run.notes.note(`summaries: posted the ${cadence} summary in ${found.name} (the ${category} category does not exist; GitHub has no API that creates one) → ${url}`);
  } else {
    run.notes.note(`summaries: posted the ${cadence} summary → ${url}`);
  }
};

/**
 * One cadence: the two guards a scheduled run keeps (already published, a
 * quiet period), then the payload, the summary and the post. Every failure is
 * one logged line.
 */
const publishCadence = async (run, cadence) => {
  if (!run.manual && await alreadyPublished(run, cadence)) {
    run.notes.noteSkip(`summaries: ${run.slug} already carries the ${cadence} summary for ${run.date}; nothing posted`);
    return;
  }
  const payload = await compose(run, cadence);
  if (payload === null) return;
  if (!run.manual && payload.includes('"quiet": true')) {
    run.notes.noteSkip(`summaries: a quiet day; nothing happened in the window, so no ${cadence} summary was composed or posted`);
    return;
  }
  const file = await send(run, cadence, payload);
  if (file !== null) await post(run, cadence, file);
};

/**
 * The step at <now> in the work folder <work>: the home repo and `gh` first,
 * then each cadence due, until an end signal the hold caught.
 */
const summarize = async (now, manual, work, hold) => {
  const notes = fileNotes(logFile(), logStamp(now, manual));
  const slug = homeSlug(userDir()) ?? '';
  if (!slug) {
    notes.noteSkip('summaries: no home repo configured; skipped');
    return;
  }
  if (!(await ready())) {
    notes.noteSkip(`summaries: ${slug} is the home repo, but gh is what reaches it; skipped`);
    return;
  }
  const run = {
    slug, date: today(now), now, manual, work, notes, hold,
  };
  for (const cadence of cadencesOn(now)) {
    if (await hold.interrupted()) return;
    await publishCadence(run, cadence);
  }
};

/**
 * The program: the clock read once, then the step from an empty scratch
 * folder, entered before anything reaches the network: under launchd the cwd
 * is /, and Claude Code's startup scan from there trips macOS privacy prompts.
 * An end signal stops the step; the folder still goes, then the signal ends
 * the process.
 * @param {string[]} args `--now` bypasses the two guards and stamps `(manual)`
 * @returns {Promise<number>} always 0
 */
const main = async (args) => {
  const now = new Date();
  enterMachine();
  const hold = holdSignals();
  try {
    const done = await withScratch(async (work) => {
      process.chdir(work);
      try {
        await summarize(now, args[0] === '--now', work, hold);
      } finally {
        process.chdir(os.tmpdir());
      }
      return true;
    }, 'claude-nightly.');
    if (done === null) throw new Error(`summaries: no scratch folder could be made in ${os.tmpdir()}`);
  } catch (err) {
    if (!(err instanceof Interrupted)) throw err;
  } finally {
    await hold.end();
  }
  return 0;
};

if (require.main === module) {
  // A code the hold's end set for a signal (Windows) stays.
  main(process.argv.slice(2)).then((code) => { process.exitCode ??= code; });
}

module.exports = {
  main, cadencesOn, categoryOf, sinceOf,
};
