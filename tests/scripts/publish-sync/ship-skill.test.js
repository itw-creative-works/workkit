//
// Tests for skills/ship/SKILL.md: the ship skill's publish and setup clauses
// (the command each runs, the diff paths that trigger it, and the permission
// to run it).
// The shared prologue (the fixture app, the sync and publish worlds, the library and publish runners, the file writers) is ./helpers.js.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { group, test, assert, summary, selfRun } = require('../../lib/harness');
const { REPO_ROOT, cleanup } = require('./helpers');

const run = async () => {
  group('the ship skill');

  await test('ship republishes the dashboard when the diff touched it', () => {
    const skill = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'ship', 'SKILL.md'), 'utf8');
    assert(/workkit publish/.test(skill), 'the ship skill knows the command');
    assert(/tower\/app/.test(skill), 'and what in the diff triggers it');
    assert(/Bash\(workkit publish \*\)/.test(skill), 'and is allowed to run it');
    cleanup(path.join(os.tmpdir(), 'nothing'));
  });

  await test('ship re-runs setup when the diff touched the setup surface (#235)', () => {
    const skill = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'ship', 'SKILL.md'), 'utf8');
    assert(/workkit setup/.test(skill), 'the ship skill knows the command');
    for (const file of ['workflow/workkit.sh', 'workflow/home.sh', 'workflow/publish.sh', 'workflow/standards.sh', 'workflow/<name>/', 'jobs/', 'hooks/']) {
      assert(skill.includes('`' + file + '`'), `and names ${file} as a trigger`);
    }
    assert(/Bash\(workkit setup \*\)/.test(skill), 'and is allowed to run it');
    assert(/REPLACES the separate `workkit publish`/.test(skill), 'and one run covers both clauses');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
