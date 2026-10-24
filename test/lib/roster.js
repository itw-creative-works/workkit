// The machine roster a cross-repo hook reads (`~/.workkit/.repos.json`), as a
// scratch home. Consumers: the safety:proof-guard suites and the
// workflow:snapshot suite, each finding another repo's folder through it.

const fs = require('fs');
const path = require('path');
const { gitPath } = require('./platform');
const { mkTmp } = require('./scratch');

/**
 * A scratch home whose roster lists each folder with its state, keyed by the
 * root in git's spelling as the engine keys it.
 * @param {Array<[string, string]>} entries - folder and state (`enabled`, `declined`)
 * @returns {string} the home
 */
const mkRosterHome = (entries) => {
  const home = mkTmp('roster-home-');
  const repos = Object.fromEntries(entries.map(([dir, state]) => [gitPath(dir), state]));
  fs.mkdirSync(path.join(home, '.workkit'), { recursive: true });
  fs.writeFileSync(path.join(home, '.workkit', '.repos.json'), `${JSON.stringify({ version: 1, repos })}\n`);
  return home;
};

module.exports = { mkRosterHome };
