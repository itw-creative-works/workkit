// The two Node fakes the floor and start-count suites share: the preload that
// makes a node read as older than the kit's floor, and a `node` for the front of
// a PATH that records each start and then runs the suite's own node.

const fs = require('fs');
const path = require('path');
const { mkTmp } = require('./harness');
const { jsPath, stubToolJs, handOverJs } = require('./platform');
const { recordArgvJs } = require('./argv-log');

/**
 * A file that, preloaded (`node -r`, or NODE_OPTIONS' `--require`), makes the
 * node read as v<version> to every line it runs: a Node below the kit's floor,
 * with no second Node installed.
 * @param {string} version - e.g. '20.15.1'
 * @param {string} [dir] - the folder it goes in, a scratch one by default
 * @returns {string} the preload's path
 */
const olderNode = (version, dir = mkTmp('wk-older-node-')) => {
  fs.mkdirSync(dir, { recursive: true });
  const preload = path.join(dir, 'older.js');
  fs.writeFileSync(preload, [
    `Object.defineProperty(process, 'version', { value: 'v${version}' });`,
    `Object.defineProperty(process, 'versions', { value: { ...process.versions, node: '${version}' } });`,
  ].join('\n'));
  return preload;
};

/**
 * A `node` at `<dir>/node`: it appends each start's arguments to `log` when one
 * is given (readArgv reads them back), then hands them to this suite's node
 * (handOverJs) and ends as it did. A `preload` is loaded first, into that node alone, or by
 * NODE_OPTIONS into every node under it with `everyNode`; `older` (a version,
 * e.g. '20.15.1') is olderNode's preload, written into `dir`.
 * @param {string} dir - the folder, made when missing
 * @param {{ log?: string, preload?: string, everyNode?: boolean, older?: string }} [options]
 * @returns {string} the folder, for the front of a PATH
 */
const recordingNode = (dir, { log, preload: given, everyNode = false, older } = {}) => {
  fs.mkdirSync(dir, { recursive: true });
  const preload = older ? olderNode(older, dir) : given;
  stubToolJs(dir, 'node', [
    ...(log ? [recordArgvJs(jsPath(log))] : []),
    // The hand-over starts its node under this process's env, so a NODE_OPTIONS set here reaches every node below.
    ...(preload && everyNode ? [`process.env.NODE_OPTIONS = ${JSON.stringify(`--require ${jsPath(preload)}`)};`] : []),
    handOverJs(process.execPath, preload && !everyNode ? ['-r', preload] : []),
  ].join('\n'));
  return dir;
};

module.exports = { olderNode, recordingNode };
