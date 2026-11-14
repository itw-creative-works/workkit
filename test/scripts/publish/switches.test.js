// Tests for workflow/publish.sh: the owner's switches (the roster on the
// home repo's default branch, the custom domain and the path prefix,
// `site.publish` and the teardown it drives). The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect } = require('../../lib/harness');
const { gitPath, joinPath } = require('../../lib/platform');
const { OPT_IN_SHAPES } = require('../../lib/git-repo');
const { cleanup, git, mkWorld, binDirWithout, publish, setSite, fromPages, onMain } = require('./helpers');

describe('workflow/publish: the owner’s switches', () => {
  test('the slug list is written to the home repo’s default branch: names and each machine’s entry, nothing else', () => {
    const world = mkWorld({ roster: ['workkit', 'omega'] });
    publish(world);
    const list = JSON.parse(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8'));
    expect(list.repos.slice(0, 2).join(','), 'every registered repo, as a slug').toBe('owner/omega,owner/workkit');
    expect(list.repos.includes('owner/workkit'), 'and the home repo rides along: its issues are the cross-project queue').toBeTruthy();
    expect(list.home, 'named again, because the summaries are Discussions on that one repo').toBe('owner/workkit');
    expect(Object.keys(list).sort().join(','), 'and the file says nothing else at all').toBe('home,machines,repos');
    cleanup(world.root);
  });

  test('nothing but the home repo is published: no roster, no issue data', () => {
    // Pages is public even from a private repo, so the published copy reads
    // GitHub live with the viewer's own token: a baked board would serve every
    // issue title of every repo to anyone with the URL.
    const world = mkWorld({ roster: ['workkit'] });
    const { code, out } = publish(world);
    expect(code, `exit 0: ${out}`).toBe(0);
    const pages = fromPages(world);
    expect(fs.readdirSync(path.join(pages, 'data')).join(','), 'the data folder holds the home pointer and nothing else').toBe('home.json');
    expect(!fs.existsSync(path.join(pages, 'data', 'board.json')), 'no board snapshot').toBeTruthy();
    const pointer = fs.readFileSync(path.join(pages, 'data', 'home.json'), 'utf8');
    expect(JSON.parse(pointer).home, 'the repo the site is served from, which its own URL already names').toBe('owner/workkit');
    expect(Object.keys(JSON.parse(pointer)).join(','), 'and those two keys: the repo, and the branch of it the private roster is on (issue #112)').toBe('home,branch');
    expect(!/title|body|labels|issues/.test(pointer), `nothing issue-shaped in the one file there is, got: ${pointer}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a machine with no roster writes a list with the home repo in it', () => {
    // A machine that has enabled nothing still has a home repo, and its issues
    // are the cross-project queue, so the site is useful from the first
    // publish rather than pointing at nothing.
    const world = mkWorld();
    publish(world);
    const list = JSON.parse(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8'));
    expect(list.repos.join(','), 'the home slug, and only it').toBe('owner/workkit');
    cleanup(world.root);
  });

  test('an unchanged roster is not a commit a day', () => {
    // The list carries no stamp of any kind, so a second publish writes the same
    // bytes and neither branch has anything to move for.
    const world = mkWorld({ roster: ['workkit'] });
    publish(world);
    const before = spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim();
    const beforeMain = spawnSync('git', ['-C', world.bare, 'rev-parse', 'main'], { encoding: 'utf8' }).stdout.trim();
    const { out } = publish(world);
    expect(/already current/.test(out), `the second run has nothing to say, got: ${out}`).toBeTruthy();
    expect(spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim(), 'and the branch did not move').toBe(before);
    expect(spawnSync('git', ['-C', world.bare, 'rev-parse', 'main'], { encoding: 'utf8' }).stdout.trim(), 'nor did the one the roster is on').toBe(beforeMain);
    cleanup(world.root);
  });

  test('a repo joining the roster reaches the list on the next publish', () => {
    const world = mkWorld({ roster: ['workkit'] });
    publish(world);
    expect(JSON.parse(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8')).repos.length, 'one to start with').toBe(1);

    const joined = path.join(world.root, 'repos', 'dotfiles');
    fs.mkdirSync(path.join(joined, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(joined, '.workkit', 'settings.json'), OPT_IN_SHAPES.current);
    git(joined, 'init', '-q', '-b', 'main');
    git(joined, 'remote', 'add', 'origin', 'https://github.com/owner/dotfiles.git');
    const index = JSON.parse(fs.readFileSync(path.join(world.workflowHome, '.repos.json'), 'utf8'));
    index.repos[gitPath(joined)] = { registered: '2026-07-29' };
    fs.writeFileSync(path.join(world.workflowHome, '.repos.json'), `${JSON.stringify(index, null, 2)}\n`);

    publish(world);
    expect(JSON.parse(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8')).repos.includes('owner/dotfiles'),
      'the new repo is on the list the board sweeps').toBeTruthy();
    cleanup(world.root);
  });

  test('a roster that will not read keeps the list already published, and the run goes on', () => {
    // A compose that fails is not a machine with no repos on it. The list stays
    // as the last good run left it (the readers believe this file) and the warn
    // keeps the run's exit code: a stale-but-good roster is the designed outcome.
    const world = mkWorld({ roster: ['workkit', 'omega'] });
    publish(world);
    const before = fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8');
    expect(/owner\/omega/.test(before), 'the good list is published first').toBeTruthy();

    fs.writeFileSync(path.join(world.workflowHome, '.repos.json'), '{ not json');
    const { code, out } = publish(world);
    expect(code, `exit 0: a stale roster is not a failed run: ${out}`).toBe(0);
    expect(/repo list could not be composed/.test(out), `and the run says so, got: ${out}`).toBeTruthy();
    expect(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8'), 'the list on the default branch is byte for byte what it was').toBe(before);
    expect(fs.existsSync(path.join(fromPages(world), 'index.html')), 'and the site published anyway').toBeTruthy();
    cleanup(world.root);
  });

  test('no node: the site publishes and the skip says what it will be missing', () => {
    const world = mkWorld();
    const { code, out } = publish({
      ...world,
      // The build shim stays on the PATH: the case is a machine without node,
      // not a machine that cannot build.
      env: { ...world.env, PATH: joinPath(path.join(world.root, 'bin'), binDirWithout('node')) },
    });
    expect(code, 'exit 0: a missing tool is not a crash').toBe(0);
    expect(/node is not on this machine/.test(out), `it names the tool, got: ${out}`).toBeTruthy();
    expect(/no repos to sweep/.test(out), `and what will be missing, got: ${out}`).toBeTruthy();
    // The list feeds the cloud brief as well as the pages, so a skip that names
    // only one reader understates by half what is now stale.
    expect(/dashboard/.test(out) && /cloud brief/.test(out), `and both readers of it, got: ${out}`).toBeTruthy();
    expect(fs.existsSync(path.join(fromPages(world), 'index.html')), 'and the pages still publish').toBeTruthy();
    cleanup(world.root);
  });

  test('the roster is refreshed with the switch off: the cloud brief reads it too', () => {
    // `data/repos.json` on the home repo's default branch is the
    // cloud brief's roster as well as the dashboard's, and the two do not share
    // a fate. A machine that publishes no site still owes the brief a current
    // list, so the compose sits above the switch and above every build check.
    const world = mkWorld({ publish: false, roster: ['workkit', 'omega'] });
    const { code, out } = publish(world);
    expect(code, `exit 0: ${out}`).toBe(0);
    const list = JSON.parse(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8'));
    expect(list.repos.includes('owner/omega'), `the list is on the default branch anyway: ${JSON.stringify(list)}`).toBeTruthy();
    expect(fromPages(world), 'and nothing at all was pushed to gh-pages').toBe(null);
    expect(fs.existsSync(world.dist), 'nor built').toBe(false);
    cleanup(world.root);
  });

  test('no build tooling still refreshes the roster', () => {
    // The other half of the decoupling: the compose needs node, git and the
    // clone, and nothing the build needs.
    const world = mkWorld({ tooling: false, roster: ['workkit', 'omega'] });
    const { code, out } = publish(world);
    expect(code, `exit 0: ${out}`).toBe(0);
    const list = JSON.parse(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8'));
    expect(list.repos.includes('owner/omega'), `composed without a builder: ${JSON.stringify(list)}`).toBeTruthy();
    expect(fromPages(world), 'and still nothing published').toBe(null);
    cleanup(world.root);
  });

  test('the home pointer names the branch the roster is on, not an assumed main', () => {
    // The writer pushes whatever branch the clone is on, so the readers are
    // told which one rather than hardcoding it: a home repo whose
    // default branch is not main 404s on every roster read otherwise.
    const world = mkWorld({ branch: 'trunk', roster: ['workkit'] });
    const { code, out } = publish(world);
    expect(code, `exit 0: ${out}`).toBe(0);
    const pointer = JSON.parse(fs.readFileSync(path.join(fromPages(world), 'data', 'home.json'), 'utf8'));
    expect(pointer.branch, 'the branch the clone is on').toBe('trunk');
    expect(pointer.home, 'beside the repo it is a branch of').toBe('owner/workkit');
    expect(fs.existsSync(path.join(onMain(world), 'data', 'repos.json')),
      'and that is where the roster actually landed').toBeTruthy();
    cleanup(world.root);
  });

  test('a site.url becomes the CNAME, and clearing it removes the file', () => {
    const world = mkWorld({ siteUrl: 'https://board.example.com' });
    publish(world);
    expect(fs.readFileSync(path.join(fromPages(world), 'CNAME'), 'utf8'), 'the scheme is not part of a CNAME').toBe('board.example.com\n');

    // A trailing slash is not part of one either: the engine's one reader of the
    // option (`wk_site_host` in home/options.sh) is where both the scheme and
    // the slash come off, for this file and for the handover's site URL alike.
    setSite(world, { url: 'https://board.example.com/' });
    publish(world);
    expect(fs.readFileSync(path.join(fromPages(world), 'CNAME'), 'utf8'), 'and a trailing slash is not a valid record either').toBe('board.example.com\n');

    setSite(world, { url: null });
    publish(world);
    expect(!fs.existsSync(path.join(fromPages(world), 'CNAME')), 'clearing it takes the file away').toBeTruthy();
    cleanup(world.root);
  });

  test('with no custom domain the build is told the project path it serves under', () => {
    // A default Pages address is `<owner>.github.io/<name>/`, so a
    // build that emits root-relative assets 404s on every one of them. The
    // prefix is the repo's own name, from the slug the settings already carry.
    const world = mkWorld();
    const { code, out } = publish(world);
    expect(code, `exit 0: ${out}`).toBe(0);
    expect(world.buildPrefix(), 'the build ran with the project site’s path').toBe('/workkit/');
    expect(/\/workkit\//.test(out), `and the run says what the build got, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a custom domain serves at the root, and the build is told so', () => {
    // A CNAME cannot carry a path, so a set `site.url` is the whole of the
    // answer: the site is at the domain's root and the prefix is `/`.
    const world = mkWorld({ siteUrl: 'https://board.example.com' });
    const { code, out } = publish(world);
    expect(code, `exit 0: ${out}`).toBe(0);
    expect(world.buildPrefix(), 'the domain root, not the repo name').toBe('/');
    cleanup(world.root);
  });

  test('a site key carrying nothing but the switch publishes the defaults', () => {
    // Nothing pre-creates the sub-keys, so an absent `url` has to read as no
    // CNAME rather than as an error.
    const world = mkWorld();
    fs.writeFileSync(
      world.settings,
      `${JSON.stringify({ version: 1, site: { repo: 'owner/workkit', publish: true } }, null, 2)}\n`,
    );
    const { code, out } = publish(world);
    expect(code, `exit 0: ${out}`).toBe(0);
    const pages = fromPages(world);
    expect(fs.existsSync(path.join(pages, 'index.html')), 'the dashboard publishes').toBeTruthy();
    expect(fs.existsSync(path.join(pages, 'data', 'home.json')), 'with its home pointer').toBeTruthy();
    expect(fs.existsSync(path.join(onMain(world), 'data', 'repos.json')), 'and its roster on main').toBeTruthy();
    expect(!fs.existsSync(path.join(pages, 'CNAME')), 'and no CNAME').toBeTruthy();
    cleanup(world.root);
  });

  test('`site.publish` off publishes NOTHING: not even a build', () => {
    // The all-or-nothing switch, default off: what Pages serves is public even
    // from a private repo, so publishing at all is the owner's yes to give. The
    // gate is before the build, so an off machine does no work either.
    const world = mkWorld({ publish: false });
    const { code, out } = publish(world);
    expect(code, 'a machine that publishes nothing is not broken').toBe(0);
    expect(/`site.publish` is off/.test(out), `it names the switch, got: ${out}`).toBeTruthy();
    expect(fs.existsSync(world.dist), 'nothing was even built').toBe(false);
    const branches = spawnSync('git', ['-C', world.bare, 'branch', '--list', 'gh-pages'], { encoding: 'utf8' }).stdout;
    expect(branches.trim(), 'and no branch was pushed').toBe('');
    cleanup(world.root);
  });

  test('an unanswered switch reads as off: null is nobody having said yes', () => {
    // What the seed writes: null means the question has not
    // been put, and a machine waiting on an answer publishes nothing.
    const world = mkWorld({ publish: null });
    const { code, out } = publish(world);
    expect(code, 'exit 0: unanswered is not broken').toBe(0);
    expect(/`site.publish` is off/.test(out), `null is the off answer, got: ${out}`).toBeTruthy();
    expect(fs.existsSync(world.dist), 'and nothing was built').toBe(false);
    cleanup(world.root);
  });

  test('an absent switch reads as off: the default is not to publish', () => {
    const world = mkWorld();
    fs.writeFileSync(
      world.settings,
      `${JSON.stringify({ version: 1, site: { repo: 'owner/workkit' } }, null, 2)}\n`,
    );
    const { code, out } = publish(world);
    expect(code, 'exit 0').toBe(0);
    expect(/`site.publish` is off/.test(out), `the absent key is the off answer, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });

  test('no jq: the skip names jq, not a switch that is already on', () => {
    // The switch is read through jq, so a machine without it reads empty, which
    // is indistinguishable from off. Blaming the switch would send an owner who
    // already said yes to turn on what is already on.
    const world = mkWorld();
    const { code, out } = publish({
      ...world,
      env: { ...world.env, PATH: binDirWithout('jq') },
    });
    expect(code, 'exit 0: a missing tool is not a crash').toBe(0);
    expect(/jq/.test(out), `it names the missing tool, got: ${out}`).toBeTruthy();
    expect(!/is off/.test(out), `and never calls an unreadable switch an off one, got: ${out}`).toBeTruthy();
    expect(fs.existsSync(world.dist), 'nothing was built').toBe(false);
    cleanup(world.root);
  });

  test('turning the switch off takes the published site down', () => {
    // Off governs the site's existence, not only its updates, or the
    // all-or-nothing switch is a half-truth. The branch is generated content,
    // so the next yes rebuilds it from scratch.
    const world = mkWorld({ roster: ['workkit'] });
    publish(world);
    expect(fs.existsSync(path.join(fromPages(world), 'index.html')), 'it published').toBeTruthy();

    // A repo that joined between the two runs: the roster refresh rides the
    // teardown run untouched.
    const joined = path.join(world.root, 'repos', 'dotfiles');
    fs.mkdirSync(path.join(joined, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(joined, '.workkit', 'settings.json'), OPT_IN_SHAPES.current);
    git(joined, 'init', '-q', '-b', 'main');
    git(joined, 'remote', 'add', 'origin', 'https://github.com/owner/dotfiles.git');
    const index = JSON.parse(fs.readFileSync(path.join(world.workflowHome, '.repos.json'), 'utf8'));
    index.repos[gitPath(joined)] = { registered: '2026-07-31' };
    fs.writeFileSync(path.join(world.workflowHome, '.repos.json'), `${JSON.stringify(index, null, 2)}\n`);

    setSite(world, { publish: false });
    const { code, out } = publish(world);
    expect(code, `exit 0: ${out}`).toBe(0);
    expect(fromPages(world), 'the branch Pages served is gone from the remote').toBe(null);
    expect(/taken down/.test(out) && /gh-pages/.test(out), `and the run says what it removed, got: ${out}`).toBeTruthy();
    expect(spawnSync('git', ['-C', world.tower, 'branch', '--list', 'gh-pages'], { encoding: 'utf8' }).stdout.trim(), 'the stale local copy of it goes too').toBe('');
    expect(world.ghCalls().some((argv) => /-X DELETE repos\/owner\/workkit\/pages/.test(argv)),
      `Pages itself is disabled, not just left with nothing to serve: ${world.ghCalls().join(' | ')}`).toBeTruthy();
    expect(/Pages is disabled/.test(out), `and that is said too, got: ${out}`).toBeTruthy();
    expect(JSON.parse(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8')).repos.includes('owner/dotfiles'),
      'while the roster refreshed as it always does').toBeTruthy();
    cleanup(world.root);
  });

  test('a machine that never published hears nothing about a teardown', () => {
    const world = mkWorld({ publish: false });
    const { code, out } = publish(world);
    expect(code, 'exit 0').toBe(0);
    expect(!/taken down/.test(out) && !/Pages is disabled/.test(out) && !/nothing to disable/.test(out),
      `nothing was removed, so nothing is reported, got: ${out}`).toBeTruthy();
    // Scoped to Pages: the run above the switch heals the home repo's labels,
    // so gh is spoken to on every publish, never about Pages.
    expect(!world.ghCalls().some((argv) => /pages/.test(argv)),
      `and GitHub is never asked to disable Pages nobody enabled: ${world.ghCalls().join(' | ')}`).toBeTruthy();
    cleanup(world.root);
  });

  test('Pages that was never configured is a 404 the teardown reads as already off', () => {
    const world = mkWorld({ pages: 'none' });
    publish(world);
    setSite(world, { publish: false });
    const { code, out } = publish(world);
    expect(code, 'a 404 is the answer "already off", not a failure').toBe(0);
    expect(/nothing to disable/.test(out), `it says so, got: ${out}`).toBeTruthy();
    expect(fromPages(world), 'and the branch came down all the same').toBe(null);
    cleanup(world.root);
  });

  test('a remote that cannot be reached is never read as a site that is not there', () => {
    // `ls-remote` answers 2 for "no such branch" and 128 for a remote it could
    // not reach, and the two must not be confused. The pull is pointed at a
    // reachable copy of the remote so that only the probe cannot connect.
    const world = mkWorld();
    publish(world);
    const before = spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim();
    const gone = path.join(world.root, 'gone.git');
    git(world.tower, 'remote', 'add', 'live', world.bare);
    git(world.tower, 'fetch', '-q', 'live');
    git(world.tower, 'branch', '--set-upstream-to=live/main', 'main');
    git(world.tower, 'remote', 'set-url', 'origin', gone);

    // The clone is still the home repo's: origin is the address the settings
    // name, and it is that address that has stopped answering.
    const { code, out } = publish({ ...world, env: { ...world.env, WORKKIT_HOME_REMOTE: gone } });
    expect(code, `an unreachable remote is a skip, not a failure: ${out}`).toBe(0);
    expect(/could not be reached/.test(out), `it names what happened, got: ${out}`).toBeTruthy();
    expect(spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim(), 'the published branch is exactly where it was').toBe(before);
    expect(spawnSync('git', ['-C', world.tower, 'branch', '--list', 'gh-pages'], { encoding: 'utf8' }).stdout.trim() !== '',
      'and the local branch was not dropped on the way to a push that could never land').toBeTruthy();
    cleanup(world.root);
  });
});
