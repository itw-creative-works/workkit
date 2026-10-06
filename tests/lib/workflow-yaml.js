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

module.exports = { indentOf, isComment, isContent, childrenOf };
