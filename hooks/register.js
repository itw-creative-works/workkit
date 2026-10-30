/**
 * hooks/register.js: the workkit hooks module, the twenty-nine in-process
 * hooks on ten events (docs/hooks.md § The hooks module). The one file that
 * touches `$`: each hook's logic is plain functions in hooks/mods/<name>.js,
 * and this file gathers their facts (or hands a mods gatherer the engine calls
 * as plain functions), gates them, logs each fire and answers.
 */

import { addonContext, addonPath } from './mods/addon.js';
import { boardGuardVerdict } from './mods/board-guard.js';
import { changeTrackerGather } from './mods/change-tracker.js';
import { changelogGuardVerdict, isChangelog, linterPath } from './mods/changelog-guard.js';
import { checkpointContext } from './mods/checkpoint.js';
import { closeGuardGather } from './mods/close-guard.js';
import { featureContext, featureMatch } from './mods/feature.js';
import { isExempt } from './mods/gate.js';
import { BASH_GUARDS, FILE_GUARDS, GUARDS_FAILED, POST_BASH_GUARDS, READ_GUARDS, folderOpted, runChain } from './mods/guards.js';
import { appendLog, homeOf, logLine, pad, userDirOf } from './mods/log.js';
import { crewClass, isAdvise, managerConfig } from './mods/manager.js';
import { sha1Hex, shellEnvOf, windowsKit } from './mods/markers.js';
import { profileContext } from './mods/profile.js';
import { reloadFingerprint, reloadGuardContext, surfacePaths } from './mods/reload-guard.js';
import { resolverAdvice, resolverModel } from './mods/resolver.js';
import { sessionGather } from './mods/session.js';
import { sessionGuardVerdict } from './mods/session-guard.js';
import { spawnGuardWarning } from './mods/spawn-guard.js';
import { standardsGather } from './mods/standards.js';
import { inboxCount, stateCheckContext } from './mods/state-check.js';
import { testBarContext } from './mods/test-bar.js';
import { isCodePath, isTestPath, testReminderContext } from './mods/test-reminder.js';

// Each hook as settings and the hooks log name it.
const HOOK = {
  boardGuard: 'docs:board-guard',
  changelogGuard: 'docs:changelog-guard',
  sessionGuard: 'docs:session-guard',
  testReminder: 'safety:test-reminder',
  testBar: 'safety:test-bar',
  stateCheck: 'docs:state-check',
  session: 'docs:session',
  standards: 'workflow:standards',
  reloadGuard: 'workflow:reload-guard',
  profile: 'manager:profile',
  checkpoint: 'docs:checkpoint',
  feature: 'workflow:feature',
  addon: 'manager:addon',
  resolver: 'manager:resolver',
  spawnGuard: 'manager:spawn-guard',
  closeGuard: 'manager:close-guard',
  changeTracker: 'docs:change-tracker',
};

const GH_TIMEOUT_MS = 5000;
const INBOX_CACHE_MS = 30 * 60 * 1000;

// A path's folder; a drive root keeps its slash (`C:/`), so git never runs drive-relative.
const dirOf = (path) => {
  const cut = path.lastIndexOf('/');
  if (cut <= 0) return '/';
  return /^[A-Za-z]:$/.test(path.slice(0, cut)) ? path.slice(0, cut + 1) : path.slice(0, cut);
};
const verdictOf = (hook, opted) => (isExempt(hook) || opted ? 'run' : 'stood-down');
const storeKey = (sid, name) => `workkit:${sid}:${name}`;
const failedRun = (err) => ({ exitCode: 1, stdout: '', stderr: String(err?.message ?? err), isStarted: false });
const quiet = (promise) => promise.catch(() => undefined);

// The written file, absolute and in one spelling, every backslash a slash (as
// optin.js folds it), so the mods see `C:/...` on Windows too; a
// relative one is the session directory's.
const filePathOf = (e) => {
  const path = e.tool_input?.file_path?.replace(/\\/g, '/');
  if (!path) return null;
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path) ? path : `${String(e.cwd ?? '').replace(/\\/g, '/')}/${path}`;
};

// Our contexts lead what the hooks beneath added; the result passes on whole.
const withContext = (result, contexts) => (contexts.length === 0
  ? result
  : { ...result, additionalContext: [...contexts, ...(result?.additionalContext ?? [])] });

