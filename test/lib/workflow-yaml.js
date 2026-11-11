// The indent walk the workflow suites read their yml with: the kit has no YAML
// dependency, so a block is the lines indented under its key's line.

const indentOf = (line) => line.match(/^ */)[0].length;
const isComment = (line) => /^\s*#/.test(line);
// A line that carries YAML: neither blank nor a comment.
const isContent = (line) => line.trim() !== '' && !isComment(line);

// The lines nested under the key on line `at`: every later line indented
// deeper, blank and comment lines included, up to the first that is not.
const childrenOf = (all, at) => {
  const depth = indentOf(all[at]);
  const out = [];
  for (let i = at + 1; i < all.length; i++) {
    if (isContent(all[i]) && indentOf(all[i]) <= depth) break;
    out.push(all[i]);
  }
  return out;
};

const unquote = (word) => word.trim().replace(/^(['"])(.*)\1$/, '$2');

// The lines nested under the first `key:` line at `indent` within `lines`, the
// key line itself first; null when no such key.
const block = (lines, key, indent) => {
  const keyRe = new RegExp(`^ {${indent}}["']?${key.replace(/[.]/g, '\\.')}["']?:`);
  const at = lines.findIndex((line) => keyRe.test(line));
  return at === -1 ? null : [lines[at], ...childrenOf(lines, at)];
};

// The text after a key's colon on its own line, its comment stripped.
const inlineValue = (keyBlock) => keyBlock[0].replace(/\s#.*$/, '').split(':').slice(1).join(':').trim();

// A list value in either YAML spelling, `key: [a, b]` or `- a` lines below it.
const listValue = (keyBlock) => {
  const inline = inlineValue(keyBlock);
  if (inline.startsWith('[')) {
    return inline.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean);
  }
  return keyBlock.slice(1).filter(isContent).map((line) => unquote(line.trim().replace(/^- /, '')));
};

// The items of a block-style list of maps (a job's `steps:`), each its own lines
// with the leading `- ` blanked, so `block(item, key, indentOf(item[0]))` reads a key.
const listItems = (keyBlock) => {
  const first = keyBlock.slice(1).find(isContent);
  if (!first || !/^ *- /.test(first)) return [];
  const dash = new RegExp(`^ {${indentOf(first)}}- `);
  const items = [];
  for (const line of keyBlock.slice(1)) {
    if (dash.test(line)) items.push([line.replace('- ', '  ')]);
    else if (items.length) items[items.length - 1].push(line);
  }
  return items;
};

// The 1-based lines of a YAML text YAML refuses with "mapping values are not
// allowed": a `key: value` or `- key: value` whose plain value holds `: ` or
// ends in `:`, its comment aside. A `|` or `>` block's body is never judged.
const plainColonLines = (text) => {
  const out = [];
  let body = -1;
  text.split(/\r?\n/).forEach((line, i) => {
    if (body >= 0 && (line.trim() === '' || indentOf(line) > body)) return;
    body = -1;
    if (!isContent(line)) return;
    const m = line.match(/^( *(?:- +)?)(?:"[^"]*"|'[^']*'|[^\s'"#][^:]*?):(?: +(.*))?$/);
    if (!m) return;
    const value = (m[2] || '').replace(/(^|\s+)#.*$/, '');
    if (/^[|>][-+0-9]*$/.test(value)) body = m[1].length;
    else if (!/^['"|>[{&*!]/.test(value) && (value.includes(': ') || value.endsWith(':'))) out.push(i + 1);
  });
  return out;
};

module.exports = {
  indentOf, isComment, isContent, childrenOf, block, inlineValue, listValue, listItems, unquote,
  plainColonLines,
};
