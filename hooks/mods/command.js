/**
 * hooks/mods/command.js: the command-text reads the Bash guards share: the
 * heredoc and quote strips, the `NAME=1` escape, the redirect `&` fold, the
 * prefix peel, the directory-change tests, the cd step, the step split and its
 * folder walk, the git-commit finder, the line-by-line test, and the origin
 * test that places a commit outside the pipeline. Plain functions over text;
 * the one that asks git takes `run`.
 */

/** The word a quoted span becomes under stripQuotes. */
export const PLACEHOLDER = '_hookq_';
const DIR_CHANGES = new Set(['cd', 'pushd', 'popd']);
const PEELED = new Set(['(', '{', '!', 'command', 'builtin', 'env', 'time', 'if', 'then', 'elif', 'else', 'do', 'while', 'until']);
const BARE_OPS = new Set(['>', '>>', '>|', '<', '<>', '<<', '<<-', '<<<']);
const INTERPRETER = /^(?:.*\/)?(?:sh|bash|zsh|dash|ksh)$/;
/** git's global options that take a separate value, so a walk never reads it as the subcommand. */
export const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);
const STAGING = new Set(['add', 'rm', 'mv', 'stage']);

// A heredoc feeding an interpreter, whose body is executed code (grep's lines).
const FED_HEREDOC = /(^|[^A-Za-z0-9_.-])(bash|sh|zsh|dash|ksh|eval|env)([ \t\r\f\v][^;&|\n]*)?<</m;
const HEREDOC_BODY = /(<<-?\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\2)[\s\S]*?\n[\t ]*\3[\t ]*(?=\n|$)/g;
const NAMES_DIR_CHANGE = /(^|[^A-Za-z0-9_.-])(cd|pushd|popd)([^A-Za-z0-9_.-]|$)/;
const BLANK_STEP = /^[ \t\n\r\f\v]*$/;

/**
 * The release subject's version, as a regex source: commit-language and
 * release-taken both read it, so one never accepts a release the other misses.
 */
export const VERSION_RE = 'v?[0-9]+\\.[0-9]+\\.[0-9]+([-+][0-9A-Za-z.-]+)?';

/** The blank class without the newline, `[[:space:]]` as grep reads a line, for a regex source. */
export const BLANK = '[ \\t\\v\\f\\r]';

/**
 * Whether any line of the text matches, as grep tries a pattern line by line.
 * @param {string} text the text
 * @param {RegExp} re the pattern
 * @returns {boolean}
 */
export const anyLine = (text, re) => text.split('\n').some((line) => re.test(line));

/**
 * A text's words, split on blanks and newlines, empties dropped.
 * @param {string} text the text
 * @returns {string[]}
 */
export const wordsOf = (text) => text.split(/[ \t\n]+/).filter(Boolean);
const isRedirectish = (word) => word.includes('>') || word.includes('<');

/**
 * How many times `needle` occurs in `text`, never overlapping.
 * @param {string} text the text
 * @param {string} needle what to count
 * @returns {number}
 */
export const count = (text, needle) => text.split(needle).length - 1;

/**
 * Whether a word is a short option cluster (`-f`, `-xfd`), never `-` or `--x`.
 * @param {string} word one word
 * @returns {boolean}
 */
export const isShortCluster = (word) => word.length > 1 && word[0] === '-' && word[1] !== '-';

/**
 * Whether a command word is git, by any path.
 * @param {string} word the command word
 * @returns {boolean}
 */
export const isGitWord = (word) => word === 'git' || word.endsWith('/git');

/**
 * Every quoted span perl's `\\.(*SKIP)(*FAIL)|"(?:[^"\\]|\\.)*"|'[^']*'`
 * matches, in order: a backslash outside a span keeps the character after it
 * literal, a double-quoted span honors backslash escapes, a single-quoted one
 * none, and an unclosed quote is one plain character.
 * @param {string} text the command text
 * @returns {Array<{start: number, end: number}>} each span, `end` exclusive
 */
function quotedSpans(text) {
  const spans = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length) {
      i += 2;
      continue;
    }
    const end = c === '"' ? closingDouble(text, i) : c === "'" ? text.indexOf("'", i + 1) : -1;
    if (end === -1) {
      i += 1;
      continue;
    }
    spans.push({ start: i, end: end + 1 });
    i = end + 1;
  }
  return spans;
}

// The closing quote of the double-quoted span opening at `open`, or -1.
function closingDouble(text, open) {
  let j = open + 1;
  while (j < text.length) {
    if (text[j] === '"') return j;
    if (text[j] === '\\') {
      if (j + 1 >= text.length) return -1;
      j += 2;
    } else {
      j += 1;
    }
  }
  return -1;
}