// Every variable the module reads, once per dispatch, each folder the shell
// spelled translated to the one it names; an unreadable one is unset.
async function envOf($) {
  const [
    HOOK_DISABLE, WORKFLOW_HOME, HOME, USERPROFILE, TMPDIR, TMP, TEMP, LOCALAPPDATA, WORKFLOW_DIR, WORKFLOW_CLAUDE_HOME,
    STATE_CHECK_CACHE, WORKFLOW_STANDARDS_CACHE, RELOAD_GUARD_ROOT,
    MANAGER_LADDER, MANAGER_USER_SETTINGS, MANAGER_DEBUG, MANAGER_CLOSE_EDITS, CLAUDE_CODE_REMOTE,
  ] = await Promise.all([
    quiet($.env.get('HOOK_DISABLE')), quiet($.env.get('WORKFLOW_HOME')), quiet($.env.get('HOME')),
    quiet($.env.get('USERPROFILE')), quiet($.env.get('TMPDIR')), quiet($.env.get('TMP')),
    quiet($.env.get('TEMP')), quiet($.env.get('LOCALAPPDATA')), quiet($.env.get('WORKFLOW_DIR')),
    quiet($.env.get('WORKFLOW_CLAUDE_HOME')), quiet($.env.get('STATE_CHECK_CACHE')),
    quiet($.env.get('WORKFLOW_STANDARDS_CACHE')), quiet($.env.get('RELOAD_GUARD_ROOT')),
    quiet($.env.get('MANAGER_LADDER')), quiet($.env.get('MANAGER_USER_SETTINGS')),
    quiet($.env.get('MANAGER_DEBUG')), quiet($.env.get('MANAGER_CLOSE_EDITS')),
    quiet($.env.get('CLAUDE_CODE_REMOTE')),
  ]);
  return shellEnvOf({
    HOOK_DISABLE, WORKFLOW_HOME, HOME, USERPROFILE, TMPDIR, TMP, TEMP, LOCALAPPDATA, WORKFLOW_DIR, WORKFLOW_CLAUDE_HOME,
    STATE_CHECK_CACHE, WORKFLOW_STANDARDS_CACHE, RELOAD_GUARD_ROOT,
    MANAGER_LADDER, MANAGER_USER_SETTINGS, MANAGER_DEBUG, MANAGER_CLOSE_EDITS, CLAUDE_CODE_REMOTE,
  }, windowsKit($.plugin.root) ? 'win32' : 'posix');
}

async function readText($, path) {
  try {
    return await $.fs.read(path);
  } catch {
    return null;
  }
}

async function exists($, path) {
  try {
    return await $.fs.exists(path);
  } catch {
    return false;
  }
}

// The written file where it really is: a
// linked file names its target's repo; a path not there yet keeps its spelling.
async function physicalPath($, file) {
  if (!file) return null;
  const real = await realPath($, file);
  return real ? real.replace(/\\/g, '/') : file;
}

async function realPath($, path) {
  try {
    return (await $.fs.stat(path, { resolve: true })).realPath ?? null;
  } catch {
    return null;
  }
}

// A command that cannot start, or outlives its timeout, reads as a failed run.
async function run($, argv, init) {
  try {
    return await $.process.run(argv, init);
  } catch (err) {
    return failedRun(err);
  }
}

async function gitTop($, cwd) {
  if (!cwd) return null;
  const top = await run($, ['git', 'rev-parse', '--show-toplevel'], { cwd });
  return top.exitCode === 0 ? top.stdout.trim() || null : null;
}

async function now($) {
  try {
    return await $.clock.now();
  } catch {
    return Date.now();
  }
}

async function sessionModel($) {
  try {
    return await $.session.model();
  } catch {
    return undefined;
  }
}

// The session's own folder, '' when the engine cannot say: the quiet form, for
// where no folder is a stand-down (the hooks log, agent.spawn, the Agent tool's
// PreToolUse, test-reminder). The tool.call chains ask $.session.cwd() bare, so
// a throw there fails them closed.
async function sessionCwd($) {
  try {
    return await $.session.cwd();
  } catch {
    return '';
  }
}

async function sessionId($, e) {
  if (e.session_id || e.sessionId) return e.session_id || e.sessionId;
  try {
    return await $.session.id();
  } catch {
    return '';
  }
}

async function storeGet($, sid, name) {
  if (!sid) return undefined;
  try {
    return await $.store.get(storeKey(sid, name));
  } catch {
    return undefined;
  }
}

