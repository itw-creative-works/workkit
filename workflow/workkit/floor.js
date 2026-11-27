/**
 * workflow/workkit/floor.js: the Node floor the command checks before any other
 * piece loads: the floor read off the kit's root package.json, the line a Node
 * below it gets, and the code the command then ends with. Written in syntax an
 * older Node still reads, so the line prints there.
 * Usage: const { floorOf, floorLine, floorCode } = require('./floor');
 */

const fs = require('fs');
const path = require('path');

// The kit's root package.json, whose engines.node holds the floor.
const PACKAGE = path.join(__dirname, '..', '..', 'package.json');

/**
 * The floor as [major, minor], read off the root package.json's engines.node
 * (`>=22.22` gives [22, 22]); null for an engine copied without its kit's root.
 * @returns {number[]|null}
 * @throws {Error} a package.json that cannot be read, or names no floor
 */
const floorOf = () => {
  let text;
  try {
    text = fs.readFileSync(PACKAGE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const range = JSON.parse(text).engines.node;
  const match = /(\d+)\.(\d+)/.exec(range);
  if (!match) throw new Error(`workkit: ${PACKAGE} names no Node floor in engines.node (${range})`);
  return [Number(match[1]), Number(match[2])];
};

/**
 * The line a Node below <floor> gets, or '' at or above it (or with no floor).
 * A leading `v` and a suffix such as `-nightly...` are dropped before comparing.
 * @param {string} version the running Node's, `v22.21.0` or `22.21.0`
 * @param {number[]|null} floor floorOf's answer
 * @returns {string}
 */
const floorLine = (version, floor) => {
  if (!floor) return '';
  const parts = String(version).replace(/^v/, '').split('-')[0].split('.').map(Number);
  const below = parts[0] < floor[0] || (parts[0] === floor[0] && parts[1] < floor[1]);
  return below ? `workkit: this Node is ${version}; the kit needs ${floor[0]}.${floor[1]} or newer` : '';
};

/**
 * The code a stop at the floor ends with: 2 for `review covers` and `proof
 * red`, whose 1 means stale or green, else 1.
 * @param {string[]} argv the command's arguments
 * @returns {number}
 */
const floorCode = (argv) => {
  const sub = `${argv[0]} ${argv[1]}`;
  return sub === 'review covers' || sub === 'proof red' ? 2 : 1;
};

module.exports = { floorOf, floorLine, floorCode };
