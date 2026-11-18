#!/usr/bin/env node
/* eslint-disable no-console */
// workflow/ship/watch.js: `workkit ship watch <sha>`, the ship's CI watch, a pushed
// sha in and one answer out. Exit 0 green (or no CI for push), 1 red, 2 usage or a
// sha this clone does not know, 3 not queued yet, 4 gh failed or the watch did not
// finish, 5 a watch already running, 130 interrupted; the lines and the log:
// `workflow/README.md`, the ship/watch.js row. The foreground runs this file as
// `--watch-body <sha>`, detached, and tails its log.

const fs = require('fs');
const path = require('path');
const { setTimeout: sleep } = require('timers/promises');
const { spawn, spawnSync } = require('../lib/run');
const { repoRoot, headSha } = require('../lib/git');
const { readOrNull } = require('../lib/read');
const { exitOf } = require('../lib/detach');
const { lastLines } = require('../lib/attach');
const { run } = require('../lib/runs');
const { bodyEnd } = require('../lib/body');
const { runPaths, LogsDirError } = require('../lib/run-paths');
const { sayAs } = require('../lib/say');
const { listensTo } = require('./triggers');
const { parseJson, isPlain } = require('../../hooks/mods/settings.js');

const USAGE = [
  'usage: workkit ship watch <sha>',
  '  finds the runs for a pushed sha, watches every one, and says green or red',
].join('\n');

const BODY = '--watch-body';
const WATCHING = 'ci-watch: watching ';

// The lines of a red run's failed log a red answer prints.
const LOG_TAIL = 40;

// How long a refusal waits for a running watch's first line, in reads 100ms apart.
const SHA_READS = 20;
const SHA_READ_MS = 100;

const say = sayAs('ci-watch');

/** The body's end with its code, its line said already. */
class Done extends Error {
  constructor(code) {
    super(`ci-watch: exit ${code}`);
    this.name = 'Done';
    this.code = code;
  }
}

/** One line on stderr, then the body's end with <code>. */
const stop = (code, line) => {
  say(line);
  throw new Done(code);
};

/** The repo's root, or the folder the call was made in outside a repo. */
const rootHere = () => repoRoot(process.cwd()) ?? fs.realpathSync(process.cwd());

const firstLine = (text) => text.split('\n')[0];

/** Whether a list element reads as jq reads a row: an object, or null. */
const isRow = (value) => value === null || isPlain(value);

/** A field as jq -r prints it: nothing for null, false or none. */
const textOf = (value) => (value === null || value === undefined || value === false ? '' : String(value));

