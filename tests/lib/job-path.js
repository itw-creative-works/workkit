// The PATH the scheduled jobs build for themselves, as the job suites see it:
// the folders the jobs' PATH line puts ahead of the PATH they are given, the
// case gates that line forces, and the one line a job logs with no node on it.

const path = require('path');
const { testUnless } = require('./harness');
const { SYSTEM_PATH, joinPath, which } = require('./platform');

// A case cannot empty these, so a machine keeping node in one cannot be node-less.
const JOB_PATH_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];

const nodeOnJobPath = which('node', joinPath(...JOB_PATH_DIRS, SYSTEM_PATH));
const noNodeTest = testUnless(Boolean(nodeOnJobPath),
  `this machine keeps node at ${nodeOnJobPath}, which the job's own PATH line reaches`);

// A world on the system tools shows /usr/local/bin only when the job adds it; a
// machine whose jq or git lives there cannot tell.
const barePathTest = testUnless(SYSTEM_PATH.split(path.delimiter).includes('/usr/local/bin'),
  'the system tools on this machine already live in /usr/local/bin');

// The one line a job logs when node is not reachable, naming the PATH it searched.
const NO_NODE_LINE = /node is not on this machine[’']s PATH: (\S[^\n]*)/g;

module.exports = { noNodeTest, barePathTest, NO_NODE_LINE };
