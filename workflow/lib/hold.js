/**
 * workflow/lib/hold.js: the full-suite hold, CJS, judged where the root suite
 * runs (script-shell.js's bare root run, prove.js) and in the repo it runs in,
 * only where a Claude session's checks rule (sessionJudges).
 * Usage: const { suiteHold } = require('./hold');
 */

const { ioIn } = require('./io');
const { readOrNull } = require('./read');
const { suiteHolds, suiteRecordPath } = require('./records');
const { sayAs } = require('./say');
const { sessionJudges } = require('../../hooks/mods/gate.js');
const { buildingList } = require('../../hooks/mods/gh.js');
const { repoSlug } = require('../../hooks/mods/optin.js');
const { issuesAt } = require('../../hooks/mods/proof.js');
const { repoSettingsFile } = require('../../hooks/mods/settings.js');

const STAGE = 'status:building';
const NARROW = "Run the narrowest test that proves the change (`npm test -- <file>` from the package's folder)";

const say = sayAs('suite-hold');

/**
 * Whether the root suite may run: false on a tree the suite record already
 * proves, or while an issue is at status:building, each reason one line on
 * stderr. A tree that cannot be hashed skips the proved-tree check, said so;
 * a building list gh cannot answer skips the building hold, said so.
 * @param {string} root the repo root
 * @param {function(string): (string|null)} readTree the tree the run proves (`treeId`, `indexTreeId`),
 *   null or a throw when it cannot be taken; called only once the run is judged
 * @returns {Promise<boolean>}
 */
const suiteHold = async (root, readTree) => {
  if (!sessionJudges(process.env, readOrNull(repoSettingsFile(root)))) return true;
  let tree = null;
  try {
    tree = readTree(root);
  } catch {
    // A reader that throws (a temp folder treeId cannot make) is a tree that cannot be taken.
  }
  if (!tree) {
    say('the tree could not be hashed, so the proved-tree check did not run; the building hold still judges');
  } else if (await suiteHolds(root, tree)) {
    say(`this tree is already proved: the full suite ran green on it and ${await suiteRecordPath(root)} records it. ${NARROW}; the commit gate reads the same record for a commit whose staged tree matches it. Never set HOOK_DISABLE or clear CLAUDECODE to get past this hold.`);
    return false;
  }
  const { run } = ioIn(process.env);
  if (!(await repoSlug(root, run))) return true;
  const list = await buildingList(run, { cwd: root });
  const building = list === null ? null : issuesAt(list, STAGE);
  if (building === null) {
    say('could not read the open issues at status:building (gh could not answer), so the building hold did not run on this command.');
    return true;
  }
  if (building.length === 0) return true;
  const numbers = building.map((n) => `#${n} (${STAGE})`).join(', ');
  say(`the full suite runs once, at the commit, after every item in the tree is parked and passed; still building: ${numbers}. That work has to finish first: its tests green and its Proof: comment posted, then its own park moves it to status:qa. Never relabel an item, set HOOK_DISABLE or clear CLAUDECODE to get past this hold. ${NARROW}.`);
  return false;
};

module.exports = { suiteHold };
