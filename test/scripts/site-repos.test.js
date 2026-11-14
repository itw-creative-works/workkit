// Tests for workflow/publish/site-repos.js: the roster the published site sweeps.
// The fixtures are a scratch ~/.workkit and real git repos with real `origin`
// remotes: what a slug is, is a question only git answers.

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { describe, test, expect, mkTmp } = require('../lib/harness');
const { gitPath } = require('../lib/platform');
const { OPT_IN_SHAPES } = require('../lib/git-repo');

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
    fs.writeFileSync(path.join(repo, '.workkit', 'settings.json'), OPT_IN_SHAPES.current);
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

describe('workflow/site-repos: what the list says', () => {
  test('every registered repo is a slug, and the home repo rides along', () => {
    const tmp = mkTmp('workkit-site-repos-');
    const workflowHome = mkWorkflowHome(tmp, ['omega', 'dotfiles']);
    const list = composeSlugs({ workflowHome, home: tmp });
    expect(list.repos.sort().join(','), 'the roster plus the home repo').toBe('owner/dotfiles,owner/omega,owner/workkit');
    expect(list.home, 'named again, because the summaries are Discussions on that one').toBe('owner/workkit');
    cleanup(tmp);
  });
});

describe('workflow/site-repos: an empty machine and a roster that will not read', () => {
  test('a machine that registers nothing writes the empty list, it is true', () => {
    // The truth case: no roster file at all is not a failure, it is a machine
    // that has enabled nothing, and the list it composes says exactly that.
    const tmp = mkTmp('workkit-site-repos-');
    const workflowHome = mkWorkflowHome(tmp, [], { homeSlug: null, roster: null });
    const outfile = path.join(tmp, 'data', 'repos.json');
    expect(writeSlugs(outfile, { workflowHome, home: tmp, hostname: MAC }), 'the file was written').toBe(true);
    const written = JSON.parse(fs.readFileSync(outfile, 'utf8'));
    expect(JSON.stringify(written.repos), 'and it says there are no repos').toBe('[]');
    expect(written.home, 'and no home repo').toBe(null);
    expect(JSON.stringify(written.machines), 'this machine, with nothing in its entry').toBe('{"ians-macbook-pro":[]}');
    cleanup(tmp);
  });

  test('the list already published survives a roster that will not read', () => {
    const tmp = mkTmp('workkit-site-repos-');
    const outfile = path.join(tmp, 'data', 'repos.json');
    const workflowHome = mkWorkflowHome(tmp, ['omega']);
    expect(writeSlugs(outfile, { workflowHome, home: tmp }), 'a good roster writes the list').toBe(true);
    const before = fs.readFileSync(outfile, 'utf8');

    fs.writeFileSync(path.join(workflowHome, '.repos.json'), '{ not json');
    try {
      writeSlugs(outfile, { workflowHome, home: tmp });
      expect(false, 'the write should have raised').toBeTruthy();
    } catch (err) {
      expect(/could not be read/.test(err.message), `raised for the roster, got: ${err.message}`).toBeTruthy();
    }
    expect(fs.readFileSync(outfile, 'utf8'), 'and the file on disk is exactly what it was').toBe(before);
    cleanup(tmp);
  });

  test('the CLI exits non-zero and writes nothing when the roster will not read', () => {
    const tmp = mkTmp('workkit-site-repos-');
    const outfile = path.join(tmp, 'data', 'repos.json');
    const workflowHome = mkWorkflowHome(tmp, ['omega'], { roster: '{ not json' });
    const script = path.join(__dirname, '..', '..', 'workflow', 'publish', 'site-repos.js');
    const res = spawnSync(process.execPath, [script, outfile, workflowHome], { encoding: 'utf8' });
    expect(res.status !== 0, `non-zero, got ${res.status}`).toBeTruthy();
    expect(/could not be read/.test(res.stderr), `it says why, got: ${res.stderr}`).toBeTruthy();
    expect(fs.existsSync(outfile), 'and nothing was written where the list goes').toBe(false);
    cleanup(tmp);
  });
});

