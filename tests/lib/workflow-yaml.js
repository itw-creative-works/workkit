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

// A list value in either YAML spelling, `key: [a, b]` or `- a` lines below it.
const listValue = (keyBlock) => {
  const inline = keyBlock[0].replace(/\s#.*$/, '').split(':').slice(1).join(':').trim();
  if (inline.startsWith('[')) {
    return inline.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean);
  }
  return keyBlock.slice(1).filter(isContent).map((line) => unquote(line.trim().replace(/^- /, '')));
};

module.exports = { indentOf, isComment, isContent, childrenOf, block, listValue };
