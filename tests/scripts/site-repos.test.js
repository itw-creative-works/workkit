// Tests for workflow/publish/site-repos.js: the roster the published site sweeps.
// The fixtures are a scratch ~/.workkit and real git repos with real `origin`
// remotes: what a slug is, is a question only git answers.

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { gitPath } = require('../lib/platform');
const { mkTmp } = require('../lib/scratch');

const { composeSlugs, writeSlugs, machineKey } = require(path.join(__dirname, '..', '..', 'workflow', 'publish', 'site-repos.js'));

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
    registered[gitPath(repo)] = { registered: '2026-07-30' };
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

// Two machines sharing one home repo, each its own hostname and its own roster.
const MAC = 'Ians-MacBook-Pro.local';
const WIN = 'DESKTOP-IFL07VG';

/** Takes a repo off a fixture's roster, as a decline or a lost folder does. */
const dropFromRoster = (workflowHome, name) => {
  const file = path.join(workflowHome, '.repos.json');
  const roster = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const key of Object.keys(roster.repos)) {
    if (path.basename(key) === name) delete roster.repos[key];
  }
  fs.writeFileSync(file, `${JSON.stringify(roster, null, 2)}\n`);
};

const keysOf = (machines) => Object.keys(machines).sort().join(',');

const run = async () => {
  group('workflow/site-repos: what the list says');

  await test('every registered repo is a slug, and the home repo rides along', () => {
    const tmp = mkTmp('workkit-site-repos-');
    const workflowHome = mkWorkflowHome(tmp, ['omega', 'dotfiles']);
    const list = composeSlugs({ workflowHome, home: tmp });
    assertEq(list.repos.sort().join(','), 'owner/dotfiles,owner/omega,owner/workkit', 'the roster plus the home repo');
    assertEq(list.home, 'owner/workkit', 'named again, because the summaries are Discussions on that one');
    cleanup(tmp);
  });

  group('workflow/site-repos: an empty machine and a roster that will not read');

  await test('a machine that registers nothing writes the empty list, it is true', () => {
    // The truth case: no roster file at all is not a failure, it is a machine
    // that has enabled nothing, and the list it composes says exactly that.
    const tmp = mkTmp('workkit-site-repos-');
    const workflowHome = mkWorkflowHome(tmp, [], { homeSlug: null, roster: null });
    const outfile = path.join(tmp, 'data', 'repos.json');
    assertEq(writeSlugs(outfile, { workflowHome, home: tmp, hostname: MAC }), true, 'the file was written');
    const written = JSON.parse(fs.readFileSync(outfile, 'utf8'));
    assertEq(JSON.stringify(written.repos), '[]', 'and it says there are no repos');
    assertEq(written.home, null, 'and no home repo');
    assertEq(JSON.stringify(written.machines), '{"ians-macbook-pro":[]}', 'this machine, with nothing in its entry');
    cleanup(tmp);
  });

  await test('a roster that cannot be read raises rather than composing an empty one', () => {
    // The failure and the empty machine compose the same list, so
    // telling them apart is the whole job. An empty list published over a good
    // one tells every reader the board is gone.
    const tmp = mkTmp('workkit-site-repos-');
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
    const tmp = mkTmp('workkit-site-repos-');
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
    const tmp = mkTmp('workkit-site-repos-');
    const outfile = path.join(tmp, 'data', 'repos.json');
    const workflowHome = mkWorkflowHome(tmp, ['omega'], { roster: '{ not json' });
    const script = path.join(__dirname, '..', '..', 'workflow', 'publish', 'site-repos.js');
    const res = spawnSync(process.execPath, [script, outfile, workflowHome], { encoding: 'utf8' });
    assert(res.status !== 0, `non-zero, got ${res.status}`);
    assert(/could not be read/.test(res.stderr), `it says why, got: ${res.stderr}`);
    assertEq(fs.existsSync(outfile), false, 'and nothing was written where the list goes');
    cleanup(tmp);
  });

  group('workflow/site-repos: every machine owns its own entry');

  await test('a machine key is the hostname\'s first label, lowercased', () => {
    assertEq(machineKey('Ians-MacBook-Pro.local'), 'ians-macbook-pro', 'the Mac');
    assertEq(machineKey('DESKTOP-IFL07VG'), 'desktop-ifl07vg', 'the Windows machine');
    assertEq(machineKey('my-mac.lan'), 'my-mac', 'a router-given domain dropped too');
  });

  await test('two machines with different rosters publish the sorted union, both entries kept', () => {
    const tmpMac = mkTmp('workkit-site-repos-');
    const tmpWin = mkTmp('workkit-site-repos-');
    const macHome = mkWorkflowHome(tmpMac, ['omega', 'dotfiles', 'shared']);
    const winHome = mkWorkflowHome(tmpWin, ['shared', 'Zeta', 'alpha']);

    const fromMac = composeSlugs({ workflowHome: macHome, home: tmpMac, hostname: MAC, previous: null });
    const both = composeSlugs({ workflowHome: winHome, home: tmpWin, hostname: WIN, previous: fromMac });

    assertEq(both.repos.join(','),
      'owner/alpha,owner/dotfiles,owner/omega,owner/shared,owner/Zeta,owner/workkit',
      'the union sorted without regard to case, the home repo appended');
    assertEq(both.home, 'owner/workkit', 'the home repo named');
    assertEq(keysOf(both.machines), 'desktop-ifl07vg,ians-macbook-pro', 'one entry per machine');
    assertEq(both.machines['ians-macbook-pro'].join(','), 'owner/dotfiles,owner/omega,owner/shared',
      'the Mac entry, in the order the roster reader lists it (by path)');
    assertEq(both.machines['desktop-ifl07vg'].join(','), 'owner/alpha,owner/shared,owner/Zeta',
      'the Windows entry, in the order the roster reader lists it (by path)');
    cleanup(tmpMac);
    cleanup(tmpWin);
  });

  await test('a repo one machine drops leaves the list unless the other machine still lists it', () => {
    const tmpMac = mkTmp('workkit-site-repos-');
    const tmpWin = mkTmp('workkit-site-repos-');
    const macHome = mkWorkflowHome(tmpMac, ['omega', 'dotfiles', 'shared']);
    const winHome = mkWorkflowHome(tmpWin, ['shared', 'Zeta']);

    const fromMac = composeSlugs({ workflowHome: macHome, home: tmpMac, hostname: MAC, previous: null });
    const both = composeSlugs({ workflowHome: winHome, home: tmpWin, hostname: WIN, previous: fromMac });

    dropFromRoster(macHome, 'dotfiles');
    dropFromRoster(macHome, 'shared');
    const again = composeSlugs({ workflowHome: macHome, home: tmpMac, hostname: MAC, previous: both });

    assertEq(again.machines['ians-macbook-pro'].join(','), 'owner/omega', 'the Mac entry lost both repos');
    assertEq(again.machines['desktop-ifl07vg'].join(','), 'owner/shared,owner/Zeta',
      'the Windows entry is untouched');
    assertEq(again.repos.join(','), 'owner/omega,owner/shared,owner/Zeta,owner/workkit',
      'dotfiles is gone, shared stays because Windows lists it');
    cleanup(tmpMac);
    cleanup(tmpWin);
  });

  await test('a file from before machines holds only this machine after its publish', () => {
    const tmp = mkTmp('workkit-site-repos-');
    const workflowHome = mkWorkflowHome(tmp, ['omega', 'dotfiles']);
    const legacy = { repos: ['owner/old-one', 'owner/omega', 'owner/workkit'], home: 'owner/workkit' };

    const list = composeSlugs({ workflowHome, home: tmp, hostname: WIN, previous: legacy });

    assertEq(keysOf(list.machines), 'desktop-ifl07vg', 'only this machine has an entry');
    assertEq(list.machines['desktop-ifl07vg'].join(','), 'owner/dotfiles,owner/omega', 'its roster');
    assertEq(list.repos.join(','), 'owner/dotfiles,owner/omega,owner/workkit',
      'its list plus the home repo, the old list dropped');
    cleanup(tmp);
  });

  await test('an unchanged roster writes nothing, the file on disk left alone', () => {
    const tmpMac = mkTmp('workkit-site-repos-');
    const tmpWin = mkTmp('workkit-site-repos-');
    const outfile = path.join(tmpMac, 'data', 'repos.json');
    const macHome = mkWorkflowHome(tmpMac, ['omega', 'dotfiles']);
    const winHome = mkWorkflowHome(tmpWin, ['shared']);

    // The other machine's publish is already on disk: the writer must read it.
    const fromWin = composeSlugs({ workflowHome: winHome, home: tmpWin, hostname: WIN, previous: null });
    fs.mkdirSync(path.dirname(outfile), { recursive: true });
    fs.writeFileSync(outfile, `${JSON.stringify(fromWin, null, 2)}\n`);

    assertEq(writeSlugs(outfile, { workflowHome: macHome, home: tmpMac, hostname: MAC }), true,
      'the Mac entry is new, so the file is written');
    const first = JSON.parse(fs.readFileSync(outfile, 'utf8'));
    assertEq(keysOf(first.machines), 'desktop-ifl07vg,ians-macbook-pro', 'the entry read from disk survives');
    assertEq(first.repos.join(','), 'owner/dotfiles,owner/omega,owner/shared,owner/workkit', 'the union');

    const before = fs.readFileSync(outfile, 'utf8');
    const mtime = fs.statSync(outfile).mtimeMs;
    assertEq(writeSlugs(outfile, { workflowHome: macHome, home: tmpMac, hostname: MAC }), false,
      'the same roster again writes nothing');
    assertEq(fs.readFileSync(outfile, 'utf8'), before, 'the bytes are what they were');
    assertEq(fs.statSync(outfile).mtimeMs, mtime, 'and the file was never rewritten');
    cleanup(tmpMac);
    cleanup(tmpWin);
  });

  await test('a home repo no machine lists is appended to the list once', () => {
    const tmpMac = mkTmp('workkit-site-repos-');
    const tmpWin = mkTmp('workkit-site-repos-');
    const macHome = mkWorkflowHome(tmpMac, ['omega', 'alpha'], { homeSlug: 'owner/hub' });
    const winHome = mkWorkflowHome(tmpWin, ['shared', 'zeta'], { homeSlug: 'owner/hub' });

    const fromMac = composeSlugs({ workflowHome: macHome, home: tmpMac, hostname: MAC, previous: null });
    const both = composeSlugs({ workflowHome: winHome, home: tmpWin, hostname: WIN, previous: fromMac });

    assertEq(both.repos.join(','), 'owner/alpha,owner/omega,owner/shared,owner/zeta,owner/hub',
      'the home repo once, after the sorted union');
    assertEq(both.machines['ians-macbook-pro'].includes('owner/hub'), false, 'and in no machine entry');
    assertEq(both.machines['desktop-ifl07vg'].includes('owner/hub'), false, 'on either machine');
    cleanup(tmpMac);
    cleanup(tmpWin);
  });

  await test('one slug spelled two ways is listed once, the home repo included', () => {
    const tmpMac = mkTmp('workkit-site-repos-');
    const tmpWin = mkTmp('workkit-site-repos-');
    const macHome = mkWorkflowHome(tmpMac, ['x', 'omega'], { homeSlug: 'owner/Home' });
    const winHome = mkWorkflowHome(tmpWin, ['x', 'home'], { homeSlug: 'owner/Home' });
    git(path.join(tmpWin, 'repos', 'x'), 'remote', 'set-url', 'origin', 'https://github.com/Owner/x.git');

    // Windows publishes first, so its spelling is the first in the file's key order.
    const fromWin = composeSlugs({ workflowHome: winHome, home: tmpWin, hostname: WIN, previous: null });
    const both = composeSlugs({ workflowHome: macHome, home: tmpMac, hostname: MAC, previous: fromWin });

    const spelled = (slug) => both.repos.filter((s) => s.toLowerCase() === slug);
    assertEq(spelled('owner/x').join(','), 'Owner/x', 'one x, the first spelling');
    assertEq(spelled('owner/home').length, 1, `one home spelling, got ${both.repos.join(',')}`);
    assertEq(both.repos.length, 3, `x, home and omega, got ${both.repos.join(',')}`);
    cleanup(tmpMac);
    cleanup(tmpWin);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
