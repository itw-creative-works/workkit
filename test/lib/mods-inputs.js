// The plain-data seam between the logic suites under test/hooks/ and the
// hooks module's pure functions (hooks/mods/*.js). The Contract names each
// function and the shape of every argument; the arguments are built here,
// once, so every suite spells them the same way.

const path = require('path');

const MODS = path.join(__dirname, '..', '..', 'hooks', 'mods');

/** One hooks/mods/<name>.js module, an ES module Node 22 requires directly. */
const mods = (name) => require(path.join(MODS, `${name}.js`));

/**
 * The text a function answered, whatever it is wrapped in: a string, a list
 * of strings, `{ block }`, `{ additionalContext }`, or nothing (silence).
 */
const textOf = (result) => {
  if (result === undefined || result === null || result === false) return '';
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) return result.map(textOf).filter(Boolean).join('\n');
  for (const key of ['block', 'additionalContext', 'context', 'text', 'warning', 'deny']) {
    if (result[key] !== undefined) return textOf(result[key]);
  }
  return '';
};

/** A process.run result, the shape $.process.run resolves with. */
const runResult = ({ exitCode = 0, stdout = '', stderr = '' } = {}) => ({
  exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false,
});

/**
 * stateCheckContext's facts: `cwd` the session's directory (required),
 * `inbox` the open status:inbox count (0 when gh is missing or failed),
 * `capture` the text of .workkit/capture.md, `claude` the repo CLAUDE.md,
 * `agents` the repo AGENTS.md (each null when absent), `isUserClaude` true
 * when the directory is the user's own ~/.claude.
 */
const stateFacts = ({
  cwd = '/w/repo', inbox = 0, capture = null, claude = null, agents = null, isUserClaude = false,
} = {}) => ({
  cwd, inbox, capture, claude, agents, isUserClaude,
});

/**
 * testReminderContext's facts: `root` the repo root, `rel` the written file
 * relative to it, `files` every tracked and untracked repo file relative to
 * the root, `tests` the test-shaped ones as a path-to-text map. The seen list
 * the function takes beside them holds `${root}/${rel}` strings.
 */
const REMINDER_ROOT = '/w/repo';
const reminderFacts = (rel, repoFiles) => ({
  root: REMINDER_ROOT,
  rel,
  files: Object.keys(repoFiles).sort(),
  tests: Object.fromEntries(Object.entries(repoFiles)
    .filter(([name]) => /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.|_test\./.test(name))),
});

/**
 * standardsContext's state: `isSetUp` whether setup has run, `cliLink` the
 * CLI link setup makes, `engine` the engine's physical path, `isInCache`
 * whether that path is in the plugin cache, `root` the repo root (null
 * outside a repo), `broken` a broken install's line (absent when whole),
 * `participation` the engine's `--state` answer, `offer` its `--announce`
 * text. healResult and updateResult are process.run results, or null when
 * none ran.
 */
const standardsState = ({
  isSetUp = true, cliLink = '/w/home/.local/bin/workkit', engine = '/opt/kit/workflow', isInCache = false,
  root = '/w/repo', broken, participation = 'enabled', offer = '',
} = {}) => ({
  isSetUp, cliLink, engine, isInCache, root, ...(broken === undefined ? {} : { broken }), participation, offer,
});

const {
  MODELS, SESSION_NOW, daysBefore, briefMarker, row,
} = require('./mod-fixtures.mjs');

/**
 * sessionContext's facts: `state` the text of .workkit/agents/session.md (null
 * when absent), `brief` the parsed ~/.workkit/brief-status.json (null when
 * absent or unparsed), `repoSlug` the machine settings' `site.repo` (null when
 * unset), `now` the clock in milliseconds since the epoch.
 */
const sessionFacts = ({
  state = null, brief = null, repoSlug = null, now = SESSION_NOW,
} = {}) => ({
  state, brief, repoSlug, now,
});

module.exports = {
  mods, textOf, runResult, stateFacts, reminderFacts, standardsState, REMINDER_ROOT,
  sessionFacts, daysBefore, briefMarker, MODELS, row,
};