async function storeKeys($) {
  try {
    return await $.store.keys();
  } catch {
    return [];
  }
}

async function storeDrop($, key) {
  try {
    await $.store.delete(key);
  } catch {
    // A key left behind is dropped by nothing else; it costs only its bytes.
  }
}

async function storeSet($, sid, name, value) {
  if (!sid) return;
  try {
    await $.store.set(storeKey(sid, name), value);
  } catch {
    // A lost marker costs one repeated line, never the hook.
  }
}

// Each hook fails open on its own: the error goes to the debug log and the
// hook says nothing.
async function caught($, hook, work) {
  try {
    return await work;
  } catch (err) {
    $.ui.log(`${hook}: ${err?.message ?? err}`, { to: 'debug' });
    return null;
  }
}

// The classic events whose input carries the session's folder as `cwd`.
const CARRIES_CWD = new Set(['PostToolUse', 'PostToolUseFailure', 'SessionStart', 'UserPromptSubmit', 'SubagentStart', 'Stop']);

// Every fire of a dispatch in the hooks log, the one writer every handler
// calls: one line per fire (log.js's line and cap), the session and folder
// asked once, then one read and one whole-file write, so two sessions writing
// at once may lose a line (docs/hooks.md § The hooks log).
async function logFires($, env, event, e, fires) {
  if (fires.length === 0) return;
  try {
    const folder = CARRIES_CWD.has(event) ? e.cwd ?? '' : sessionCwd($);
    const [sid, cwd, at] = await Promise.all([sessionId($, e), folder, now($)]);
    const iso = new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const path = `${userDirOf(env)}/hooks.log`;
    const lines = fires.map(([hook, verdict]) => logLine(iso, hook, event, sid, cwd, verdict)).join('');
    await $.fs.write(path, appendLog((await readText($, path)) ?? '', lines));
  } catch {
    // A write that fails never stops the hook.
  }
}

async function configOf($, env, cwd) {
  const ladder = env.MANAGER_LADDER || `${$.plugin.root}/hooks/manager/resources/ladder.json`;
  const user = env.MANAGER_USER_SETTINGS || `${userDirOf(env)}/settings.json`;
  const root = await gitTop($, cwd);
  const [ladderText, userText, repoText] = await Promise.all([
    readText($, ladder), readText($, user), root ? readText($, `${root}/.workkit/settings.json`) : null,
  ]);
  return managerConfig(ladderText, userText, repoText);
}

// The engine calls a mods gatherer makes, as plain functions: `$` stays here.
const ioOf = ($, env) => ({
  pluginRoot: $.plugin.root,
  top: (cwd) => gitTop($, cwd), read: (path) => readText($, path), now: () => now($),
  exists: (path) => exists($, path), real: (path) => realPath($, path), run: (argv, init) => run($, argv, init),
  list: (path) => $.fs.list(path).then((entries) => entries.map((f) => f.name), () => []),
  write: (path, text) => quiet($.fs.write(path, text)), sha1: sha1Hex, stat: (path) => $.fs.stat(path).catch(() => null),
  config: (cwd) => configOf($, env, cwd), model: () => sessionModel($),
  messages: () => $.session.messages(), log: (text) => $.ui.log(text),
});

async function changelogGuardHook($, env, file, text) {
  if (!isChangelog(file) || text === null) return null;
  const linter = linterPath(env, $.plugin.root);
  if (!(await exists($, linter))) return null;
  const lint = await run($, ['node', linter, file, '--added-only'], { cwd: dirOf(file) });
  // No node to run the linter, or a run past its timeout: the guard stands aside.
  return lint.isStarted === false ? null : changelogGuardVerdict(file, lint);
}

// A written file in the session's own repo as `{ root, rel }`, else null: the
// gate test-reminder and test-bar share.
async function repoRel($, e, file) {
  if (!file || !(await exists($, file))) return null;
  const dir = dirOf(file);
  const [root, fileRoot] = await Promise.all([gitTop($, e.cwd || (await sessionCwd($))), gitTop($, dir)]);
  if (!root || root !== fileRoot) return null;
  const prefix = await run($, ['git', 'rev-parse', '--show-prefix'], { cwd: dir });
  if (prefix.exitCode !== 0) return null;
  return { root, rel: `${prefix.stdout.trim()}${file.split('/').pop()}` };
}

