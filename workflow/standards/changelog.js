/**
 * workflow/standards/changelog.js: the CHANGELOG heals: the retired linter
 * copies removed and the em dash separator converted once.
 * Usage: const { ensureChangelogSeparator, removeChangelogLinterCopies } = require('./standards/changelog');
 */

const fs = require('fs');
const path = require('path');
const { ok } = require('../lib/voice');
const { isFile } = require('../lib/lock');
const { writeWhole } = require('../lib/write');
const { LINTER_COPIES, workflowsRunCopy } = require('../changelog/job');
const { flag } = require('./flag');

// Built from its code, so this file holds none.
const EM_DASH = String.fromCharCode(0x2014);
// Any character but Unicode white space: a dash between two of them is inline.
const NOT_SPACE = '[^\\t\\n\\v\\f\\r \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const INLINE = new RegExp(`(?<=${NOT_SPACE})[ \\t]*${EM_DASH}[ \\t]*(?=${NOT_SPACE})`, 'g');
// Strict, so a file that is not UTF-8 is never decoded with a replacement character.
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

// A file's second line, or '' when it has none or cannot be read.
const secondLine = (file) => {
  try {
    return fs.readFileSync(file, 'utf8').split('\n')[1] ?? '';
  } catch {
    return '';
  }
};

/**
 * The CHANGELOG linter copy, retired: only a copy carrying the kit's vendor
 * header on line 2 is removed, and a copy a workflow still runs is kept and
 * reported. This runs after the caller's rewrite, so the checks.yml the heal
 * owns never runs a copy.
 * @param {object} run - the heal's run object (`root`, `needsAttention`)
 */
const removeChangelogLinterCopies = (run) => {
  for (const copy of LINTER_COPIES) {
    const file = path.join(run.root, copy);
    if (!isFile(file)) continue;
    if (!secondLine(file).startsWith('// Vendored')) {
      flag(run, `changelog lint: ${copy} is not the kit's copy; CI runs the kit's workflow now, so move or delete it by hand`);
      continue;
    }
    const runs = workflowsRunCopy(run.root, copy);
    if (runs === 0) {
      flag(run, `changelog lint: kept ${copy}: a workflow under .github/workflows still runs it; point that step at the kit's workflow and the next heal removes the copy`);
      continue;
    }
    // An unreadable folder cannot prove the copy unused, so it stays.
    if (runs !== 1) {
      flag(run, `changelog lint: kept ${copy}: .github/workflows could not be read, so nothing proves the copy unused`);
      continue;
    }
    try {
      fs.rmSync(file, { force: true });
    } catch {
      flag(run, `changelog lint: could not remove ${copy}`);
      continue;
    }
    ok(`changelog lint: removed ${copy}, CI runs the kit's workflow now; commit it`);
  }
};

/**
 * The CHANGELOG separator: a repo written before the no-em-dash rule is
 * converted once, prose and separator alike, and the linter then proves the
 * whole file. Inline, a spaced hyphen; at a line boundary, a bare hyphen in
 * place, so no newline is ever swallowed and a wrapped entry keeps its lines.
 * @param {object} run - the heal's run object (`root`, `needsAttention`)
 */
const ensureChangelogSeparator = (run) => {
  const name = 'CHANGELOG.md';
  const file = path.join(run.root, name);
  if (!isFile(file)) return;
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    return;
  }
  if (!bytes.includes(EM_DASH)) return;
  let text;
  try {
    text = UTF8.decode(bytes);
  } catch {
    flag(run, `changelog separator: ${name} is not valid UTF-8, so it is left as it is`);
    return;
  }
  const count = text.split(EM_DASH).length - 1;
  const { mode } = fs.statSync(file);
  try {
    writeWhole(file, text.replace(INLINE, ' - ').split(EM_DASH).join('-'), { mode: mode & 0o777 });
  } catch {
    flag(run, `changelog separator: could not convert ${name}; replace its em dashes with spaced hyphens by hand`);
    return;
  }
  ok(`changelog separator: converted ${count} em dashes in ${name} to spaced hyphens; commit it`);
};

module.exports = { ensureChangelogSeparator, removeChangelogLinterCopies };
