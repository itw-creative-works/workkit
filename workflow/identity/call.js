/**
 * workflow/identity/call.js: the gh shim's call at or above the kit's floor,
 * handed over by ./shim.js with the real gh found. Every call but `gh auth` and
 * one under WORKKIT_IDENTITY_OFF=1 passes ./gate.js first, which may bounce it.
 * A cloud session's issue, label, auth, pr and release verbs go through
 * ./rest.js; elsewhere in a Claude session a bookkeeping verb on a rostered
 * repo, or on the public repo a rostered one pairs with, runs as the workkit App
 * (GH_TOKEN, one process) or not at all; the rest run the real gh as the owner.
 * In a Claude session a write that succeeded leaves the gate's line in the cwd
 * repo's gh journal.
 * Usage: const { call } = require('./call');
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  subAt, spellingsOf, READ_SUBCOMMANDS, CLOUD_VERBS, ISSUE_URL,
} = require('./argv');
const { handOver } = require('./shim');
const { slugFromRemote } = require('../slug');
const { repoSlug } = require('../lib/repo');
const { repoRoot } = require('../lib/git');
const { readOrNull } = require('../lib/read');
const { cwdOf } = require('../lib/link');
const { isCloud } = require('../lib/cloud');
const { drained, writeErr } = require('../lib/say');
const { END_SIGNALS, signalCode } = require('../lib/detach');

// The bookkeeping verbs, and the `pr` subcommands that stay the owner's.
const BOT_VERBS = new Set(['issue', 'label', 'pr']);
const PR_OWNER_SUBCOMMANDS = new Set(['create', 'merge', 'checkout', 'revert', 'update-branch']);
const READS = new Set(READ_SUBCOMMANDS);
// The verbs a cloud session serves through rest.js: the gate's, and `auth`, which the gate never sees.
const REST_VERBS = new Set([...CLOUD_VERBS, 'auth']);
// The flags whose value is prose, never the repo a URL in it names: under every verb, as gh's issue and pr spell them.
const PROSE_FLAGS = new Set(spellingsOf('pr', ['--body', '--body-file', '--title']));
// The flags whose `-` value gh reads from stdin (api's --input has no short one), and the ones whose field's `@-` it does.
const STDIN_FLAGS = [...spellingsOf('pr', ['--body-file']), '--input'];
const FIELD_FLAGS = spellingsOf('api', ['--field']);

/**
 * The first `--repo`/`-R` value in any spelling gh takes, null for none.
 * @param {string[]} args
 * @returns {string|null}
 */
const flagRepo = (args) => {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-R' || arg === '--repo') {
      if (i + 1 < args.length) return args[i + 1];
    } else if (arg.startsWith('--repo=')) return arg.slice('--repo='.length);
    else if (arg.startsWith('-R') && arg.length > 2) return arg.slice(2);
  }
  return null;
};

/**
 * The owner/repo of the first argument that is a github.com issue or pull
 * request URL, a flag's value included but a body's or a title's, which is
 * prose; null for none.
 * @param {string[]} args
 * @returns {string|null}
 */
const urlRepo = (args) => {
  for (let i = 0; i < args.length; i++) {
    if (PROSE_FLAGS.has(args[i])) {
      i++;
      continue;
    }
    const url = args[i].match(ISSUE_URL);
    if (url) return `${url[1]}/${url[2]}`;
  }
  return null;
};

/**
 * The repo a call acts on: the flag, else GH_REPO, else an issue or pull
 * request URL among the arguments, else the cwd's origin; '' when none answers.
 * A flag's value goes through the slug rule, so every spelling gh takes reads.
 * @param {string[]} args
 * @param {object} env
 * @returns {string}
 */
const repoOf = (args, env) => {
  const flag = flagRepo(args) ?? (env.GH_REPO || '');
  // The leading slash lets a bare owner/name through the slug rule's path match.
  if (flag) return slugFromRemote(`/${flag}`) ?? '';
  return urlRepo(args) ?? repoSlug('.');
};