/**
 * The text with each heredoc body removed, since a body is file content. Off
 * entirely when a heredoc feeds an interpreter (`bash <<EOF`), whose body is
 * executed code; an unterminated heredoc stays visible.
 * @param {string} text the command text
 * @returns {string}
 */
export function stripHeredocs(text) {
  if (FED_HEREDOC.test(text)) return text;
  return text.replace(HEREDOC_BODY, '$1');
}

/**
 * Each quoted span as one placeholder word (`_hookq_`), an empty one deleted
 * (`git com""mit`), so a walk keeps its slots and a mention never reads as a
 * command.
 * @param {string} text the command text
 * @returns {string}
 */
export function stripQuotes(text) {
  let out = '';
  let at = 0;
  for (const { start, end } of quotedSpans(text)) {
    out += `${text.slice(at, start)}${end - start > 2 ? PLACEHOLDER : ''}`;
    at = end;
  }
  return `${out}${text.slice(at)}`;
}

/**
 * Whether `NAME=1` is set as an assignment on the command, the one home of
 * every escape's shape. Feed it quote-stripped text.
 * @param {string} text the quote-stripped command
 * @param {string} name the escape's variable (`WORKKIT_ALLOW_DISCARD`)
 * @returns {boolean}
 */
export function hasEscape(text, name) {
  return new RegExp(`(^|[^A-Za-z0-9_])${name}=1([^A-Za-z0-9_]|$)`, 'm').test(text);
}

/**
 * A redirect's `&` folded away (`>&` and `&>` to `>`, `<&` to `<`), so a split
 * on `;|&` never cuts a clause at a redirect.
 * @param {string} text the command text
 * @returns {string}
 */
export function foldRedirectAmp(text) {
  return text.split('>&').join('>').split('<&').join('<').split('&>').join('>');
}

/**
 * Whether a quote-stripped word is a shell redirect: `bare` when its target is
 * the next word (`>`, `2>`, `<<<`, `&>>`), `attached` when the word carries it
 * (`2>&1`, `>file`), else null.
 * @param {string} word one word
 * @returns {'bare'|'attached'|null}
 */
function redirectWord(word) {
  const fd = word.match(/^[0-9]*/)[0];
  let op = word.slice(fd.length);
  if (!fd && op.startsWith('&>')) op = op.slice(1);
  if (BARE_OPS.has(op)) return 'bare';
  return op.startsWith('>') || op.startsWith('<') ? 'attached' : null;
}

/**
 * How many words a redirect starting at this quote-stripped word spans: 2 bare,
 * 1 attached, 0 no redirect, so every walk skips it whole.
 * @param {string} word one word
 * @returns {number}
 */
export function redirectSpan(word) {
  const kind = redirectWord(word);
  return kind === 'bare' ? 2 : kind === 'attached' ? 1 : 0;
}

/**
 * The one prefix peel every command-word reader uses: `(`, `{`, `!`, command,
 * builtin, env, eval, time, NAME=v, a redirect, and if/then/elif/else/do/
 * while/until.
 * @param {string[]} words the clause's quote-stripped words
 * @returns {{skip: number, isEval: boolean, word: string}} the words skipped,
 *   whether eval was among them, and the command word (`(` and `\` off)
 */
export function peelPrefixes(words) {
  let skip = 0;
  let isEval = false;
  while (skip < words.length) {
    let head = words[skip];
    while (head.length > 1 && head[0] === '(') head = head.slice(1);
    if (head[0] === '\\') head = head.slice(1);
    if (PEELED.has(head) || /^[A-Za-z_].*=/s.test(head)) {
      skip += 1;
    } else if (head === 'eval') {
      isEval = true;
      skip += 1;
    } else if (isRedirectish(head) && redirectSpan(head) > 0) {
      skip = Math.min(skip + redirectSpan(head), words.length);
    } else {
      return { skip, isEval, word: head };
    }
  }
  return { skip, isEval, word: '' };
}

/**
 * Whether the clause, as its quote-stripped words, is a directory change: its
 * command word past the peeled prefixes is cd, pushd or popd.
 * @param {string[]} words the clause's quote-stripped words
 * @returns {boolean}
 */
export function clauseChangesDir(words) {
  return DIR_CHANGES.has(peelPrefixes(words).word);
}

/**
 * Whether the text names cd, pushd or popd as a word (a hash or a path
 * holding the letters is not one).
 * @param {string} text any command text
 * @returns {boolean}
 */