describe('workflow/site-repos: every machine owns its own entry', () => {
  test('a machine key is the hostname\'s first label, lowercased', () => {
    expect(machineKey('Ians-MacBook-Pro.local'), 'the Mac').toBe('ians-macbook-pro');
    expect(machineKey('DESKTOP-IFL07VG'), 'the Windows machine').toBe('desktop-ifl07vg');
    expect(machineKey('my-mac.lan'), 'a router-given domain dropped too').toBe('my-mac');
  });

  test('two machines with different rosters publish the sorted union, both entries kept', () => {
    const tmpMac = mkTmp('workkit-site-repos-');
    const tmpWin = mkTmp('workkit-site-repos-');
    const macHome = mkWorkflowHome(tmpMac, ['omega', 'dotfiles', 'shared']);
    const winHome = mkWorkflowHome(tmpWin, ['shared', 'Zeta', 'alpha']);

    const fromMac = composeSlugs({ workflowHome: macHome, home: tmpMac, hostname: MAC, previous: null });
    const both = composeSlugs({ workflowHome: winHome, home: tmpWin, hostname: WIN, previous: fromMac });

    expect(both.repos.join(','), 'the union sorted without regard to case, the home repo appended').toBe('owner/alpha,owner/dotfiles,owner/omega,owner/shared,owner/Zeta,owner/workkit');
    expect(both.home, 'the home repo named').toBe('owner/workkit');
    expect(keysOf(both.machines), 'one entry per machine').toBe('desktop-ifl07vg,ians-macbook-pro');
    expect(both.machines['ians-macbook-pro'].join(','), 'the Mac entry, in the order the roster reader lists it (by path)').toBe('owner/dotfiles,owner/omega,owner/shared');
    expect(both.machines['desktop-ifl07vg'].join(','), 'the Windows entry, in the order the roster reader lists it (by path)').toBe('owner/alpha,owner/shared,owner/Zeta');
    cleanup(tmpMac);
    cleanup(tmpWin);
  });

  test('a repo one machine drops leaves the list unless the other machine still lists it', () => {
    const tmpMac = mkTmp('workkit-site-repos-');
    const tmpWin = mkTmp('workkit-site-repos-');
    const macHome = mkWorkflowHome(tmpMac, ['omega', 'dotfiles', 'shared']);
    const winHome = mkWorkflowHome(tmpWin, ['shared', 'Zeta']);

    const fromMac = composeSlugs({ workflowHome: macHome, home: tmpMac, hostname: MAC, previous: null });
    const both = composeSlugs({ workflowHome: winHome, home: tmpWin, hostname: WIN, previous: fromMac });

    dropFromRoster(macHome, 'dotfiles');
    dropFromRoster(macHome, 'shared');
    const again = composeSlugs({ workflowHome: macHome, home: tmpMac, hostname: MAC, previous: both });

    expect(again.machines['ians-macbook-pro'].join(','), 'the Mac entry lost both repos').toBe('owner/omega');
    expect(again.machines['desktop-ifl07vg'].join(','), 'the Windows entry is untouched').toBe('owner/shared,owner/Zeta');
    expect(again.repos.join(','), 'dotfiles is gone, shared stays because Windows lists it').toBe('owner/omega,owner/shared,owner/Zeta,owner/workkit');
    cleanup(tmpMac);
    cleanup(tmpWin);
  });

  test('a file from before machines holds only this machine after its publish', () => {
    const tmp = mkTmp('workkit-site-repos-');
    const workflowHome = mkWorkflowHome(tmp, ['omega', 'dotfiles']);
    const legacy = { repos: ['owner/old-one', 'owner/omega', 'owner/workkit'], home: 'owner/workkit' };

    const list = composeSlugs({ workflowHome, home: tmp, hostname: WIN, previous: legacy });

    expect(keysOf(list.machines), 'only this machine has an entry').toBe('desktop-ifl07vg');
    expect(list.machines['desktop-ifl07vg'].join(','), 'its roster').toBe('owner/dotfiles,owner/omega');
    expect(list.repos.join(','), 'its list plus the home repo, the old list dropped').toBe('owner/dotfiles,owner/omega,owner/workkit');
    cleanup(tmp);
  });

  test('an unchanged roster writes nothing, the file on disk left alone', () => {
    const tmpMac = mkTmp('workkit-site-repos-');
    const tmpWin = mkTmp('workkit-site-repos-');
    const outfile = path.join(tmpMac, 'data', 'repos.json');
    const macHome = mkWorkflowHome(tmpMac, ['omega', 'dotfiles']);
    const winHome = mkWorkflowHome(tmpWin, ['shared']);

    // The other machine's publish is already on disk: the writer must read it.
    const fromWin = composeSlugs({ workflowHome: winHome, home: tmpWin, hostname: WIN, previous: null });
    fs.mkdirSync(path.dirname(outfile), { recursive: true });
    fs.writeFileSync(outfile, `${JSON.stringify(fromWin, null, 2)}\n`);

    expect(writeSlugs(outfile, { workflowHome: macHome, home: tmpMac, hostname: MAC }), 'the Mac entry is new, so the file is written').toBe(true);
    const first = JSON.parse(fs.readFileSync(outfile, 'utf8'));
    expect(keysOf(first.machines), 'the entry read from disk survives').toBe('desktop-ifl07vg,ians-macbook-pro');
    expect(first.repos.join(','), 'the union').toBe('owner/dotfiles,owner/omega,owner/shared,owner/workkit');

    const before = fs.readFileSync(outfile, 'utf8');
    const mtime = fs.statSync(outfile).mtimeMs;
    expect(writeSlugs(outfile, { workflowHome: macHome, home: tmpMac, hostname: MAC }), 'the same roster again writes nothing').toBe(false);
    expect(fs.readFileSync(outfile, 'utf8'), 'the bytes are what they were').toBe(before);
    expect(fs.statSync(outfile).mtimeMs, 'and the file was never rewritten').toBe(mtime);
    cleanup(tmpMac);
    cleanup(tmpWin);
  });

  test('a home repo no machine lists is appended to the list once', () => {
    const tmpMac = mkTmp('workkit-site-repos-');
    const tmpWin = mkTmp('workkit-site-repos-');
    const macHome = mkWorkflowHome(tmpMac, ['omega', 'alpha'], { homeSlug: 'owner/hub' });
    const winHome = mkWorkflowHome(tmpWin, ['shared', 'zeta'], { homeSlug: 'owner/hub' });

    const fromMac = composeSlugs({ workflowHome: macHome, home: tmpMac, hostname: MAC, previous: null });
    const both = composeSlugs({ workflowHome: winHome, home: tmpWin, hostname: WIN, previous: fromMac });

    expect(both.repos.join(','), 'the home repo once, after the sorted union').toBe('owner/alpha,owner/omega,owner/shared,owner/zeta,owner/hub');
    expect(both.machines['ians-macbook-pro'].includes('owner/hub'), 'and in no machine entry').toBe(false);
    expect(both.machines['desktop-ifl07vg'].includes('owner/hub'), 'on either machine').toBe(false);
    cleanup(tmpMac);
    cleanup(tmpWin);
  });

  test('one slug spelled two ways is listed once, the home repo included', () => {
    const tmpMac = mkTmp('workkit-site-repos-');
    const tmpWin = mkTmp('workkit-site-repos-');
    const macHome = mkWorkflowHome(tmpMac, ['x', 'omega'], { homeSlug: 'owner/Home' });
    const winHome = mkWorkflowHome(tmpWin, ['x', 'home'], { homeSlug: 'owner/Home' });
    git(path.join(tmpWin, 'repos', 'x'), 'remote', 'set-url', 'origin', 'https://github.com/Owner/x.git');

    // Windows publishes first, so its spelling is the first in the file's key order.
    const fromWin = composeSlugs({ workflowHome: winHome, home: tmpWin, hostname: WIN, previous: null });
    const both = composeSlugs({ workflowHome: macHome, home: tmpMac, hostname: MAC, previous: fromWin });

    const spelled = (slug) => both.repos.filter((s) => s.toLowerCase() === slug);
    expect(spelled('owner/x').join(','), 'one x, the first spelling').toBe('Owner/x');
    expect(spelled('owner/home').length, `one home spelling, got ${both.repos.join(',')}`).toBe(1);
    expect(both.repos.length, `x, home and omega, got ${both.repos.join(',')}`).toBe(3);
    cleanup(tmpMac);
    cleanup(tmpWin);
  });
});