/** `gh <args>`, its stdin closed: its code, stdout and stderr as text. */
const gh = (args) => new Promise((resolve) => {
  const child = spawn('gh', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const out = [];
  const err = [];
  // A launch run.js refused comes back with no streams, only its error.
  child.stdout?.on('data', (chunk) => out.push(chunk));
  child.stderr?.on('data', (chunk) => err.push(chunk));
  let settled = false;
  const settle = (code, extra = '') => {
    if (settled) return;
    settled = true;
    resolve({ code, out: Buffer.concat(out).toString(), err: `${Buffer.concat(err).toString()}${extra}` });
  };
  child.on('error', (error) => settle(127, `${error.message}\n`));
  child.on('close', (code, signal) => settle(exitOf(code, signal)));
});

/**
 * The body's steps over one sha: each gh call, and each wait between tries,
 * ends the body once a signal came, so nothing starts after it.
 */
const stepsOf = (sha, aborted) => {
  const root = rootHere();
  const tries = Number(process.env.WORKKIT_CI_WATCH_TRIES || 6);
  const wait = Number(process.env.WORKKIT_CI_WATCH_WAIT || 10);
  const halted = () => {
    if (aborted.aborted) throw new Done(1);
  };
  const ask = async (args) => {
    const res = await gh(args);
    halted();
    return res;
  };

  // The sha's runs; gh failing, or answering anything but a run list, is exit 4.
  const listRuns = async () => {
    const res = await ask(['run', 'list', '--commit', sha, '--json', 'databaseId,name,status,conclusion,url']);
    if (res.code !== 0) stop(4, `gh run list --commit ${sha} failed: ${firstLine(res.err)}`);
    const list = parseJson(res.out);
    if (!Array.isArray(list) || !list.every(isRow)) stop(4, `gh run list --commit ${sha} answered no run list: ${firstLine(res.out)}`);
    return list.map((row) => ({ id: textOf(row?.databaseId), name: textOf(row?.name), url: textOf(row?.url) }));
  };

  // The runs, asked `tries` times `wait` seconds apart while the list stays empty.
  const awaitRuns = async () => {
    let rows = [];
    for (let attempt = 1; attempt <= tries; attempt += 1) {
      rows = await listRuns();
      if (rows.length > 0) break;
      if (attempt < tries) await sleep(wait * 1000, undefined, { signal: aborted }).catch(halted);
    }
    return rows;
  };

  // The open PR's number for the branch whose tip is the sha, '' when there is
  // none, the HEAD is detached or the tip is another commit: CI that never runs
  // on the branch's push may run on its PR.
  const openPr = async () => {
    const branch = spawnSync('git', ['-C', root, 'symbolic-ref', '--quiet', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (branch.status !== 0 || headSha(root) !== sha) return '';
    const name = branch.stdout.trim();
    const res = await ask(['pr', 'list', '--head', name, '--state', 'open', '--json', 'number,url', '--limit', '1']);
    if (res.code !== 0) stop(4, `gh pr list --head ${name} failed: ${firstLine(res.err)}`);
    const list = parseJson(res.out);
    if (!Array.isArray(list) || (list.length > 0 && !isRow(list[0]))) stop(4, `gh pr list --head ${name} answered no PR list: ${firstLine(res.out)}`);
    return textOf(list[0]?.number);
  };

  // Whether any workflow at the repo's toplevel runs on the event.
  const triggeredOn = (event) => {
    const dir = path.join(root, '.github', 'workflows');
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => /^[^.].*\.ya?ml$/.test(name)) : [];
    return names.some((name) => listensTo(path.join(dir, name), event));
  };

  // One run watched to its end: red only when gh shows it finished, else the watch failed, exit 4.
  const watchRun = async ({ id, name, url }) => {
    const watched = await ask(['run', 'watch', id, '--exit-status']);
    if (watched.code === 0) {
      console.log(`ci-watch: green: ${name} ${url}`);
      return 0;
    }
    const view = await ask(['run', 'view', id, '--json', 'conclusion,jobs']);
    const shown = view.code === 0 ? parseJson(view.out) : null;
    const finished = isPlain(shown) ? textOf(shown.conclusion) : '';
    if (finished === '') stop(4, `gh run watch ${id} failed: ${firstLine(`${watched.err}${view.err}`)}`);
    const failed = (Array.isArray(shown.jobs) ? shown.jobs : []).find((job) => job?.conclusion === 'failure');
    say(`RED: ${name}, job ${textOf(failed?.name) || 'unknown'}: ${url}`);
    const logged = await ask(['run', 'view', id, '--log-failed']);
    process.stderr.write(lastLines(Buffer.from(logged.out), LOG_TAIL));
    return 1;
  };

  return {
    awaitRuns, openPr, triggeredOn, watchRun,
  };
};

/**
 * The body: its first line names the sha, its last is always its exit code.
 * @param {string} sha the full sha
 * @returns {Promise<number>} the exit code
 */
const watchBody = async (sha) => {
  const steps = stepsOf(sha, bodyEnd('ci-watch'));
  console.log(`${WATCHING}${sha}`);
  let rows = await steps.awaitRuns();
  const pr = rows.length === 0 && steps.triggeredOn('pull_request') ? await steps.openPr() : '';
  if (pr !== '') {
    console.log(`ci-watch: waiting for PR #${pr}'s run for ${sha}`);
    rows = await steps.awaitRuns();
    if (rows.length === 0) stop(3, `run not queued yet for ${sha} (PR #${pr})`);
  }
  if (rows.length === 0) {
    if (steps.triggeredOn('push')) stop(3, `run not queued yet for ${sha}`);
    console.log('ci-watch: no CI configured for push');
    return 0;
  }
  let status = 0;
  for (const row of rows) {
    if (await steps.watchRun(row) !== 0) status = 1;
  }
  return status;
};

/** The sha a running watch names on its log's first line, waited for, since a body just launched may not have written it yet. */
const watchedSha = async (log) => {
  for (let read = 0; read < SHA_READS; read += 1) {
    const line = firstLine(readOrNull(log) ?? '');
    if (line.startsWith(WATCHING)) return line.slice(WATCHING.length);
    await sleep(SHA_READ_MS);
  }
  return 'an unlogged sha';
};

/**
 * The foreground: this file run again as the body, detached, and its code
 * answered. A held lock is 5, nothing run. A code the body never logged is
 * the runner failing, which is no answer, never a red.
 * @param {string} sha the full sha
 * @returns {Promise<number>} the exit code
 */
const foreground = async (sha) => {
  let paths;
  try {
    paths = await runPaths(rootHere(), 'ci');
  } catch (err) {
    // A bad logs.dir is no answer, never a red.
    if (!(err instanceof LogsDirError)) throw err;
    console.error(err.message);
    return 4;
  }
  const { log } = paths;
  const done = await run({ ...paths, root: null, argv: [process.execPath, __filename, BODY, sha] });
  if (done.int) return done.rc;
  if (done.held !== null) {
    say(`a watch is already running for ${await watchedSha(log)} (pid ${done.held}); its output is in ${log}`);
    return 5;
  }
  const last = lastLines(Buffer.from(readOrNull(log) ?? ''), 1).toString().replace(/\n+$/, '');
  if (done.rc !== 0 && (done.code === null || last !== `ci-watch: exit ${done.rc}`)) {
    say(`the watch did not finish, so there is no answer; its output is in ${log}`);
    return 4;
  }
  return done.rc;
};

/**
 * The call, `<sha>` or `--watch-body <sha>`. A sha shorter than 40 characters
 * is expanded, since `gh run list --commit` matches the full id only.
 * @param {string[]} argv
 * @returns {Promise<number>} the exit code
 */
const main = async (argv) => {
  const body = argv.length === 2 && argv[0] === BODY;
  const [given, ...rest] = body ? argv.slice(1) : argv;
  if (rest.length > 0 || !/^[0-9a-fA-F]{7,40}$/.test(given ?? '')) {
    console.error(USAGE);
    return 2;
  }
  let sha = given;
  if (sha.length < 40) {
    const res = spawnSync('git', ['-C', rootHere(), 'rev-parse', '--verify', '--quiet', `${given}^{commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (res.status !== 0) {
      say(`${given} is not a commit this clone knows; fetch it or pass the full sha`);
      return 2;
    }
    sha = res.stdout.trim();
  }
  return body ? watchBody(sha) : foreground(sha);
};

if (require.main === module) {
  main(process.argv.slice(2))
    .catch((err) => {
      if (!(err instanceof Done)) throw err;
      return err.code;
    })
    // Set the code, never process.exit(): the body's last line follows its output.
    .then((code) => { process.exitCode = code; });
}
