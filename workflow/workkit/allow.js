/**
 * workflow/workkit/allow.js: the allow and ask rules the kit keeps in the
 * global Claude settings, built from the command list, and the setup and
 * doctor steps that keep them there.
 * Usage: const { keepAllowRules, reportAllowRules } = require('./allow');
 */

const fs = require('fs');
const {
  ok, skip, warn, quiet,
} = require('../lib/voice');
const { nativePath } = require('../lib/platform');
const { editJson } = require('../lib/write');
const { isDir } = require('../lib/lock');
const { isCloud } = require('../lib/cloud');
const { commandsWith } = require('./command-list');
const { isPlain } = require('../../hooks/mods/settings.js');

const ruleOf = (command) => `Bash(workkit ${command}:*)`;

// Kept at permissions.allow: one rule per `allow` entry, then npm's publish the ship runs.
const ALLOW_RULES = [...commandsWith('allow').map(ruleOf), 'Bash(npm publish:*)'];

// Kept at permissions.ask, one rule per `ask` entry: an ask rule beats an
// allow rule, in auto mode too, so Claude Code asks at every such call.
const ASK_RULES = commandsWith('ask').map(ruleOf);

// Rules the kit once kept and every run takes out: the whole ship verb's rule
// let `workkit ship deploy` through with no prompt.
const RETIRED_ALLOW_RULES = ['Bash(workkit ship:*)'];

const settingsOf = (kit) => `${kit.claudeHome}/settings.json`;

/** jq's `x // []`: null, false and nothing read as an empty list. */
const orEmpty = (value) => (value === null || value === false || value === undefined ? [] : value);

/**
 * The list at permissions.<key> of the settings file, as jq's slurped read
 * takes it: exactly one JSON value, an object or null, whose permissions is an
 * object or null, holding a list or nothing at <key>; null for any other file.
 */
const listAt = (kit, key) => {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(settingsOf(kit), 'utf8'));
  } catch {
    return null;
  }
  if (value === null) return [];
  if (!isPlain(value)) return null;
  const permissions = value.permissions ?? null;
  if (permissions === null) return [];
  if (!isPlain(permissions)) return null;
  const have = orEmpty(permissions[key]);
  return Array.isArray(have) ? have : null;
};

/** The rules permissions.<key> lacks, in the list's order; all of them with no settings file; null when unreadable. */
const allowMissing = (kit, key, rules) => {
  if (rules.length === 0) return [];
  if (!fs.existsSync(settingsOf(kit))) return [...rules];
  const have = listAt(kit, key);
  return have === null ? null : rules.filter((rule) => !have.includes(rule));
};

/** The retired rules the settings file still holds; none when it is missing; null when unreadable. */
const allowRetired = (kit) => {
  if (!fs.existsSync(settingsOf(kit))) return [];
  const have = listAt(kit, 'allow');
  return have === null ? null : RETIRED_ALLOW_RULES.filter((rule) => have.includes(rule));
};

/**
 * The allow rules missing, the retired ones held and the ask rules missing,
 * or `{ bad }`, the key that holds no list.
 * @returns {{missing: string[], retired: string[], asks: string[]}|{bad: string}}
 */
const allowLists = (kit) => {
  const missing = allowMissing(kit, 'allow', ALLOW_RULES);
  if (missing === null) return { bad: 'allow' };
  const retired = allowRetired(kit);
  if (retired === null) return { bad: 'allow' };
  const asks = allowMissing(kit, 'ask', ASK_RULES);
  if (asks === null) return { bad: 'ask' };
  return { missing, retired, asks };
};

/** The command that puts the rules back: the cloud's setup is `--cloud`. */
const allowFix = (kit) => (isCloud(kit.env) ? 'workkit setup --cloud' : 'workkit setup');

/**
 * The settings value with the rules added and the retired ones taken out: an
 * allow list with nothing to add is assigned to itself, so its key stays in
 * place; an ask list only when it gains a rule.
 * @throws {Error} a value the edit cannot index
 */
const withRules = (value, { missing, retired, asks }) => {
  if (value !== null && !isPlain(value)) throw new Error('allow: the settings are not an object');
  const top = value ?? {};
  const old = top.permissions ?? null;
  if (old !== null && !isPlain(old)) throw new Error('allow: permissions is not an object');
  const allow = orEmpty(old?.allow);
  if (!Array.isArray(allow)) throw new Error('allow: permissions.allow is not a list');
  const permissions = { ...old, allow: [...allow.filter((rule) => !retired.includes(rule)), ...missing] };
  if (asks.length > 0) {
    const ask = orEmpty(permissions.ask);
    if (!Array.isArray(ask)) throw new Error('allow: permissions.ask is not a list');
    permissions.ask = [...ask, ...asks];
  }
  return { ...top, permissions };
};

/**
 * setup's step, inside machineLinks: the missing rules appended to
 * permissions.allow and permissions.ask in one write and the retired ones
 * taken out, every other key kept in its order, a file already right never
 * written. The quiet path makes no ~/.claude; a human's run may.
 * @param {object} kit
 * @returns {number} 0
 */
const keepAllowRules = (kit) => {
  const settings = settingsOf(kit);
  if (quiet() && !isDir(kit.claudeHome)) return 0;
  const lists = allowLists(kit);
  // Quiet under --auto: the daily run would repeat it every morning; a human's run and doctor still say it.
  if ('bad' in lists) {
    if (!quiet()) warn(`allow: ${nativePath(settings)} is not JSON with a list at permissions.${lists.bad}, so it was left as it is; fix it, then re-run \`${allowFix(kit)}\``);
    return 0;
  }
  const { missing, retired, asks } = lists;
  if (missing.length === 0 && asks.length === 0 && retired.length === 0) {
    skip(`allow: ${nativePath(settings)} holds the kit's allow rules`);
    return 0;
  }
  try {
    fs.mkdirSync(kit.claudeHome, { recursive: true });
  } catch { /* the write that follows warns */ }
  if (!editJson(settings, (value) => withRules(value, lists), { create: true })) return 0;
  if (missing.length > 0) ok(`allow: added ${missing.join(', ')} to ${nativePath(settings)}`);
  if (asks.length > 0) ok(`allow: added ${asks.join(', ')} to permissions.ask in ${nativePath(settings)}`);
  if (retired.length > 0) ok(`allow: took the retired ${retired.join(', ')} out of ${nativePath(settings)}`);
  return 0;
};

/**
 * doctor's lines: one warning per missing allow or ask rule and per retired
 * rule still held, each an item needing attention; nothing when the lists are right.
 * @param {object} kit
 * @returns {number} the count of rules warned, 1 for a file that holds no lists
 */
const reportAllowRules = (kit) => {
  const settings = settingsOf(kit);
  const fix = allowFix(kit);
  const lists = allowLists(kit);
  if ('bad' in lists) {
    warn(`allow: ${nativePath(settings)} is not JSON with a list at permissions.${lists.bad}, so the kit's allow rules cannot be read; fix it, then run \`${fix}\``);
    return 1;
  }
  for (const rule of lists.missing) warn(`allow: ${rule} is missing from ${nativePath(settings)}; run \`${fix}\``);
  for (const rule of lists.asks) warn(`allow: ${rule} is missing from permissions.ask in ${nativePath(settings)}; run \`${fix}\``);
  for (const rule of lists.retired) warn(`allow: ${rule} is a retired kit rule in ${nativePath(settings)}; run \`${fix}\` to take it out`);
  return lists.missing.length + lists.asks.length + lists.retired.length;
};

module.exports = {
  keepAllowRules, reportAllowRules,
};
