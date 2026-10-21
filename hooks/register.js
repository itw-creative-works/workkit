/**
 * hooks/register.js: the workkit hooks module, the thirteen in-process hooks
 * on seven events (docs/hooks.md § The hooks module). The one file that
 * touches `$`: each hook's logic is plain functions in hooks/mods/<name>.js,
 * and this file gathers their facts, gates them, logs each fire and answers.
 */

import { addonContext, addonPath } from './mods/addon.js';
import { boardGuardVerdict } from './mods/board-guard.js';
import { changelogGuardVerdict, isChangelog } from './mods/changelog-guard.js';
import { checkpointContext } from './mods/checkpoint.js';
import { featureContext, featureMatch } from './mods/feature.js';
import { isExempt, settingsOptedIn } from './mods/gate.js';
import { appendLog, logLine, userDir } from './mods/log.js';
import { crewClass, isAdvise, managerConfig } from './mods/manager.js';
import { profileContext } from './mods/profile.js';
import { reloadFingerprint, reloadGuardContext } from './mods/reload-guard.js';
import { resolverAdvice, resolverModel } from './mods/resolver.js';
import { sessionGuardVerdict } from './mods/session-guard.js';
import { spawnGuardWarning } from './mods/spawn-guard.js';
import { standardsContext } from './mods/standards.js';
import { inboxCount, stateCheckContext } from './mods/state-check.js';
import { isCodePath, isTestPath, testReminderContext } from './mods/test-reminder.js';

// Each hook as settings and the hooks log name it.
const HOOK = {
  boardGuard: 'docs:board-guard',
  changelogGuard: 'docs:changelog-guard',
  sessionGuard: 'docs:session-guard',
  testReminder: 'safety:test-reminder',
  stateCheck: 'docs:state-check',
  standards: 'workflow:standards',
  reloadGuard: 'workflow:reload-guard',
  profile: 'manager:profile',
  checkpoint: 'docs:checkpoint',
  feature: 'workflow:feature',
  addon: 'manager:addon',
  resolver: 'manager:resolver',
  spawnGuard: 'manager:spawn-guard',
};

// The heal and the upkeep get process.run's ceiling, past the heal's worst case.
const HEAL_TIMEOUT_MS = 600000;
const GH_TIMEOUT_MS = 5000;
const INBOX_CACHE_MS = 30 * 60 * 1000;

// A path's folder; a drive root keeps its slash (`C:/`), so git never runs drive-relative.
const dirOf = (path) => {
  const cut = path.lastIndexOf('/');
  if (cut <= 0) return '/';
  return /^[A-Za-z]:$/.test(path.slice(0, cut)) ? path.slice(0, cut + 1) : path.slice(0, cut);
};
const homeOf = (env) => env.HOME || env.USERPROFILE || '';
const userDirOf = (env) => userDir(env.WORKFLOW_HOME, homeOf(env));
const verdictOf = (hook, opted) => (isExempt(hook) || opted ? 'run' : 'stood-down');
const pad = (n) => String(n).padStart(2, '0');
const localDay = (ms) => {
  const at = new Date(ms);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
};
const storeKey = (sid, name) => `workkit:${sid}:${name}`;
const failedRun = (err) => ({ exitCode: 1, stdout: '', stderr: String(err?.message ?? err), isStarted: false });
const quiet = (promise) => promise.catch(() => undefined);

// The written file, absolute and in one spelling, every backslash a slash (as
// hooks/lib/optin.sh spells it), so the mods see `C:/...` on Windows too; a
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