export function namesDirChange(text) {
  return NAMES_DIR_CHANGE.test(text);
}

/**
 * The word less one pair of surrounding quotes.
 * @param {string} word one word
 * @returns {string}
 */
export function unquoteWord(word) {
  const quoted = word.length > 1 && (word[0] === '"' || word[0] === "'") && word.at(-1) === word[0];
  return quoted ? word.slice(1, -1) : word;
}

/**
 * Whether a word is a shell that runs a -c string as code, by any path.
 * @param {string} word the command word
 * @returns {boolean}
 */
export function isInterpreter(word) {
  return INTERPRETER.test(word);
}

/**
 * The folder `dir` is after a step naming cd, pushd or popd: a cd past the
 * prefix peel to one plain folder moves it (absolute, or joined to `dir`, or
 * left relative when `dir` is the cwd's ''); any other form (pushd, popd, env
 * cd, a flag, ~, an expansion) leaves it `?`.
 * @param {string} dir '' for the cwd, a folder, or `?`
 * @param {string} step one quote-stripped step
 * @returns {string}
 */
export function cdStep(dir, step) {
  const words = step.split('\n')[0].split(/[ \t]+/).filter(Boolean);
  const { skip, word } = peelPrefixes(words);
  if (word !== 'cd' || words.slice(0, skip).includes('env') || words.length - skip !== 2) return '?';
  const arg = unquoteWord(words[skip + 1]);
  if (arg === '' || arg[0] === '-' || arg[0] === '~' || /[$`*?\\]/.test(arg)) return '?';
  if (arg.startsWith('/') || /^[A-Za-z]:\//.test(arg)) return arg;
  if (dir === '?') return '?';
  return dir === '' ? arg : `${dir}/${arg}`;
}

/**
 * The command's steps as events: `open` and `close` for a subshell's ( and ),
 * and each non-blank step between them, split on ; & | and newlines. Fold a
 * redirect's & away first.
 * @param {string} text the command text
 * @returns {Array<{kind: 'open'|'close'|'step', text?: string}>}
 */
export function cmdSteps(text) {
  const events = [];
  let step = '';
  const emit = () => {
    if (!BLANK_STEP.test(step)) events.push({ kind: 'step', text: step });
    step = '';
  };
  for (const c of text.replace(/\n+$/, '')) {
    if (c === '(' || c === ')') {
      emit();
      events.push({ kind: c === '(' ? 'open' : 'close' });
    } else if (c === ';' || c === '&' || c === '|' || c === '\n') {
      emit();
    } else {
      step += c;
    }
  }
  emit();
  return events;
}

/**
 * cmdSteps' steps, each with the folder it runs FROM (cdStep's value, '' for
 * the cwd): a step naming cd, pushd or popd moves the folder for the steps
 * after it, and a subshell's move is undone at its `)`.
 * @param {string} text the command text
 * @returns {Array<{dir: string, text: string}>}
 */
export function stepDirs(text) {
  const steps = [];
  const stack = [''];
  let depth = 0;
  for (const event of cmdSteps(text)) {
    if (event.kind === 'open') {
      depth += 1;
      stack[depth] = stack[depth - 1];
    } else if (event.kind === 'close') {
      if (depth > 0) depth -= 1;
    } else {
      steps.push({ dir: stack[depth], text: event.text });
      if (namesDirChange(event.text)) stack[depth] = cdStep(stack[depth], event.text);
    }
  }
  return steps;
}

// Does the Nth (0-based) non-empty quoted span of `src` carry git and commit as words?
function spanIsCommit(src, n) {
  const span = quotedSpans(src).filter(({ start, end }) => end - start > 2)[n];
  if (!span) return false;
  const text = src.slice(span.start, span.end);
  return /\bgit\b/.test(text) && /\bcommit\b/.test(text);
}

// An interpreter's arguments: does a -c string carry a commit? `ci` counts the
// placeholders already walked, so the span sits at ordinal pi+ci.
function interpreterWraps(args, src, pi, ci) {
  let expect = false;
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a.startsWith(PLACEHOLDER) || a[0] === '"' || a[0] === "'") return expect && spanIsCommit(src, pi + ci);
    if (isShortCluster(a)) {
      let cut = a.indexOf(PLACEHOLDER);
      if (cut === -1) cut = a.search(/["']/);
      if (cut !== -1) return a.slice(0, cut).endsWith('c') && spanIsCommit(src, pi + ci);
      if (a.includes('c')) expect = true;
      i += 1;
    } else if (a.startsWith('--')) {
      ci += count(a, PLACEHOLDER);
      i += 1;
    } else if (isRedirectish(a) && redirectSpan(a) > 0) {
      const n = Math.min(redirectSpan(a), args.length - i);
      ci += count(args.slice(i, i + n).join(' '), PLACEHOLDER);
      i += n;
    } else {
      return false;
    }
  }
  return false;
}

/**
 * git's subcommand past its global options, a value-taking one consuming its
 * value and a redirect skipped whole, and the words after it.
 * @param {string[]} args the quote-stripped words after `git`
 * @returns {{sub: string, rest: string[]}} '' and none when there is no subcommand
 */
export function gitSubcommand(args) {
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (GIT_VALUE_FLAGS.has(a)) {
      if (args.length - i < 2) break;
      i += 2;
    } else if (a[0] === '-') {
      i += 1;
    } else if (isRedirectish(a) && redirectSpan(a) > 0) {
      i += Math.min(redirectSpan(a), args.length - i);
    } else {
      return { sub: a, rest: args.slice(i + 1) };
    }
  }
  return { sub: '', rest: [] };
}

/**
 * A real `git ... commit` clause past the peeled prefixes.
 * @param {string} command the command text
 * @returns {{clause: string, sawCd: boolean, sawStage: boolean, wrapped: boolean}}
 *   the quote-stripped commit clause ('' for none), whether a cd, pushd or
 *   popd clause came first, whether add/rm/mv/stage came before the commit,
 *   and whether an `sh -c` or eval string carries one (read by position)
 */
export function findGitCommit(command) {
  const found = { clause: '', sawCd: false, sawStage: false, wrapped: false };
  const src = stripHeredocs(command);
  let pi = 0;
  for (const clause of foldRedirectAmp(stripQuotes(src)).split(/[;|&\n]/)) {
    const nc = count(clause, PLACEHOLDER);
    const words = wordsOf(clause);
    const { skip, isEval, word } = peelPrefixes(words);
    if (DIR_CHANGES.has(word)) found.sawCd = true;
    const ci = count(words.slice(0, skip).join(' '), PLACEHOLDER);
    const rest = words.slice(skip);
    if (rest.length > 0) rest[0] = word;
    const head = rest[0] ?? '';
    if (isEval && (head.startsWith(PLACEHOLDER) || head[0] === '"' || head[0] === "'")) {
      if (spanIsCommit(src, pi + ci)) found.wrapped = true;
    } else if (isInterpreter(head)) {
      if (interpreterWraps(rest.slice(1), src, pi, ci)) found.wrapped = true;
    } else if (isGitWord(head)) {
      const { sub } = gitSubcommand(rest.slice(1));
      if (STAGING.has(sub)) found.sawStage = true;
      if (sub === 'commit') return { ...found, clause };
    }
    pi += nc;
  }
  return found;
}

/**
 * `owner/repo` from a git remote URL or a local path in either separator,
 * null when it names none. The module's copy of slugFromRemote in
 * workflow/slug.js and wk_slug_from_remote in workflow/lib/slug.sh, shape for
 * shape, since a hooks module cannot import CommonJS: change all three together.
 * @param {string} url the remote
 * @returns {string|null}
 */
export function slugFromRemote(url) {
  if (!url) return null;
  const trimmed = url.trim().replace(/[/\\]+$/, '').replace(/\.git$/, '');
  const m = trimmed.match(/[:/\\]([^:/\\]+)[/\\]([^/\\]+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * The origin slug of the git working tree at `dir`, '' when it has none (the
 * engine's rule: wk_repo_slug).
 * @param {string} dir the folder
 * @param {function} run runs `(argv, { cwd })`, resolving `{ exitCode, stdout }`
 * @returns {Promise<string>}
 */
export async function repoSlug(dir, run) {
  const remote = await run(['git', 'remote', 'get-url', 'origin'], { cwd: dir });
  return remote.exitCode === 0 ? slugFromRemote(remote.stdout) ?? '' : '';
}

/**
 * Whether `cwd` is inside a git work tree with no origin: a scratch or fixture
 * repo, outside the pipeline. An empty cwd, or one in no repo, is not.
 * @param {string} cwd the folder the command runs in
 * @param {function} run runs `(argv, { cwd })`, resolving `{ exitCode, stdout }`
 * @returns {Promise<boolean>}
 */
export async function originless(cwd, run) {
  if (!cwd) return false;
  const inside = await run(['git', 'rev-parse', '--is-inside-work-tree'], { cwd });
  return inside.exitCode === 0 && (await repoSlug(cwd, run)) === '';
}