/**
 * Whether the call is bookkeeping: a bot verb whose subcommand (subAt) is no
 * read and, for `pr`, none the owner keeps; no subcommand, or `-h`/`--help`
 * anywhere after the verb, is the owner's.
 * @param {string[]} args gh's argv, the verb first
 * @returns {boolean}
 */
const botVerb = ([verb = '', ...rest]) => {
  if (!BOT_VERBS.has(verb) || rest.includes('-h') || rest.includes('--help')) return false;
  const at = subAt(rest);
  if (at < 0 || READS.has(rest[at])) return false;
  return !(verb === 'pr' && PR_OWNER_SUBCOMMANDS.has(rest[at]));
};

/**
 * The one temp file that holds stdin for every body the call reads from it,
 * made at its first use and removed at the call's end or at an end signal
 * that comes first; `release` hands the signals to the child's wait.
 * @returns {{file: function(): string, release: function(): void, remove: function(): void}}
 */
const stdinFile = () => {
  let file = null;
  const release = () => {
    for (const signal of END_SIGNALS) process.removeListener(signal, onSignal);
  };
  const remove = () => {
    release();
    if (file !== null) fs.rmSync(file, { force: true });
  };
  // A signal before a child holds the signals: the file goes, then the signal
  // ends this process as it would have (on Windows, which has none to end by, its code).
  function onSignal(signal) {
    remove();
    if (process.platform === 'win32') process.exit(signalCode(signal));
    process.kill(process.pid, signal);
  }
  return {
    file: () => {
      if (file === null) {
        const body = fs.readFileSync(0);
        const made = path.join(os.tmpdir(), `workkit-gh-body.${crypto.randomBytes(6).toString('hex')}`);
        fs.writeFileSync(made, body, { flag: 'wx', mode: 0o600 });
        file = made;
        for (const signal of END_SIGNALS) process.on(signal, onSignal);
      }
      return file;
    },
    release,
    remove,
  };
};

/**
 * The args with each body gh would read from stdin (a `-` value of
 * --body-file, -F or --input, or a field's `@-`) pointed at the temp file
 * instead, so the gate reads the same body gh sends.
 * @param {string[]} args
 * @param {{file: function(): string}} stdin stdinFile's answer
 * @returns {string[]}
 */
const stdinBodies = (args, stdin) => {
  let prev = '';
  return args.map((given) => {
    let arg = given;
    if (arg === '-' && STDIN_FLAGS.includes(prev)) arg = stdin.file();
    else if (arg.endsWith('=@-') && FIELD_FLAGS.includes(prev)) arg = `${arg.slice(0, -1)}${stdin.file()}`;
    else if (arg === '--body-file=-' || arg === '--input=-' || (arg.startsWith('--field=') && arg.slice('--field='.length).endsWith('=@-'))) {
      arg = `${arg.slice(0, -1)}${stdin.file()}`;
    }
    prev = arg;
    return arg;
  });
};

// The variables with each folder the shell spelled read as Node opens it (shellEnvOf).
const shellEnv = (env) => require('../../hooks/mods/markers.js').shellEnvOf(env, process.platform);

/**
 * Whether the repo is the bot's: a rostered one (rosterPath), or the public
 * repo an enabled rostered one names in its own settings as `public`.
 * @param {string} repo owner/name
 * @param {object} env the call's variables
 * @returns {Promise<boolean>}
 */
const rostered = async (repo, env) => {
  const { rosterOf, rosterPath } = require('../../hooks/mods/optin.js');
  const { repoSettingsFile, parseJson, isPlain } = require('../../hooks/mods/settings.js');
  const roster = await rosterOf(shellEnv(env), async (file) => readOrNull(file));
  if ((await rosterPath(repo, roster, async (dir) => repoSlug(dir))) !== null) return true;
  const publicOf = async (dir) => {
    const settings = parseJson(readOrNull(repoSettingsFile(dir)));
    return isPlain(settings) && typeof settings.public === 'string' ? settings.public : null;
  };
  return (await rosterPath(repo, roster, publicOf)) !== null;
};