async function sha1Hex(text) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Every variable the module reads, once per dispatch; an unreadable one is unset.
async function envOf($) {
  const [
    HOOK_DISABLE, WORKFLOW_HOME, HOME, USERPROFILE, TMPDIR, WORKFLOW_DIR, WORKFLOW_CLAUDE_HOME,
    STATE_CHECK_CACHE, WORKFLOW_STANDARDS_CACHE, RELOAD_GUARD_ROOT,
    MANAGER_LADDER, MANAGER_USER_SETTINGS, MANAGER_DEBUG,
  ] = await Promise.all([
    quiet($.env.get('HOOK_DISABLE')), quiet($.env.get('WORKFLOW_HOME')), quiet($.env.get('HOME')),
    quiet($.env.get('USERPROFILE')), quiet($.env.get('TMPDIR')), quiet($.env.get('WORKFLOW_DIR')),
    quiet($.env.get('WORKFLOW_CLAUDE_HOME')), quiet($.env.get('STATE_CHECK_CACHE')),
    quiet($.env.get('WORKFLOW_STANDARDS_CACHE')), quiet($.env.get('RELOAD_GUARD_ROOT')),
    quiet($.env.get('MANAGER_LADDER')), quiet($.env.get('MANAGER_USER_SETTINGS')),
    quiet($.env.get('MANAGER_DEBUG')),
  ]);
  return {
    HOOK_DISABLE, WORKFLOW_HOME, HOME, USERPROFILE, TMPDIR, WORKFLOW_DIR, WORKFLOW_CLAUDE_HOME,
    STATE_CHECK_CACHE, WORKFLOW_STANDARDS_CACHE, RELOAD_GUARD_ROOT,
    MANAGER_LADDER, MANAGER_USER_SETTINGS, MANAGER_DEBUG,
  };
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

// The written file where it really is, as hooks/lib/optin.sh reads it: a
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

// The session's own folder. `agent.spawn`'s and the Agent tool's `cwd` is the
// subagent's override, never the session's, so those two handlers ask here.
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

// Each hook fails open on its own, the shell hooks' posture: the error goes to
// the debug log and the hook says nothing.
async function caught($, hook, work) {
  try {
    return await work;
  } catch (err) {
    $.ui.log(`${hook}: ${err?.message ?? err}`, { to: 'debug' });
    return null;
  }
}

/**
 * The gate: the repo holding `cwd` opted in (gate.js). An answer the module
 * cannot get is a no.
 * @param {object} $ the engine interface
 * @param {string} cwd the folder the hook acts on
 * @returns {Promise<boolean>}
 */
export async function optedIn($, cwd) {
  const root = await gitTop($, cwd);
  if (!root) return false;
  return settingsOptedIn(await readText($, `${root}/.workkit/settings.json`));
}

// The classic events whose input carries the session's folder as `cwd`.
const CARRIES_CWD = new Set(['PostToolUse', 'SessionStart', 'UserPromptSubmit', 'SubagentStart']);

/**
 * Writes one fire's line to the hooks log, the loader's line and cap: the one
 * writer every handler calls. It reads and rewrites the whole file, so two
 * sessions writing at once may lose a line (docs/hooks.md § The hooks log).
 * @param {object} $ the engine interface
 * @param {string} hook the hook (`docs:checkpoint`)
 * @param {string} event the event it fired on
 * @param {object} e the event's input, for its session and folder
 * @param {string} verdict `run` or `stood-down`
 * @returns {Promise<void>}
 */
export async function logFire($, hook, event, e, verdict) {
  try {
    const folder = CARRIES_CWD.has(event) ? e.cwd ?? '' : sessionCwd($);
    const [env, sid, cwd, at] = await Promise.all([envOf($), sessionId($, e), folder, now($)]);
    const iso = new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const path = `${userDirOf(env)}/hooks.log`;
    await $.fs.write(path, appendLog((await readText($, path)) ?? '', logLine(iso, hook, event, sid, cwd, verdict)));
  } catch {
    // A write that fails never stops the hook.
  }
}

// Each fire of a dispatch, in order: one read and one write apiece.
async function logFires($, event, e, fires) {
  for (const [hook, verdict] of fires) await logFire($, hook, event, e, verdict);
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

async function changelogGuardHook($, env, file, text) {
  if (!isChangelog(file) || text === null) return null;
  const linter = `${env.WORKFLOW_DIR || `${$.plugin.root}/workflow`}/changelog/changelog.js`;
  if (!(await exists($, linter))) return null;
  const lint = await run($, ['node', linter, file, '--added-only'], { cwd: dirOf(file) });
  // No node to run the linter, or a run past its timeout: the guard stands aside.
  return lint.isStarted === false ? null : changelogGuardVerdict(file, lint);
}

async function testReminderHook($, e, file) {
  if (!file || !(await exists($, file))) return null;
  const dir = dirOf(file);
  const [root, fileRoot] = await Promise.all([gitTop($, e.cwd || (await sessionCwd($))), gitTop($, dir)]);
  if (!root || root !== fileRoot) return null;
  const prefix = await run($, ['git', 'rev-parse', '--show-prefix'], { cwd: dir });
  if (prefix.exitCode !== 0) return null;
  const rel = `${prefix.stdout.trim()}${file.split('/').pop()}`;
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

async function inPluginCache($, env, engine) {
  const [kit, claudeHome] = await Promise.all([
    realPath($, `${engine}/..`), realPath($, env.WORKFLOW_CLAUDE_HOME || `${homeOf(env)}/.claude`),
  ]);
  if (!kit || !claudeHome || !kit.startsWith(`${claudeHome}/plugins/cache/`)) return false;
  try {
    return JSON.parse(await $.fs.read(`${kit}/.claude-plugin/plugin.json`)).name === 'workkit';
  } catch {
    return false;
  }
}

async function standardsHook($, env, e) {
  const engine = env.WORKFLOW_DIR || `${$.plugin.root}/workflow`;
  const cliLink = `${homeOf(env)}/.local/bin/workkit`;
  const isSetUp = await exists($, cliLink);
  const state = { isSetUp, cliLink, engine, isInCache: false, root: null, broken: null, offer: '' };
  if (!isSetUp) {
    state.engine = (await realPath($, engine)) ?? engine;
    state.isInCache = await inPluginCache($, env, engine);
  }
  state.root = await gitTop($, e.cwd);
  const { root } = state;
  if (!root) return standardsContext(state, null, null);
  const standards = `${engine}/standards.sh`;
  const manifest = `${engine}/labels.json`;
  // A broken install speaks once, only for a repo that said yes.
  let broken = null;
  if (!(await exists($, standards))) broken = `workflow engine not found at ${standards}. Reinstall the workkit plugin.`;
  else if ((await readText($, manifest)) === null) broken = `workflow manifest missing or unreadable at ${manifest}. Reinstall the workkit plugin.`;
  if (broken) {
    state.broken = settingsOptedIn(await readText($, `${root}/.workkit/settings.json`)) ? broken : null;
    return standardsContext(state, null, null);
  }
  // The engine owns the participation states; its answer is stdout's last line.
  const asked = await run($, ['bash', standards, '--state', root]);
  const participation = asked.exitCode === 0 ? asked.stdout.trimEnd().split('\n').pop() : 'nogit';
  if (participation === 'undecided') {
    state.offer = (await run($, ['bash', standards, '--announce', root])).stdout.trimEnd();
  }
  if (participation !== 'enabled') return standardsContext(state, null, null);
  const marker = `${env.WORKFLOW_STANDARDS_CACHE || `${homeOf(env)}/.claude/logs/workflow-standards`}/${await sha1Hex(root)}`;
  const today = localDay(await now($));
  if ((await readText($, marker)) === today) return standardsContext(state, null, null);
  // Only a clean heal caches the day, so a partial one retries next session.
  const heal = await run($, ['bash', standards, root], { env: { QUIET: '1' }, timeoutMs: HEAL_TIMEOUT_MS });
  if (heal.exitCode === 0) await quiet($.fs.write(marker, today));
  const cli = `${engine}/workkit.sh`;
  const update = (await exists($, cli)) ? await run($, ['bash', cli, 'update', '--auto'], { timeoutMs: HEAL_TIMEOUT_MS }) : null;
  return standardsContext(state, heal, update);
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
  const [agents, skills, mods, hooksJson] = await Promise.all([
    listed('agents'), listed('skills'), listed('hooks/mods'), readText($, `${root}/hooks/hooks.json`),
  ]);
  const paths = [
    ...agents.filter((f) => f.name.endsWith('.md')).map((f) => `agents/${f.name}`),
    ...skills.map((f) => `skills/${f.name}/SKILL.md`),
    'hooks/register.js',
    ...mods.filter((f) => f.name.endsWith('.js')).map((f) => `hooks/mods/${f.name}`),
  ];
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
    const path = `${env.TMPDIR || '/tmp'}/claude-manager-resolver.log`;
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

export function register(on) {
  on('classic.PostToolUse', { tool_name: ['Edit', 'Write'] }, async ($, e, next) => {
    const env = await envOf($);
    if (env.HOOK_DISABLE === '1') return next(e);
    const file = await physicalPath($, filePathOf(e));
    const opted = await optedIn($, file ? dirOf(file) : e.cwd);
    const fires = [];
    let block = null;
    let context = null;
    if (!opted) {
      for (const hook of [HOOK.boardGuard, HOOK.changelogGuard, HOOK.sessionGuard, HOOK.testReminder]) fires.push([hook, 'stood-down']);
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
        fires.push([HOOK.testReminder, 'run']);
        context = await caught($, HOOK.testReminder, testReminderHook($, e, file));
      }
    }
    await logFires($, 'PostToolUse', e, fires);
    const result = await next(e);
    if (block) return { ...result, block: [block, result?.block].filter(Boolean).join('\n\n') };
    return withContext(result, context ? [context] : []);
  }).catch(($, e, next) => (next.called
    ? next(e)
    : { block: 'workkit: the PostToolUse guards failed before they could judge this write; check the file by hand.' }));

  on('classic.SessionStart', async ($, e, next) => {
    const env = await envOf($);
    if (env.HOOK_DISABLE === '1') return next(e);
    const opted = await optedIn($, e.cwd);
    // The reload stamp is taken only where the session loads its surfaces.
    const stamps = e.source === 'startup' || e.source === 'resume';
    const fires = [[HOOK.stateCheck, verdictOf(HOOK.stateCheck, opted)], [HOOK.standards, 'run']];
    if (stamps) fires.push([HOOK.reloadGuard, 'run']);
    const contexts = await Promise.all([
      opted ? caught($, HOOK.stateCheck, stateCheckHook($, env, e)) : null,
      caught($, HOOK.standards, standardsHook($, env, e)),
      stamps ? caught($, HOOK.reloadGuard, reloadStampHook($, env, e)) : null,
    ]);
    await logFires($, 'SessionStart', e, fires);
    return withContext(await next(e), contexts.filter(Boolean));
  }).catch(passOn);

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const env = await envOf($);
    if (env.HOOK_DISABLE === '1') return next(e);
    const opted = await optedIn($, e.cwd);
    const fires = [HOOK.profile, HOOK.reloadGuard, HOOK.checkpoint, HOOK.feature].map((hook) => [hook, verdictOf(hook, opted)]);
    const contexts = await Promise.all([
      opted ? caught($, HOOK.profile, profileHook($, env, e)) : null,
      caught($, HOOK.reloadGuard, reloadPromptHook($, env, e)),
      opted ? caught($, HOOK.checkpoint, checkpointHook($, e)) : null,
      opted ? caught($, HOOK.feature, featureHook($, e)) : null,
    ]);
    await logFires($, 'UserPromptSubmit', e, fires);
    return withContext(await next(e), contexts.filter(Boolean));
  }).catch(passOn);

  on('classic.SubagentStart', { agent_type: /^workkit:/ }, async ($, e, next) => {
    const env = await envOf($);
    if (env.HOOK_DISABLE === '1') return next(e);
    const opted = await optedIn($, e.cwd);
    const context = opted ? await caught($, HOOK.addon, addonHook($, env, e)) : null;
    await logFires($, 'SubagentStart', e, [[HOOK.addon, verdictOf(HOOK.addon, opted)]]);
    return withContext(await next(e), context ? [context] : []);
  }).catch(passOn);

  on('classic.PreToolUse', { tool: ['Task', 'Agent'] }, async ($, e, next) => {
    const env = await envOf($);
    if (env.HOOK_DISABLE === '1') return next(e);
    const cwd = await sessionCwd($);
    const opted = await optedIn($, cwd);
    const warning = opted ? await caught($, HOOK.spawnGuard, spawnGuardHook($, env, e, cwd)) : null;
    await logFires($, 'PreToolUse', e, [[HOOK.spawnGuard, verdictOf(HOOK.spawnGuard, opted)]]);
    return withContext(await next(e), warning ? [warning] : []);
  }).catch(passOn);

  on('agent.spawn', async ($, e, next) => {
    const env = await envOf($);
    if (env.HOOK_DISABLE === '1') return next(e);
    const cwd = await sessionCwd($);
    const opted = await optedIn($, cwd);
    await logFires($, 'agent.spawn', e, [[HOOK.resolver, verdictOf(HOOK.resolver, opted)]]);
    // A resumed run or a fork keeps the model it has.
    if (!opted || e.resume || e.fork) return next(e);
    const decision = await caught($, HOOK.resolver, resolverHook($, env, e, cwd));
    if (!decision) return next(e);
    if (decision.isAdvise) return { deny: resolverAdvice(e.subagentType, decision.model) };
    return next({ ...e, model: decision.model });
  }).catch(($, e, next) => (next.called
    ? next(e)
    : { deny: 'manager:resolver failed before this spawn started; re-issue the Agent call.' }));

  on('session.end', async ($, e, next) => {
    if ((await envOf($)).HOOK_DISABLE === '1') return next(e);
    await caught($, 'session.end', dropSessionKeys($, e.sessionId));
    return next(e);
  });
}
