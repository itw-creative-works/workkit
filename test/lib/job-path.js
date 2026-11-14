// The PATH the scheduled jobs build for themselves, as the job suites see it:
// the folders the jobs' PATH line puts ahead of the PATH they are given, the
// skip values that line forces on a case, and the one line a job logs with no node on it.

const path = require('path');
const { SYSTEM_PATH, joinPath, which } = require('./platform');

// A case cannot empty these, so a machine keeping node in one cannot be node-less.
const JOB_PATH_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];

/** A node-less case's skip value: false when the job's own PATH line reaches no node, else the reason. */
const skipOnJobPathNode = () => {
  const node = which('node', joinPath(...JOB_PATH_DIRS, SYSTEM_PATH));
  return Boolean(node) && `this machine keeps node at ${node}, which the job's own PATH line reaches`;
};

/**
 * A bare-PATH case's skip value: false when the system PATH lacks /usr/local/bin, else the
 * reason. A world on the system tools shows /usr/local/bin only when the job adds it.
 */
const skipOnUsrLocalBin = () => SYSTEM_PATH.split(path.delimiter).includes('/usr/local/bin')
  && 'the system tools on this machine already live in /usr/local/bin';

// The one line a job logs when node is not reachable, naming the PATH it searched.
const NO_NODE_LINE = /node is not on this machine[’']s PATH: (\S[^\n]*)/g;

module.exports = { skipOnJobPathNode, skipOnUsrLocalBin, NO_NODE_LINE };
