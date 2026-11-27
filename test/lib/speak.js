// The node a voice case speaks in: lines of workflow/lib/voice.js run in a node
// of their own, so the streams and the env are real. Consumers: test/scripts/voice-titles.test.js,
// test/scripts/lib-log.test.js, test/hooks/twins.test.js and test/hooks/workflow-standards/healing.test.js.

const path = require('path');
const { expect, mkTmp, run } = require('./harness');
const { SYSTEM_PATH, nodeHomeEnv, jsPath } = require('./platform');

const VOICE = path.join(__dirname, '..', '..', 'workflow', 'lib', 'voice.js');

/**
 * <lines> run after `const v = require(voice.js)`, in a node whose env holds <vars>,
 * color off unless they say otherwise, and a scratch home.
 * @param {string[]} lines - the source lines, run in order
 * @param {object} [vars] - the env over the PATH and WORKKIT_COLOR=0
 * @returns {{status: number, stdout: string, stderr: string}} the harness run's result, the node ended clean
 */
const speak = (lines, vars = {}) => {
  const res = run(process.execPath, ['-e', [`const v = require(${jsPath(VOICE)});`, ...lines].join('\n')], {
    env: nodeHomeEnv(mkTmp('speak-home-'), { PATH: SYSTEM_PATH, WORKKIT_COLOR: '0', ...vars }),
  });
  expect(res.status, `the node ends clean, stderr: ${res.stderr}`).toBe(0);
  return res;
};

module.exports = { speak, VOICE };
