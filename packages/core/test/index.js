// `workkit-core/test`: the test library's entry, the harness's exports (Node's
// case functions and every concern file's helpers). A CJS suite `require()`s
// it, an ES one imports it.

export * from './lib/harness.js';
