// The home world's fake gh and npm answers, run in each stand-in's own process
// (helpers.js beside it). It loads only Node's modules, so the stand-ins start
// on any PATH a case narrows (docs/tests.md § The shape).

const fs = require('fs');
const path = require('path');

// The omega bin a tower tree holds: only its presence and its mode are read.
const OMEGA_BIN = '#!/usr/bin/env node\n';

/**
 * The world's fake npm, answering in its own process: the cwd recorded, one
 * path a line, and the calls counted, the bin linked from the `linksOn`th on
 * (0 never) under `--prefix` or, npm's own default, the cwd.
 * @returns {number} the exit code
 */
const answerNpm = ({ cwdLog, countFile, linksOn }, argv) => {
  fs.appendFileSync(cwdLog, `${process.cwd()}\n`);
  const prefix = argv[0] === '--prefix' ? argv[1] : process.cwd();
  const n = (fs.existsSync(countFile) ? Number(fs.readFileSync(countFile, 'utf8')) : 0) + 1;
  fs.writeFileSync(countFile, String(n));
  if (linksOn > 0 && n >= linksOn) {
    const bin = path.join(prefix, 'node_modules', '.bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'omega'), OMEGA_BIN);
    fs.chmodSync(path.join(bin, 'omega'), 0o755);
  }
  return 0;
};

/** The fake gh's `label create <name>`: its description and color flags, appended to the store. */
const createLabel = (labelsFile, argv) => {
  let description = '';
  let color = '';
  argv.forEach((arg, i) => {
    if (argv[i - 1] === '--description') description = arg;
    if (argv[i - 1] === '--color') color = arg;
  });
  const labels = JSON.parse(fs.readFileSync(labelsFile, 'utf8'));
  labels.push({ name: argv[2], description, color });
  fs.writeFileSync(labelsFile, `${JSON.stringify(labels)}\n`);
};

/**
 * The categories the fake gh reads: a pending store moves in once its count of
 * further reads runs out, so the owner's page is answered by reads, never seconds.
 */
const readCategories = ({ categoriesFile, pendingFile, pendingReads }) => {
  if (fs.existsSync(pendingFile)) {
    const left = Number(fs.readFileSync(pendingReads, 'utf8'));
    if (left > 0) fs.writeFileSync(pendingReads, String(left - 1));
    else fs.renameSync(pendingFile, categoriesFile);
  }
  return fs.readFileSync(categoriesFile, 'utf8').replace(/\n+$/, '');
};

/** Whether `all` holds `first`, then `then` somewhere after it. */
const holdsInOrder = (all, first, then) => {
  const at = all.indexOf(first);
  return at >= 0 && all.includes(then, at + first.length);
};

/**
 * The world's fake gh, answering in its own process by the words its call
 * holds, the first match winning. The Pages calls are a GET (is it on?) then a
 * POST (turn it on), and the two answer apart.
 * @returns {number} the exit code
 */
const answerGh = (config, argv) => {
  const {
    login, repoExists, labelsFile, discussionsOn, pagesOn, pagesFails,
  } = config;
  const all = argv.join(' ');
  const say = (text) => { process.stdout.write(text); return 0; };
  if (all.includes('api user')) return say(`${login}\n`);
  if (all.includes('repo view')) return repoExists ? 0 : 1;
  if (all.includes('repo create')) return 0;
  if (all.includes('label list')) return say(fs.readFileSync(labelsFile, 'utf8'));
  if (all.includes('label create')) { createLabel(labelsFile, argv); return 0; }
  if (all.includes('label edit')) return 0;
  if (all.includes('updateRepository')) return say('{"data":{"updateRepository":{"repository":{"hasDiscussionsEnabled":true}}}}');
  if (all.includes('createDiscussion')) return say('{"data":{"createDiscussion":{"discussion":{"url":"https://github.com/owner/workkit/discussions/3"}}}}');
  if (all.includes('discussions(first')) {
    return say('{"data":{"repository":{"discussions":{"nodes":['
      + '{"title":"daily: 2026-07-27","createdAt":"2026-07-27T09:00:00Z","body":"yesterday"},'
      + '{"title":"daily: 2026-06-01","createdAt":"2026-06-01T09:00:00Z","body":"long ago"}]}}}}');
  }
  if (all.includes('discussionCategories')) {
    return say(`{"data":{"repository":{"id":"R_kdt","hasDiscussionsEnabled":${discussionsOn},"discussionCategories":{"nodes":[${readCategories(config)}]}}}}`);
  }
  if (pagesOn && all.includes('pages')) return 0;
  if (holdsInOrder(all, '-X POST', 'pages')) return pagesFails ? 1 : 0;
  if (all.includes('pages')) return 1;
  return say('{}');
};

module.exports = { OMEGA_BIN, answerNpm, answerGh };