/**
 * The journal line appended to the gh journal of `root`, then the markers
 * swept, so the sweep never removes the journal just written. A journal that
 * cannot take it is said, never fatal.
 * @param {string} line the gate's
 * @param {string} root the cwd's git toplevel, else the cwd
 * @param {object} env the call's variables
 */
const journalAppend = async (line, root, env) => {
  const { sweepMarkers } = require('../lib/lock');
  const home = require('../../hooks/mods/log.js').userDirOf(shellEnv(env));
  try {
    const journal = await require('../../hooks/mods/markers.js').journalPath(root, home);
    fs.mkdirSync(path.dirname(journal), { recursive: true });
    fs.appendFileSync(journal, `${line}\n`);
  } catch {
    writeErr('gh: the call ran, but the workkit gh journal could not take its line\n');
  }
  sweepMarkers(home);
};

/**
 * One gh call at or above the floor, `gh` the real one.
 * @param {string[]} argv gh's argv, the verb first
 * @param {object} env the call's variables
 * @param {string} gh the real gh's native path
 * @returns {Promise<number>} the exit code
 */
const call = async (argv, env, gh) => {
  const auth = argv[0] === 'auth';
  const off = env.WORKKIT_IDENTITY_OFF === '1';
  const cwd = cwdOf(env);
  const repo = auth ? '' : repoOf(argv, env);
  const stdin = stdinFile();
  let args = argv;
  let line = '';
  let root = null;
  const finish = async (code) => {
    if (code === 0 && line && env.CLAUDECODE === '1') await journalAppend(line, root || cwd, env);
    return code;
  };
  const runGh = async (runEnv) => {
    await drained(process.stdout);
    await drained(process.stderr);
    return finish(await handOver(gh, args, runEnv, { onHeld: stdin.release, onExit: stdin.remove }));
  };
  try {
    if (!off && !auth) {
      // The gate and the hooks modules load here, where the gate runs.
      const { judge, gateFailed } = require('./gate');
      const { sessionJudges } = require('../../hooks/mods/gate.js');
      const { repoSettingsFile } = require('../../hooks/mods/settings.js');
      args = stdinBodies(argv, stdin);
      root = repoRoot(cwd);
      // The session half rules only where the session rule holds for the cwd's git toplevel.
      const gateEnv = { ...env, WORKKIT_REAL_GH: gh, WORKKIT_GATE_REPO: repo };
      delete gateEnv.WORKKIT_GATE_JUDGES;
      if (root !== null && sessionJudges(env, readOrNull(repoSettingsFile(root)))) gateEnv.WORKKIT_GATE_JUDGES = '1';
      let verdict;
      try {
        verdict = await judge([cwd, ...args], gateEnv);
      } catch (err) {
        return gateFailed(err);
      }
      if (verdict.code !== 0) return verdict.code;
      line = verdict.line;
    }
    // A cloud session's proxy serves REST alone and signs every call as the
    // account, so no bot token is fetched there; every other verb is given the
    // repo, whatever host the clone's proxy origin names.
    if (isCloud(env)) {
      if (REST_VERBS.has(args[0])) {
        await drained(process.stderr);
        // The real gh rest.js starts reads the repo from GH_REPO; this process's env keeps none.
        return await finish(require('./rest').served(args, { gh, repo, env: { ...env, GH_REPO: repo } }));
      }
      return await runGh(repo ? { ...env, GH_REPO: repo } : env);
    }
    if (!env.CLAUDECODE || off || auth || !botVerb(args)) return await runGh(env);
    if (!repo || !(await rostered(repo, env))) return await runGh(env);
    // The client's code says what to do: 0 hands over the token, in the
    // environment alone; any other stops here with the client's message, so
    // such a call never runs as the owner.
    const { tokenAnswer, failureCode } = require('./token');
    let answer;
    try {
      answer = await tokenAnswer(repo);
    } catch (err) {
      return failureCode(err);
    }
    if (answer.code !== 0) return answer.code;
    return await runGh({ ...env, GH_TOKEN: answer.token });
  } finally {
    // Every return above waits on its run, so the file outlives the real gh's read.
    stdin.remove();
  }
};

module.exports = { call };
