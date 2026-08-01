//
// Tests for workflow/site-repos.js — the roster the published site sweeps.
//
// The fixtures are a scratch ~/.workkit and real git repos with real `origin`
// remotes, the same shape the roster read itself is tested against: what a slug
// is, is a question only git answers.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');

const { composeSlugs, writeSlugs } = require(path.join(__dirname, '..', '..', 'workflow', 'site-repos.js'));

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'workkit-site-repos-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * A ~/.workkit fixture. `repos` is a list of folder names, each made a real
 * opted-in repo with an origin; `roster` overrides the roster file entirely (a
 * string is written raw, `null` writes none at all).
 */
const mkWorkflowHome = (root, repos = [], { homeSlug = 'owner/workkit', roster } = {}) => {
  const dir = path.join(root, 'workflow-home');
  fs.mkdirSync(dir, { recursive: true });

  const registered = {};
  for (const name of repos) {
    const repo = path.join(root, 'repos', name);
    fs.mkdirSync(path.join(repo, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.workkit', 'settings.json'), '{ "version": 1, "enabled": true }\n');
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'remote', 'add', 'origin', `https://github.com/owner/${name}.git`);
    registered[repo] = { registered: '2026-07-30' };
  }

  if (roster === null) {
    fs.rmSync(path.join(dir, '.repos.json'), { force: true });
  } else {
    const body = roster === undefined
      ? `${JSON.stringify({ version: 1, repos: registered }, null, 2)}\n`
      : (typeof roster === 'string' ? roster : `${JSON.stringify(roster, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, '.repos.json'), body);
  }

  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    `${JSON.stringify({ version: 1, site: { repo: homeSlug, publish: false, url: null } }, null, 2)}\n`,
  );
  return dir;
};

const run = async () => {
  group('workflow/site-repos: what the list says');

  await test('every registered repo is a slug, and the home repo rides along', () => {
    const tmp = mkTmp();
    const workflowHome = mkWorkflowHome(tmp, ['omega', 'dotfiles']);
    const list = composeSlugs({ workflowHome, home: tmp });
    assertEq(list.repos.sort().join(','), 'owner/dotfiles,owner/omega,owner/workkit', 'the roster plus the home repo');
    assertEq(list.home, 'owner/workkit', 'named again, because the summaries are Discussions on that one');
    cleanup(tmp);
  });

  group('workflow/site-repos: an empty machine and a roster that will not read');

  await test('a machine that registers nothing writes the empty list — it is true', () => {
    // The truth case: no roster file at all is not a failure, it is a machine
    // that has enabled nothing, and the list it composes says exactly that.
    const tmp = mkTmp();
    const workflowHome = mkWorkflowHome(tmp, [], { homeSlug: null, roster: null });
    const outfile = path.join(tmp, 'data', 'repos.json');
    assertEq(writeSlugs(outfile, { workflowHome, home: tmp }), true, 'the file was written');
    assertEq(fs.readFileSync(outfile, 'utf8').trim(), JSON.stringify({ repos: [], home: null }, null, 2),
      'and it says there are no repos');
    cleanup(tmp);
  });

  await test('a roster that cannot be read raises rather than composing an empty one', () => {
    // Issue #116: the failure and the empty machine compose the same list, so
    // telling them apart is the whole job — an empty list published over a good
    // one tells every reader the board is gone.
    const tmp = mkTmp();
    const workflowHome = mkWorkflowHome(tmp, ['omega'], { roster: '{ not json' });
    let raised = null;
    try {
      composeSlugs({ workflowHome, home: tmp });
    } catch (err) {
      raised = err;
    }
    assert(raised, 'the compose raised');
    assert(/could not be read/.test(raised.message), `and says what could not be read, got: ${raised && raised.message}`);
    cleanup(tmp);
  });

  await test('the list already published survives a roster that will not read', () => {
    const tmp = mkTmp();
    const outfile = path.join(tmp, 'data', 'repos.json');
    const workflowHome = mkWorkflowHome(tmp, ['omega']);
    assertEq(writeSlugs(outfile, { workflowHome, home: tmp }), true, 'a good roster writes the list');
    const before = fs.readFileSync(outfile, 'utf8');

    fs.writeFileSync(path.join(workflowHome, '.repos.json'), '{ not json');
    try {
      writeSlugs(outfile, { workflowHome, home: tmp });
      assert(false, 'the write should have raised');
    } catch (err) {
      assert(/could not be read/.test(err.message), `raised for the roster, got: ${err.message}`);
    }
    assertEq(fs.readFileSync(outfile, 'utf8'), before, 'and the file on disk is exactly what it was');
    cleanup(tmp);
  });

  await test('the CLI exits non-zero and writes nothing when the roster will not read', () => {
    const tmp = mkTmp();
    const outfile = path.join(tmp, 'data', 'repos.json');
    const workflowHome = mkWorkflowHome(tmp, ['omega'], { roster: '{ not json' });
    const script = path.join(__dirname, '..', '..', 'workflow', 'site-repos.js');
    const res = spawnSync(process.execPath, [script, outfile, workflowHome], { encoding: 'utf8' });
    assert(res.status !== 0, `non-zero, got ${res.status}`);
    assert(/could not be read/.test(res.stderr), `it says why, got: ${res.stderr}`);
    assertEq(fs.existsSync(outfile), false, 'and nothing was written where the list goes');
    cleanup(tmp);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