async function testReminderHook($, e, where) {
  if (!where) return null;
  const { root, rel } = where;
  const seen = (await storeGet($, e.session_id, 'test-reminder')) ?? [];
  if (!isCodePath(rel) || seen.includes(`${root}/${rel}`)) return null;
  const listing = await run($, ['git', '-c', 'core.quotePath=false', 'ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root });
  const files = listing.exitCode === 0 ? listing.stdout.split('\n').filter(Boolean) : [];
  const tests = {};
  await Promise.all(files.filter(isTestPath).map(async (path) => {
    tests[path] = (await readText($, `${root}/${path}`)) ?? '';
  }));
  const context = testReminderContext({ root, rel, files, tests }, seen);
  if (context) await storeSet($, e.session_id, 'test-reminder', [...seen, `${root}/${rel}`]);
  return context;
}

async function testBarHook(where, text) {
  return where ? testBarContext({ ...where, text }) : null;
}

// The open inbox count; only silence is cached, about 30 minutes per repo,
// since a count worth announcing can be drained at any moment.
async function inboxOf($, env, cwd) {
  if ((await run($, ['git', 'rev-parse', '--is-inside-work-tree'], { cwd })).exitCode !== 0) return 0;
  const cache = `${env.STATE_CHECK_CACHE || `${homeOf(env)}/.claude/logs/state-check`}/${await sha1Hex(cwd)}`;
  try {
    if ((await now($)) - (await $.fs.stat(cache)).mtimeMs < INBOX_CACHE_MS && (await readText($, cache)) === '0') return 0;
  } catch {
    // No cache yet: ask.
  }
  const gh = await run($, ['gh', 'issue', 'list', '--state', 'open', '--label', 'status:inbox', '--json', 'number', '--limit', '1000'], { cwd, timeoutMs: GH_TIMEOUT_MS });
  if (gh.exitCode !== 0 || !gh.stdout.trim()) return 0;
  const count = inboxCount(gh.stdout);
  try {
    await $.fs.write(cache, count === 0 ? '0' : '');
  } catch {
    // An unwritten cache asks again next session.
  }
  return count;
}

async function stateCheckHook($, env, e) {
  const { cwd } = e;
  if (!cwd) return null;
  const [inbox, capture, claude, agents] = await Promise.all([
    inboxOf($, env, cwd), readText($, `${cwd}/.workkit/capture.md`),
    readText($, `${cwd}/CLAUDE.md`), readText($, `${cwd}/AGENTS.md`),
  ]);
  const here = claude === null ? null : await realPath($, cwd);
  const isUserClaude = here !== null && here === (await realPath($, `${homeOf(env)}/.claude`));
  return stateCheckContext({ cwd, inbox, capture, claude, agents, isUserClaude });
}

// The load-time surfaces' fingerprint, digested: the files a session reads
// once, this module's own among them.
async function fingerprintOf($, env) {
  const root = env.RELOAD_GUARD_ROOT || $.plugin.root;
  const listed = async (dir) => {
    try {
      return await $.fs.list(`${root}/${dir}`);
    } catch {
      return [];
    }
  };
  const [paths, hooksJson] = await Promise.all([surfacePaths(listed), readText($, `${root}/hooks/hooks.json`)]);
  const surfaces = await Promise.all(paths.map(async (path) => {
    try {
      return { path, mtimeMs: (await $.fs.stat(`${root}/${path}`)).mtimeMs };
    } catch {
      return null;
    }
  }));
  return sha1Hex(reloadFingerprint(hooksJson ?? '', surfaces.filter(Boolean)));
}

async function reloadStampHook($, env, e) {
  if (!e.session_id) return null;
  await storeSet($, e.session_id, 'reload-guard', { stamp: await fingerprintOf($, env) });
  return null;
}

async function reloadPromptHook($, env, e) {
  if (!e.session_id) return null;
  const [held, fingerprint] = await Promise.all([storeGet($, e.session_id, 'reload-guard'), fingerprintOf($, env)]);
  if (!held?.stamp) {
    await storeSet($, e.session_id, 'reload-guard', { stamp: fingerprint });
    return null;
  }
  const context = reloadGuardContext(held, fingerprint);
  if (context) await storeSet($, e.session_id, 'reload-guard', { ...held, notified: fingerprint });
  return context;
}

async function profileHook($, env, e) {
  return profileContext(await configOf($, env, e.cwd), await sessionModel($));
}

async function checkpointHook($, e) {
  const context = checkpointContext(e.prompt, await storeGet($, e.session_id, 'checkpoint'));
  if (context) await storeSet($, e.session_id, 'checkpoint', await now($));
  return context;
}

// Only a strong match spends the session's one load, so a false weak fire
// (a port, a year) cannot silence a later `work on #N`.
async function featureHook($, e) {
  const context = featureContext(e.prompt, await storeGet($, e.session_id, 'feature'));
  if (context && featureMatch(e.prompt) === 'strong') await storeSet($, e.session_id, 'feature', true);
  return context;
}

async function addonHook($, env, e) {
  const path = addonPath(userDirOf(env), e.agent_type);
  if (!path || !(await exists($, path))) return null;
  const text = await readText($, path);
  if (text === null) {
    $.ui.log(`manager:addon: ${path} exists but cannot be read; fix its permissions or remove it`);
    return null;
  }
  return addonContext(text, e.agent_type, path);
}

async function spawnGuardHook($, env, e, cwd) {
  const warning = spawnGuardWarning(await configOf($, env, cwd), e.subagent_type, e.model, await sessionModel($));
  if (warning) $.ui.log(warning);
  return warning;
}

async function resolverHook($, env, e, cwd) {
  const config = await configOf($, env, cwd);
  const model = resolverModel(config, e.subagentType, e.parentModel, e.model);
  if (!model) return null;
  if (env.MANAGER_DEBUG === '1') {
    const at = new Date(await now($));
    const line = `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())} class=${crewClass(e.subagentType)} mode=${isAdvise(config) ? 'advise' : 'rewrite'} model=${model} session=${e.parentModel || '?'}\n`;
    const path = `${env.TMPDIR}/claude-manager-resolver.log`;
    await quiet($.fs.write(path, `${(await readText($, path)) ?? ''}${line}`));
  }
  return { model, isAdvise: isAdvise(config) };
}

async function dropSessionKeys($, sid) {
  if (!sid) return null;
  const keys = await storeKeys($);
  await Promise.all(keys.filter((key) => key.startsWith(storeKey(sid, ''))).map((key) => storeDrop($, key)));
  return null;
}

// A hook that never refuses passes the event on when it fails.
const passOn = ($, e, next) => next(e);
const NOT_INPUT = new Set(['tool', 'tool_use_id', 'agentId']);
// A guard chain that failed before its answer refuses, naming the failure's kind.
const failClosed = ($, e, next) => (next.called ? next(e) : { deny: `${GUARDS_FAILED}${next.error.kind}` });

// One guard chain (guards.js) over the facts `facts()` gathers: every fire
// logged, a guard's throw rethrown for the .catch, the first deny answered,
// else the event passed on with the notices as one entry and one owner line.
async function guardChain($, e, next, event, guards, facts) {
  const env = await envOf($);
  if (env.HOOK_DISABLE === '1') return next(e);
  const chain = await runChain(ioOf($, env), env, guards, await facts());
  await logFires($, env, event === 'tool.call' ? 'PreToolUse' : event, e, chain.fires);
  if (chain.error) throw chain.error;
  if (chain.deny) return { deny: chain.deny };
  if (!chain.notice) return next(e);
  $.ui.log(chain.notice);
  const result = await next(e);
  return event === 'tool.call' ? { ...result, context: [chain.notice, ...(result?.context ?? [])] } : withContext(result, [chain.notice]);
}

// A file guard's facts. `tool.call` carries the input flat beside `tool`,
// `tool_use_id` and `agentId`, and no folder: the cwd is the session's. An
// Edit or Write is gated by the file's repo, a Read or Grep by the cwd's.
// `file` is where the file really is, `typed` the path as the input spells it.
async function fileFacts($, e) {
  const input = Object.fromEntries(Object.entries(e).filter(([key]) => !NOT_INPUT.has(key)));
  const cwd = await $.session.cwd();
  const file = await physicalPath($, filePathOf({ tool_input: input, cwd }));
  const dir = file ? dirOf(file) : cwd;
  return { tool: e.tool, input, cwd, file, typed: filePathOf({ tool_input: input, cwd }), dir, gateDir: e.tool === 'Read' || e.tool === 'Grep' ? cwd : dir };
}

// The facts of a Bash call that already ran, and whether it failed.
const postBashFacts = (e, failed) => async () => ({ command: e.tool_input?.command ?? '', cwd: e.cwd ?? '', failed });

export function register(on) {
  on('classic.PostToolUse', { tool_name: ['Edit', 'Write'] }, async ($, e, next) => {
    const env = await envOf($);
    if (env.HOOK_DISABLE === '1') return next(e);
    const file = await physicalPath($, filePathOf(e));
    const opted = await folderOpted(ioOf($, env), file ? dirOf(file) : e.cwd);
    const fires = [];
    let block = null;
    const contexts = [];
    if (!opted) {
      for (const hook of [HOOK.boardGuard, HOOK.changelogGuard, HOOK.sessionGuard, HOOK.testReminder, HOOK.testBar]) fires.push([hook, 'stood-down']);
    } else {
      // In order: the first block wins and the hooks after it do not run.
      const text = file ? await readText($, file) : null;
      fires.push([HOOK.boardGuard, 'run']);
      block = boardGuardVerdict(file, text, `${$.plugin.root}/docs/project-state.md`);
      if (!block) {
        fires.push([HOOK.changelogGuard, 'run']);
        block = await caught($, HOOK.changelogGuard, changelogGuardHook($, env, file, text));
      }
      if (!block) {
        fires.push([HOOK.sessionGuard, 'run']);
        block = sessionGuardVerdict(file, text);
      }
      if (!block) {
        // The two nudges share one repo read; neither blocks.
        const where = await caught($, `${HOOK.testReminder}, ${HOOK.testBar} (repo read)`, repoRel($, e, file));
        fires.push([HOOK.testReminder, 'run']);
        contexts.push(await caught($, HOOK.testReminder, testReminderHook($, e, where)));
        fires.push([HOOK.testBar, 'run']);
        contexts.push(await caught($, HOOK.testBar, testBarHook(where, text)));
      }
    }
    await logFires($, env, 'PostToolUse', e, fires);
    const result = await next(e);
    if (block) return { ...result, block: [block, result?.block].filter(Boolean).join('\n\n') };
    return withContext(result, contexts.filter(Boolean));
  }).catch(($, e, next) => (next.called
    ? next(e)
    : { block: 'workkit: the PostToolUse guards failed before they could judge this write; check the file by hand.' }));

  on('classic.SessionStart', async ($, e, next) => {
    const env = await envOf($);
    if (env.HOOK_DISABLE === '1') return next(e);
    const opted = await folderOpted(ioOf($, env), e.cwd);
    // The reload stamp is taken only where the session loads its surfaces.
    const stamps = e.source === 'startup' || e.source === 'resume';
    const fires = [[HOOK.stateCheck, verdictOf(HOOK.stateCheck, opted)], [HOOK.standards, 'run']];
    if (stamps) fires.push([HOOK.reloadGuard, 'run']);
    fires.push([HOOK.session, verdictOf(HOOK.session, opted)]);
    const contexts = await Promise.all([
      opted ? caught($, HOOK.stateCheck, stateCheckHook($, env, e)) : null,
      caught($, HOOK.standards, standardsGather(ioOf($, env), env, e)),
      stamps ? caught($, HOOK.reloadGuard, reloadStampHook($, env, e)) : null,
      opted ? caught($, HOOK.session, sessionGather(ioOf($, env), env, e)) : null,
    ]);
    await logFires($, env, 'SessionStart', e, fires);
    return withContext(await next(e), contexts.filter(Boolean));
  }).catch(passOn);

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const env = await envOf($);
    if (env.HOOK_DISABLE === '1') return next(e);
    const opted = await folderOpted(ioOf($, env), e.cwd);
    const fires = [HOOK.profile, HOOK.reloadGuard, HOOK.checkpoint, HOOK.feature].map((hook) => [hook, verdictOf(hook, opted)]);
    const contexts = await Promise.all([
      opted ? caught($, HOOK.profile, profileHook($, env, e)) : null,
      caught($, HOOK.reloadGuard, reloadPromptHook($, env, e)),
      opted ? caught($, HOOK.checkpoint, checkpointHook($, e)) : null,
      opted ? caught($, HOOK.feature, featureHook($, e)) : null,
    ]);
    await logFires($, env, 'UserPromptSubmit', e, fires);
    return withContext(await next(e), contexts.filter(Boolean));
  }).catch(passOn);

  on('classic.SubagentStart', { agent_type: /^workkit:/ }, async ($, e, next) => {
    const env = await envOf($);
    if (env.HOOK_DISABLE === '1') return next(e);
    const opted = await folderOpted(ioOf($, env), e.cwd);
    const context = opted ? await caught($, HOOK.addon, addonHook($, env, e)) : null;
    await logFires($, env, 'SubagentStart', e, [[HOOK.addon, verdictOf(HOOK.addon, opted)]]);
    return withContext(await next(e), context ? [context] : []);
  }).catch(passOn);

  on('classic.PreToolUse', { tool: ['Task', 'Agent'] }, async ($, e, next) => {
    const env = await envOf($);
    if (env.HOOK_DISABLE === '1') return next(e);
    const cwd = await sessionCwd($);
    const opted = await folderOpted(ioOf($, env), cwd);
    const warning = opted ? await caught($, HOOK.spawnGuard, spawnGuardHook($, env, e, cwd)) : null;
    await logFires($, env, 'PreToolUse', e, [[HOOK.spawnGuard, verdictOf(HOOK.spawnGuard, opted)]]);
    return withContext(await next(e), warning ? [warning] : []);
  }).catch(passOn);

  // tool.call carries no cwd: the folder is the session's, or the subagent's in a subagent.
  on('tool.call', { tool: 'Bash' }, ($, e, next) => guardChain($, e, next, 'tool.call', BASH_GUARDS,
    async () => ({ command: e.command ?? '', cwd: await $.session.cwd() }))).catch(failClosed);

  on('tool.call', { tool: ['Edit', 'Write'] }, ($, e, next) => guardChain($, e, next, 'tool.call', FILE_GUARDS, () => fileFacts($, e))).catch(failClosed);

  on('tool.call', { tool: ['Read', 'Grep'] }, ($, e, next) => guardChain($, e, next, 'tool.call', READ_GUARDS, () => fileFacts($, e))).catch(failClosed);

  // Never a block: a hook here acts after the command ran. A failed call fires
  // PostToolUseFailure instead, though a step before the failure may have landed.
  on('classic.PostToolUse', { tool_name: 'Bash' }, ($, e, next) => guardChain($, e, next, 'PostToolUse', POST_BASH_GUARDS,
    postBashFacts(e, false))).catch(passOn);

  on('classic.PostToolUseFailure', { tool_name: 'Bash' }, ($, e, next) => guardChain($, e, next, 'PostToolUseFailure', POST_BASH_GUARDS,
    postBashFacts(e, true))).catch(passOn);

  on('agent.spawn', async ($, e, next) => {
    const env = await envOf($);
    if (env.HOOK_DISABLE === '1') return next(e);
    const cwd = await sessionCwd($);
    const opted = await folderOpted(ioOf($, env), cwd);
    await logFires($, env, 'agent.spawn', e, [[HOOK.resolver, verdictOf(HOOK.resolver, opted)]]);
    // A resumed run or a fork keeps the model it has.
    if (!opted || e.resume || e.fork) return next(e);
    const decision = await caught($, HOOK.resolver, resolverHook($, env, e, cwd));
    if (!decision) return next(e);
    if (decision.isAdvise) return { deny: resolverAdvice(e.subagentType, decision.model) };
    return next({ ...e, model: decision.model });
  }).catch(($, e, next) => (next.called
    ? next(e)
    : { deny: 'manager:resolver failed before this spawn started; re-issue the Agent call.' }));

  // close-guard's warning reaches the owner alone, since a Stop context would
  // continue the turn; the change tracker's nag is a block, continuing it on purpose.
  on('classic.Stop', async ($, e, next) => {
    const env = await envOf($);
    if (env.HOOK_DISABLE === '1') return next(e);
    // One transcript read serves both gathers.
    let messages;
    const io = { ...ioOf($, env), messages: () => (messages ??= $.session.messages()) };
    const opted = await folderOpted(io, e.cwd);
    if (opted) await caught($, HOOK.closeGuard, closeGuardGather(io, env, e));
    const nag = opted ? await caught($, HOOK.changeTracker, changeTrackerGather(io, env, e)) : null;
    await logFires($, env, 'Stop', e, [HOOK.closeGuard, HOOK.changeTracker].map((hook) => [hook, verdictOf(hook, opted)]));
    return nag ? next(e).then((r) => ({ ...r, block: [nag.block, r?.block].filter(Boolean).join('\n\n') })) : next(e);
  }).catch(passOn);

  on('session.end', async ($, e, next) => {
    if ((await envOf($)).HOOK_DISABLE === '1') return next(e);
    await caught($, 'session.end', dropSessionKeys($, e.sessionId));
    return next(e);
  });
}
