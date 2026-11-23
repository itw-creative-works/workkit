/**
 * workflow/standards/checks.js: the repo's checks.yml, the caller the kit owns,
 * rewritten whenever it differs from the template (changelog/job.js renders it),
 * each customization a replaced copy held named first.
 * Usage: const { ensureCiWorkflow } = require('./standards/checks');
 */

const fs = require('fs');
const path = require('path');
const { ok, skip } = require('../lib/voice');
const { nativePath } = require('../lib/platform');
const { isKitCheckout } = require('../lib/repo');
const { gitIn, defaultBranch } = require('../lib/git');
const { isFile } = require('../lib/lock');
const { readOrNull } = require('../lib/read');
const { writeWhole } = require('../lib/write');
const { CALLER } = require('../ship/caller');
const { TEMPLATE, checksRewrite } = require('../changelog/job');
const { flag } = require('./flag');

// A leaf path's keys are joined by the unit separator, a sequence item `[<i>]`.
const SEP = '\x1f';
const KEY = /^("[^"]*"|'[^']*'|[^ "'#][^:]*):([ \t]|$)/;
const BLOCK = /^[|>][-+0-9]*([ \t]+#.*)?$/s;
const QUOTED = /^".*"$|^'.*'$/s;
const SPACE_ONLY = /^[ \t\v\f\r]*$/;
const BLANK_OR_COMMENT = /^[ \t\v\f\r]*(#.*)?$/s;
// An old step's spaced dash reads as a comma; built from its code, so this file holds none.
const SPACED_DASH = ` ${String.fromCharCode(0x2014)} `;

// Each step a kit template carried, by name or else the action a nameless step
// uses, and its body there; `*` is the kit's whatever it holds, `!` retired.
const KNOWN = new Map([
  ['actions/checkout', 'uses=actions/checkout|run=|with=|env=|other='],
  ['actions/setup-node', 'uses=actions/setup-node|run=|with=node-version=lts/*|env=|other='],
  ['Configure git identity', 'uses=|run=git config --global user.name "checks"; git config --global user.email "checks@ci.local"|with=|env=|other='],
  ['Install dependencies', 'uses=|run=if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; elif [ -f package.json ]; then npm install --no-audit --no-fund; fi|with=|env=|other='],
  ['Test', 'uses=|run=if [ -f package.json ] && node -e "process.exit((require(\'./package.json\').scripts || {}).test ? 0 : 1)"; then npm test; else echo "no test script, nothing to check"; fi|with=|env=|other='],
  ['Check out the workkit kit\'s runner', '!'],
  ['CHANGELOG entry format', '*'],
]);

const indentOf = (s) => s.match(/^ */)[0].length;
const trim = (s) => s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
const unquote = (s) => {
  const t = trim(s);
  if (t.startsWith('#')) return '';
  return QUOTED.test(t) ? t.slice(1, -1) : t;
};
const cat = (a, b, sep) => (a === '' ? b : b === '' ? a : `${a}${sep}${b}`);

// A shell block's next line: "; " between commands, a space after a line that
// continues (then, do, else, an operator, a backslash).
const joinShell = (v, s) => {
  if (s === '' || s.startsWith('#')) return v;
  if (v === '') return s;
  if (v.endsWith('\\')) return `${v.slice(0, -1)} ${s}`;
  if (/(^|[ ;])(then|do|else)$/.test(v) || /(\{|&&|\|\||\|)$/.test(v)) return `${v} ${s}`;
  return `${v}; ${s}`;
};

/**
 * One `<path>\t<value>` line per key of a checks.yml, the path's keys joined
 * by \x1f, a sequence item `[<i>]`; a block scalar is one value, a shell block
 * joined into one line. Read without carriage returns.
 * @param {string} text - the workflow file
 * @returns {string[]}
 */
const checksLeaves = (text) => {
  const out = [];
  const keys = [];
  const indents = [];
  const count = new Map();
  let block = null;
  const pathOf = () => keys.join(SEP);
  const pop = (at) => {
    while (keys.length > 0 && indents[indents.length - 1] >= at) {
      keys.pop();
      indents.pop();
    }
  };
  const push = (key, at) => {
    keys.push(key);
    indents.push(at);
  };
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  lines: for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (block) {
      if (SPACE_ONLY.test(line)) continue;
      if (indentOf(line) > block.at) {
        block.value = joinShell(block.value, trim(line));
        continue;
      }
      out.push(`${block.path}\t${block.value}`);
      block = null;
    }
    if (BLANK_OR_COMMENT.test(line)) continue;
    let at = indentOf(line);
    let rest = line.slice(at);
    while (/^-([ \t]|$)/.test(rest)) {
      pop(at);
      const item = count.get(pathOf()) ?? 0;
      count.set(pathOf(), item + 1);
      push(`[${item}]`, at);
      rest = rest.slice(1);
      const gap = rest.match(/^[ \t]*/)[0].length;
      at += 1 + gap;
      rest = rest.slice(gap);
      if (rest === '') continue lines;
      if (!KEY.test(rest)) {
        out.push(`${pathOf()}\t${unquote(rest)}`);
        continue lines;
      }
    }
    if (!KEY.test(rest)) continue;
    let key = rest.replace(/:([ \t].*)?$/s, '');
    const value = trim(rest.slice(key.length + 1));
    if (QUOTED.test(key)) key = key.slice(1, -1);
    pop(at);
    push(key, at);
    if (BLOCK.test(value)) {
      block = { at, path: pathOf(), value: '' };
      continue;
    }
    out.push(`${pathOf()}\t${unquote(value)}`);
  }
  if (block) out.push(`${block.path}\t${block.value}`);
  return out;
};

/**
 * Each customization a checks.yml holds that the caller does not keep, in file
 * order: a step of the repo's own, a kit step changed, a trigger, filter, job
 * or workflow setting the caller lacks (one it holds at the same value is none).
 * @param {string} text - the repo's checks.yml
 * @param {string} branch - the repo's default branch
 * @returns {Array<[string, string]>} `[reason, what]` pairs, an empty what standing alone
 * @throws {Error} when the template cannot be read
 */
const checksKeptOut = (text, branch) => {
  const caller = new Set(checksLeaves(fs.readFileSync(TEMPLATE, 'utf8')));
  const out = [];
  const order = [];
  const reason = new Map();
  const label = new Map();
  const parts = new Map();
  const steps = new Map();
  let pbflow = '';
  let pbitems = '';
  let k = [];
  let np = 0;
  let v = '';
  const K = (i) => k[i] ?? '';
  const rel = (from) => {
    let r = '';
    for (let i = from; i <= np; i++) if (!K(i).startsWith('[')) r = cat(r, K(i), '.');
    return r;
  };
  const part = (from) => {
    const r = rel(from);
    return r === '' ? v : v === '' ? '' : `${r}=${v}`;
  };
  const open = (gid, why, what) => {
    if (reason.has(gid)) return;
    order.push(gid);
    reason.set(gid, why);
    label.set(gid, what);
  };
  const note = (gid, why, what, p) => {
    open(gid, why, what);
    parts.set(gid, cat(parts.get(gid) ?? '', p, ', '));
  };

  // The template triggers on pull_request and on push to the default branch; an
  // old copy ignoring a CHANGELOG-only push is none, as the release-push skip took
  // its place. Anything past that is named; the branches are judged whole at the end.
  const trigger = (t, from) => {
    if (t !== 'push' && t !== 'pull_request') {
      note(`on${SEP}${t}`, 'this trigger is not kept', t, np < from ? '' : part(from));
      return;
    }
    if (np < from) return;
    if (t === 'push' && K(from) === 'branches') {
      open('branches', 'this trigger filter is not kept', 'push.branches');
      if (np === from) pbflow = v;
      else pbitems = cat(pbitems, v, ', ');
      return;
    }
    if (t === 'push' && K(from) === 'paths-ignore' && ['[CHANGELOG.md]', 'CHANGELOG.md', ''].includes(v)) return;
    note(`on${SEP}${t}${SEP}${K(from)}`, 'this trigger filter is not kept', `${t}.${K(from)}`, part(from + 1));
  };
  const branches = () => {
    const val = pbflow !== '' ? pbflow : `[${pbitems}]`;
    if (val === `[${branch}]` || val === branch) return;
    out.push([reason.get('branches'), `${label.get('branches')}: ${val}`]);
  };
  const step = () => {
    const sid = `step${SEP}${K(2)}${SEP}${K(4)}`;
    if (!reason.has(sid)) {
      open(sid, '', '');
      steps.set(sid, { name: '', uses: '', run: '', with: '', env: '', other: '' });
    }
    const s = steps.get(sid);
    const f = K(5);
    if (f === 'name') s.name = v;
    else if (f === 'uses') s.uses = v;
    else if (f === 'run') s.run = v.split(SPACED_DASH).join(', ');
    else if (f === 'with') s.with = cat(s.with, part(6), ', ');
    else if (f === 'env') s.env = cat(s.env, part(6), ', ');
    else if (f !== '') s.other = cat(s.other, part(5), ', ');
  };
  const judge = (sid) => {
    const s = steps.get(sid);
    const act = s.uses.replace(/@.*/s, '');
    const id = s.name !== '' ? s.name : act;
    const known = KNOWN.get(id);
    if (known === '*') return;
    if (known === '!') {
      out.push(['the kit no longer clones itself; a repo whose tests need WORKKIT_ENGINE sets it in hooks.ciSetup', '']);
      return;
    }
    if (known === `uses=${act}|run=${s.run}|with=${s.with}|env=${s.env}|other=${s.other}`) return;
    let what = s.run !== '' ? s.run : `uses: ${s.uses}`;
    if (s.with !== '') what += ` (with: ${s.with})`;
    if (s.env !== '') what += ` (env: ${s.env})`;
    if (s.other !== '') what += ` (${s.other})`;
    const why = known !== undefined ? 'the kit\'s own step runs in place of this one'
      : s.uses !== '' ? 'a uses: step cannot run in the kit\'s CI; do its work as a command in hooks.ciSetup or hooks.ciPostInstall'
        : 'move this step into hooks.ciSetup, or into hooks.ciPostInstall when it needs the installed packages';
    out.push([why, `${s.name || s.uses || 'a nameless step'}: ${what}`]);
  };

  for (const line of checksLeaves(text)) {
    if (caller.has(line)) continue;
    const tab = line.indexOf('\t');
    v = line.slice(tab + 1);
    k = ['', ...line.slice(0, tab).split(SEP)];
    np = k.length - 1;
    if (K(1) === 'name' || (K(1) === 'jobs' && np < 3)) continue;
    if (K(1) === 'on') {
      if (np === 1) {
        v = v.replace(/^\[|\]$/g, '');
        for (const t of v.split(',').map(trim)) if (t !== '') trigger(t, 3);
      } else if (K(2).startsWith('[')) trigger(v, 3);
      else trigger(K(2), 3);
      continue;
    }
    if (K(1) !== 'jobs') {
      note(`wf${SEP}${K(1)}`, 'this workflow setting is not kept', K(1), part(2));
      continue;
    }
    if (K(3) === 'steps') {
      if (np >= 5) step();
      continue;
    }
    if (K(3) === 'name' || (K(3) === 'runs-on' && v === 'ubuntu-latest')
      || (K(3) === 'uses' && /^itw-creative-works\/workkit\/\.github\/workflows\/changelog\.yml@/.test(v))) continue;
    note(`job${SEP}${K(2)}${SEP}${K(3)}`, 'this job setting is not kept', `${K(2)}.${K(3)}`, part(4));
  }

  for (const gid of order) {
    if (gid.startsWith('step')) judge(gid);
    else if (gid === 'branches') branches();
    else out.push([reason.get(gid), `${label.get(gid)}${parts.get(gid) ? `: ${parts.get(gid)}` : ''}`]);
  }
  return out;
};

/**
 * The CI caller: the kit owns checks.yml, so any file that is not the rendered
 * caller is rewritten, and each customization it held is named, for
 * hooks.ciSetup, hooks.ciPostInstall or by hand.
 * @param {object} run - the heal's run object (`root`, `needsAttention`)
 */
const ensureCiWorkflow = (run) => {
  // The kit's own checks.yml runs its suite on Windows too and is no caller.
  if (isKitCheckout(run.root)) {
    skip(`checks: this is the workkit kit, whose ${CALLER} is its own`);
    return;
  }
  // A repo with no GitHub remote has no Actions to call.
  if (gitIn(run.root, ['remote', 'get-url', 'origin'], { stdio: 'ignore' }).status !== 0) {
    skip('checks: no origin remote, so no CI to call');
    return;
  }
  if (!isFile(TEMPLATE)) {
    flag(run, `checks: template missing at ${nativePath(TEMPLATE)}; reinstall the workflow core`);
    return;
  }
  const branch = defaultBranch(run.root);
  if (!branch) {
    flag(run, `checks: cannot tell the default branch (GitHub did not answer and origin/HEAD is unset), so ${CALLER} is left as it is; run \`git remote set-head origin -a\``);
    return;
  }
  const dest = path.join(run.root, CALLER);
  const rendered = checksRewrite(TEMPLATE, run.root);
  if (rendered.status !== 0) {
    flag(run, `checks: could not render the kit's caller from ${nativePath(TEMPLATE)}`);
    return;
  }
  const had = isFile(dest);
  const old = had ? readOrNull(dest) : null;
  if (old === rendered.text) {
    skip(`checks: ${CALLER} is the kit's caller`);
    return;
  }

  // A copy that cannot be read is kept, so nothing is dropped unnamed.
  let kept = [];
  if (had) {
    try {
      kept = old === null ? null : checksKeptOut(old, branch);
    } catch {
      kept = null;
    }
    if (kept === null) {
      flag(run, `checks: could not read ${CALLER}; kept it, so replace it with the kit's caller by hand`);
      return;
    }
  }
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    writeWhole(dest, rendered.text);
  } catch {
    flag(run, `checks: could not write ${CALLER}`);
    return;
  }
  if (!had) {
    ok(`checks: created ${CALLER}, the kit's caller; commit it so it runs on every pull request and push`);
    return;
  }
  ok(`checks: rewrote ${CALLER} to the kit's caller; commit it`);
  for (const [why, what] of kept) flag(run, `checks.yml: replaced by the kit's caller; ${why}${what ? `: ${what}` : ''}`);
};

module.exports = { ensureCiWorkflow };
