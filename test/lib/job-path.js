// The PATH the scheduled jobs build for themselves, as the job suites see it:
// the skip value the jobs' PATH line forces on a case that hands them a bare one.

const path = require('path');
const { SYSTEM_PATH } = require('./platform');

/**
 * A bare-PATH case's skip value: false when the system PATH lacks /usr/local/bin, else the
 * reason. A world on the system tools shows /usr/local/bin only when the job adds it.
 */
const skipOnUsrLocalBin = () => SYSTEM_PATH.split(path.delimiter).includes('/usr/local/bin')
  && 'the system tools on this machine already live in /usr/local/bin';

module.exports = { skipOnUsrLocalBin };
