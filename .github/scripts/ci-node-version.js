#!/usr/bin/env node
// .github/scripts/ci-node-version.js [repo]: the Node version ci.yml sets up for the repo, one
// `version=<answer>` line appended to the file GITHUB_OUTPUT names: its root .nvmrc, else its root
// .node-version, else lts/*. A file's value is its first line that is neither blank nor a comment,
// read as nvm reads it; no folder below the root is read.

const path = require('path');
const { readOrNull } = require('../../workflow/lib/read');
const { appendTo } = require('../../workflow/lib/step-value');

const FILES = ['.nvmrc', '.node-version'];
const FALLBACK = 'lts/*';

/**
 * A version file's value: its first line left once a CR, a trailing comment and the
 * spaces and tabs around it go; nvm's `v22` and `v22/*`, which setup-node does not take, read `22`.
 * @param {string} text - the file's text
 * @returns {string|null} null when every line is blank or a comment
 */
const versionOf = (text) => {
  const line = text.split('\n')
    .map((raw) => raw.replace(/\r$/, '').replace(/[ \t]*#.*$/s, '').replace(/^[ \t]+|[ \t]+$/g, ''))
    .find((value) => value !== '');
  if (line === undefined) return null;
  const nvm = /^v([0-9][0-9.]*)(\/\*)?$/.exec(line);
  return nvm ? nvm[1] : line;
};

/** The repo's version: the first version file's value, else FALLBACK. */
const versionIn = (repo) => {
  for (const file of FILES) {
    const text = readOrNull(path.join(repo, file));
    const version = text === null ? null : versionOf(text);
    if (version !== null) return version;
  }
  return FALLBACK;
};

const main = (argv) => appendTo('ci-node-version', 'GITHUB_OUTPUT', `version=${versionIn(argv[0] || '.')}\n`);

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
