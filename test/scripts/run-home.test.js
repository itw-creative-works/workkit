// The one Node home for starting a program: no shipped file but workflow/lib/run.js
// and the published runner imports child_process, and the root test/ files that
// still do are named below, a list a file only ever leaves.

const fs = require('fs');
const path = require('path');
const { describe, test, expect, SPAWN_DEADLINE } = require('../lib/harness');
const { execFileSync } = require('../lib/platform');

const ROOT = path.join(__dirname, '..', '..');
const RUN_HOME = 'workflow/lib/run.js';
const SOURCE = /\.(js|mjs|cjs|ts)$/;
const TEST_SIDE = /^test\//;
// The workkit-core runner cannot require the kit's run.js: its pack makes run.cjs, which the source tree lacks.
const PUBLISHED_RUNNER = ['packages/core/test/run.js', 'packages/core/test/lib/spawn.js'];
const IMPORTS = /(?:require\s*\(\s*|from\s+|import\s*\(\s*)['"](?:node:)?child_process['"]/;

// The test-side files importing child_process today. The list only shrinks.
const STILL_IMPORTING = [
  'test/hooks/capture-guard/user-level.test.js',
  'test/hooks/changelog-guard.test.js',
  'test/hooks/commit-gate/helpers.js',
  'test/hooks/commit-gate/marker.test.js',
  'test/hooks/lib-record.test.js',
  'test/hooks/lib.test.js',
  'test/hooks/proof-guard/qa-reads.test.js',
  'test/hooks/release-taken/helpers.js',
  'test/hooks/test-bar.test.js',
  'test/hooks/twins.test.js',
  'test/hooks/workflow-snapshot.test.js',
  'test/hooks/workflow-standards/healing.test.js',
  'test/hooks/workflow-standards/helpers.js',
  'test/jobs/brief-dispatch.test.js',
  'test/jobs/brief-payload/helpers.js',
  'test/jobs/brief-payload/printed.test.js',
  'test/jobs/brief-payload/upstream-news.test.js',
  'test/jobs/claude-nightly.test.js',
  'test/jobs/install.test.js',
  'test/jobs/morning-cloud/helpers.js',
  'test/jobs/morning-cloud/machine.test.js',
  'test/jobs/morning-cloud/runner-skips.test.js',
  'test/jobs/morning-local/cloud-brief.test.js',
  'test/jobs/morning-local/cloud-runner.test.js',
  'test/jobs/morning-local/helpers.js',
  'test/jobs/morning-local/sending-folder.test.js',
  'test/jobs/nightly-payload.test.js',
  'test/lib/gh-stub.js',
  'test/lib/gh-world.js',
  'test/lib/git-repo.js',
  'test/lib/hook-lib.js',
  'test/lib/identity.js',
  'test/lib/platform.js',
  'test/lib/red-snapshot.js',
  'test/lib/script-shell.js',
  'test/lib/suite-record.js',
  'test/runner.test.js',
  'test/scripts/changelog-job.test.js',
  'test/scripts/changelog-links/helpers.js',
  'test/scripts/changelog-lint.test.js',
  'test/scripts/changelog.test.js',
  'test/scripts/ci-watch.test.js',
  'test/scripts/detach.test.js',
  'test/scripts/githooks.test.js',
  'test/scripts/home/clone-heal.test.js',
  'test/scripts/home/clone.test.js',
  'test/scripts/home/cloud-runner.test.js',
  'test/scripts/home/doctor.test.js',
  'test/scripts/home/helpers.js',
  'test/scripts/home/seed.test.js',
  'test/scripts/home/shape-states.test.js',
  'test/scripts/home/version-stamp.test.js',
  'test/scripts/home/wizard-forced.test.js',
  'test/scripts/home/wizard-pages.test.js',
  'test/scripts/home/wizard-second.test.js',
  'test/scripts/home/wizard-setup.test.js',
  'test/scripts/identity/gh-shim.test.js',
  'test/scripts/identity/login.test.js',
  'test/scripts/identity/token.test.js',
  'test/scripts/lib-log.test.js',
  'test/scripts/mint-pty.test.js',
  'test/scripts/participation.test.js',
  'test/scripts/platform.test.js',
  'test/scripts/public/helpers.js',
  'test/scripts/publish-plan.test.js',
  'test/scripts/publish-sync/helpers.js',
  'test/scripts/publish-sync/pipeline-partial.test.js',
  'test/scripts/publish-sync/pipeline-sync.test.js',
  'test/scripts/publish/build.test.js',
  'test/scripts/publish/helpers.js',
  'test/scripts/publish/published-branch.test.js',
  'test/scripts/publish/shape-refusals.test.js',
  'test/scripts/publish/switches.test.js',
  'test/scripts/red-proof.test.js',
  'test/scripts/release-push.test.js',
  'test/scripts/review-covers.test.js',
  'test/scripts/script-shell-detached.test.js',
  'test/scripts/ship-hooks.test.js',
  'test/scripts/ship-items.test.js',
  'test/scripts/site-repos.test.js',
  'test/scripts/slug.test.js',
  'test/scripts/suite-hold.test.js',
  'test/scripts/wk.test.js',
  'test/scripts/workflow-standards/changelog-job.test.js',
  'test/scripts/workflow-standards/command-link.test.js',
  'test/scripts/workflow-standards/engine-address.test.js',
  'test/scripts/workflow-standards/githooks.test.js',
  'test/scripts/workflow-standards/gitignore.test.js',
  'test/scripts/workflow-standards/helpers.js',
  'test/scripts/workflow-standards/hook-check.test.js',
  'test/scripts/workflow-standards/loud-failures.test.js',
  'test/scripts/workflow-standards/offline.test.js',
  'test/scripts/workflow-standards/participation.test.js',
  'test/scripts/workflow-standards/roster.test.js',
  'test/scripts/workflow-standards/stamp-removal.test.js',
  'test/scripts/workkit-cli/cache.test.js',
  'test/scripts/workkit-cli/helpers.js',
  'test/scripts/workkit-cli/map.test.js',
  'test/scripts/workkit-cli/test-verb.test.js',
  'test/scripts/workspaces.test.js',
  'test/spawn.test.js',
  'test/tower/health.test.js',
  'test/tower/log.test.js',
  'test/tower/repos.test.js',
  'test/tower/server/helpers.js',
];

/**
 * One line per file that breaks the rule, each naming its file.
 * @param {string[]} files - repo-relative, slashed
 * @param {(file: string) => string} read - a file's text
 * @param {string[]} listed - the test-side files still allowed the import
 * @returns {string[]}
 */
const faultsOf = (files, read, listed) => {
  const importers = new Set(files.filter((f) => SOURCE.test(f) && IMPORTS.test(read(f))));
  const faults = [];
  for (const f of [...importers].sort()) {
    if (f === RUN_HOME || PUBLISHED_RUNNER.includes(f)) continue;
    if (!TEST_SIDE.test(f)) faults.push(`${f}: starts a program through child_process; use ${RUN_HOME}`);
    else if (!listed.includes(f)) faults.push(`${f}: imports child_process; start its child through test/lib/platform.js`);
  }
  for (const f of listed) {
    if (!importers.has(f)) faults.push(`${f}: no longer imports child_process; take it off the list`);
  }
  return faults;
};

/** A fake tree: `texts` maps each file to its text. */
const treeOf = (texts) => [Object.keys(texts), (f) => texts[f]];

// The module's name apart from the import shape, so the fixtures never read as this file's own import.
const CP = 'child_process';
const USES = `const { spawnSync } = require('${CP}');\n`;

describe('run-home: the check on a fixture tree', () => {
  test('a shipped file importing child_process fails, naming it', () => {
    const [files, read] = treeOf({ 'workflow/ship/cut.js': USES, 'workflow/lib/io.js': "require('./run');\n" });
    const faults = faultsOf(files, read, []);
    expect(faults.length, `one fault, got: ${faults.join(' | ')}`).toBe(1);
    expect(faults[0].startsWith('workflow/ship/cut.js:'), `it names the file, got: ${faults[0]}`).toBeTruthy();
  });

  test('a shipped file under a package test/ folder is no test file: importing child_process fails, naming it', () => {
    const [files, read] = treeOf({ 'packages/core/test/lib/other.js': USES });
    const faults = faultsOf(files, read, []);
    expect(faults.length, `one fault, got: ${faults.join(' | ')}`).toBe(1);
    expect(faults[0].startsWith('packages/core/test/lib/other.js: starts a program'), `it names the file as shipped, got: ${faults[0]}`).toBeTruthy();
  });

  test('the published runner\'s two files import child_process and pass', () => {
    const [files, read] = treeOf({ 'packages/core/test/run.js': USES, 'packages/core/test/lib/spawn.js': USES });
    expect(faultsOf(files, read, []).join(' | '), 'the named exception').toBe('');
  });

  test('run.js itself imports child_process and passes', () => {
    const [files, read] = treeOf({ [RUN_HOME]: USES });
    expect(faultsOf(files, read, []).join(' | '), 'the one home is allowed the import').toBe('');
  });

  test('a test file importing child_process off the list fails, naming it; a listed one passes', () => {
    const [files, read] = treeOf({ 'test/scripts/new.test.js': `import { spawn } from 'node:${CP}';\n`, 'test/lib/old.js': USES });
    const faults = faultsOf(files, read, ['test/lib/old.js']);
    expect(faults.length, `one fault, got: ${faults.join(' | ')}`).toBe(1);
    expect(faults[0].startsWith('test/scripts/new.test.js:'), `it names the new file, got: ${faults[0]}`).toBeTruthy();
  });

  test('a listed test file that no longer imports child_process fails, naming it', () => {
    const [files, read] = treeOf({ 'test/lib/old.js': "const { spawnSync } = require('../lib/platform');\n" });
    const faults = faultsOf(files, read, ['test/lib/old.js']);
    expect(faults.length, `one fault, got: ${faults.join(' | ')}`).toBe(1);
    expect(faults[0].startsWith('test/lib/old.js:'), `it names the listed file, got: ${faults[0]}`).toBeTruthy();
  });
});

describe('run-home: the check on this tree', () => {
  test('every file git tracks or would add keeps to the rule', () => {
    // Untracked files git does not ignore too, so a new file is caught before its commit.
    const listed = (...args) => execFileSync('git', ['ls-files', '-z', ...args], { cwd: ROOT, encoding: 'utf8', timeout: SPAWN_DEADLINE })
      .split('\0');
    const files = [...listed(), ...listed('--others', '--exclude-standard')].filter((f) => f && fs.existsSync(path.join(ROOT, f)));
    const faults = faultsOf(files, (f) => fs.readFileSync(path.join(ROOT, f), 'utf8'), STILL_IMPORTING);
    expect(faults.join('\n'), 'no file starts a program around run.js').toBe('');
  });
});
