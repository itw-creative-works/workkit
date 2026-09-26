//
// Tests for workflow/publish.sh: the owner's switches (the roster on the
// home repo's default branch, the custom domain and the path prefix,
// `site.publish` and the teardown it drives).
// The shared prologue (the world factory, the publish runner, the settings and branch readers) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { gitPath, joinPath } = require('../../lib/platform');
const { cleanup, git, mkWorld, binDirWithout, publish, setSite, fromPages, onMain } = require('./helpers');

const run = async () => {
  group('workflow/publish: the owner’s switches');

  await test('the slug list is written to the home repo’s default branch: names, and nothing else', () => {
    const world = mkWorld({ roster: ['workkit', 'omega'] });
    publish(world);
    const list = JSON.parse(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8'));
    assertEq(list.repos.slice(0, 2).join(','), 'owner/omega,owner/workkit', 'every registered repo, as a slug');
    assert(list.repos.includes('owner/workkit'), 'and the home repo rides along: its issues are the cross-project queue');
    assertEq(list.home, 'owner/workkit', 'named again, because the summaries are Discussions on that one repo');
    assertEq(Object.keys(list).sort().join(','), 'home,repos', 'and the file says nothing else at all');
    cleanup(world.root);
  });

  await test('the roster never reaches the published branch: Pages is public, and the names are not', () => {
    // Issue #110: gh-pages is served to anyone with the URL even when the repo
    // is private, so a file naming every private repo on this machine cannot be
    // beside the pages. It lives on main, where the repo's own privacy covers
    // it, and every reader fetches it with a token.
    const world = mkWorld({ roster: ['workkit', 'omega'] });
    publish(world);
    const pages = fromPages(world);
    assert(!fs.existsSync(path.join(pages, 'data', 'repos.json')), 'no roster on the published branch');
    const published = spawnSync('git', ['-C', pages, 'ls-files'], { encoding: 'utf8' }).stdout;
    assert(!/omega/.test(published), `and no private repo is named anywhere in what it carries: ${published}`);
    cleanup(world.root);
  });

  await test('nothing but the home repo is published: no roster, no issue data', () => {
    // The whole doctrine of issue #81: Pages is public even from a private repo,
    // and the published copy reads GitHub live with the viewer's own token. A
    // baked board would be every issue title of every repo, served to anyone
    // with the URL.
    const world = mkWorld({ roster: ['workkit'] });
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0: ${out}`);
    const pages = fromPages(world);
    assertEq(fs.readdirSync(path.join(pages, 'data')).join(','), 'home.json', 'the data folder holds the home pointer and nothing else');
    assert(!fs.existsSync(path.join(pages, 'data', 'board.json')), 'no board snapshot');
    const pointer = fs.readFileSync(path.join(pages, 'data', 'home.json'), 'utf8');
    assertEq(JSON.parse(pointer).home, 'owner/workkit', 'the repo the site is served from, which its own URL already names');
    assertEq(Object.keys(JSON.parse(pointer)).join(','), 'home,branch',
      'and those two keys: the repo, and the branch of it the private roster is on (issue #112)');
    assert(!/title|body|labels|issues/.test(pointer), `nothing issue-shaped in the one file there is, got: ${pointer}`);
    cleanup(world.root);
  });

  await test('a machine with no roster writes a list with the home repo in it', () => {
    // A machine that has enabled nothing still has a home repo, and its issues
    // are the cross-project queue, so the site is useful from the first
    // publish rather than pointing at nothing.
    const world = mkWorld();
    publish(world);
    const list = JSON.parse(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8'));
    assertEq(list.repos.join(','), 'owner/workkit', 'the home slug, and only it');
    cleanup(world.root);
  });

  await test('an unchanged roster is not a commit a day', () => {
    // The list carries no stamp of any kind, so a second publish writes the same
    // bytes and neither branch has anything to move for.
    const world = mkWorld({ roster: ['workkit'] });
    publish(world);
    const before = spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim();
    const beforeMain = spawnSync('git', ['-C', world.bare, 'rev-parse', 'main'], { encoding: 'utf8' }).stdout.trim();
    const { out } = publish(world);
    assert(/already current/.test(out), `the second run has nothing to say, got: ${out}`);
    assertEq(spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim(), before,
      'and the branch did not move');
    assertEq(spawnSync('git', ['-C', world.bare, 'rev-parse', 'main'], { encoding: 'utf8' }).stdout.trim(), beforeMain,
      'nor did the one the roster is on');
    cleanup(world.root);
  });

  await test('a repo joining the roster reaches the list on the next publish', () => {
    const world = mkWorld({ roster: ['workkit'] });
    publish(world);
    assertEq(JSON.parse(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8')).repos.length, 1,
      'one to start with');

    const joined = path.join(world.root, 'repos', 'dotfiles');
    fs.mkdirSync(path.join(joined, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(joined, '.workkit', 'settings.json'), '{ "version": 1, "enabled": true }\n');
    git(joined, 'init', '-q', '-b', 'main');
    git(joined, 'remote', 'add', 'origin', 'https://github.com/owner/dotfiles.git');
    const index = JSON.parse(fs.readFileSync(path.join(world.workflowHome, '.repos.json'), 'utf8'));
    index.repos[gitPath(joined)] = { registered: '2026-07-29' };
    fs.writeFileSync(path.join(world.workflowHome, '.repos.json'), `${JSON.stringify(index, null, 2)}\n`);

    publish(world);
    assert(JSON.parse(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8')).repos.includes('owner/dotfiles'),
      'the new repo is on the list the board sweeps');
    cleanup(world.root);
  });

  await test('a roster that will not read keeps the list already published, and the run goes on', () => {
    // Issue #116: a compose that FAILS is not a machine with no repos on it.
    // The list stays exactly as the last good run left it (the readers believe
    // this file) and the warn does not cost the run its exit code, because a
    // stale-but-good roster is the designed outcome.
    const world = mkWorld({ roster: ['workkit', 'omega'] });
    publish(world);
    const before = fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8');
    assert(/owner\/omega/.test(before), 'the good list is published first');

    fs.writeFileSync(path.join(world.workflowHome, '.repos.json'), '{ not json');
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0: a stale roster is not a failed run: ${out}`);
    assert(/repo list could not be composed/.test(out), `and the run says so, got: ${out}`);
    assertEq(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8'), before,
      'the list on the default branch is byte for byte what it was');
    assert(fs.existsSync(path.join(fromPages(world), 'index.html')), 'and the site published anyway');
    cleanup(world.root);
  });

  await test('no node: the site publishes and the skip says what it will be missing', () => {
    const world = mkWorld();
    const { code, out } = publish({
      ...world,
      // The build shim stays on the PATH: the case is a machine without node,
      // not a machine that cannot build.
      env: { ...world.env, PATH: joinPath(path.join(world.root, 'bin'), binDirWithout('node')) },
    });
    assertEq(code, 0, 'exit 0: a missing tool is not a crash');
    assert(/node is not on this machine/.test(out), `it names the tool, got: ${out}`);
    assert(/no repos to sweep/.test(out), `and what will be missing, got: ${out}`);
    // Issue #111: the list feeds the cloud brief as well as the pages, so a skip
    // that names only one reader understates by half what is now stale.
    assert(/dashboard/.test(out) && /cloud brief/.test(out), `and both readers of it, got: ${out}`);
    assert(fs.existsSync(path.join(fromPages(world), 'index.html')), 'and the pages still publish');
    cleanup(world.root);
  });

  await test('the roster is refreshed with the switch off: the cloud brief reads it too', () => {
    // Issue #111: `data/repos.json` on the home repo's default branch is the
    // cloud brief's roster as well as the dashboard's, and the two do not share
    // a fate. A machine that publishes no site still owes the brief a current
    // list, so the compose sits above the switch and above every build check.
    const world = mkWorld({ publish: false, roster: ['workkit', 'omega'] });
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0: ${out}`);
    const list = JSON.parse(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8'));
    assert(list.repos.includes('owner/omega'), `the list is on the default branch anyway: ${JSON.stringify(list)}`);
    assertEq(fromPages(world), null, 'and nothing at all was pushed to gh-pages');
    assertEq(fs.existsSync(world.dist), false, 'nor built');
    cleanup(world.root);
  });

  await test('no build tooling still refreshes the roster', () => {
    // The other half of the decoupling: the compose needs node, git and the
    // clone, and nothing the build needs.
    const world = mkWorld({ tooling: false, roster: ['workkit', 'omega'] });
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0: ${out}`);
    const list = JSON.parse(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8'));
    assert(list.repos.includes('owner/omega'), `composed without a builder: ${JSON.stringify(list)}`);
    assertEq(fromPages(world), null, 'and still nothing published');
    cleanup(world.root);
  });

  await test('the home pointer names the branch the roster is on, not an assumed main', () => {
    // Issue #112: the writer pushes whatever branch the clone is on, so the
    // readers are TOLD which one rather than hardcoding it: a home repo whose
    // default branch is not main 404s on every roster read otherwise.
    const world = mkWorld({ branch: 'trunk', roster: ['workkit'] });
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0: ${out}`);
    const pointer = JSON.parse(fs.readFileSync(path.join(fromPages(world), 'data', 'home.json'), 'utf8'));
    assertEq(pointer.branch, 'trunk', 'the branch the clone is on');
    assertEq(pointer.home, 'owner/workkit', 'beside the repo it is a branch of');
    assert(fs.existsSync(path.join(onMain(world), 'data', 'repos.json')),
      'and that is where the roster actually landed');
    cleanup(world.root);
  });

  await test('a site.url becomes the CNAME, and clearing it removes the file', () => {
    const world = mkWorld({ siteUrl: 'https://board.example.com' });
    publish(world);
    assertEq(fs.readFileSync(path.join(fromPages(world), 'CNAME'), 'utf8'), 'board.example.com\n',
      'the scheme is not part of a CNAME');

    // A trailing slash is not part of one either (issue #230): `ask_site_url`
    // takes whatever was typed at its word, and the engine's one reader of the
    // option (`wk_site_host` in home/options.sh) is where both the scheme and the slash
    // come off, for this file and for the handover's site URL alike.
    setSite(world, { url: 'https://board.example.com/' });
    publish(world);
    assertEq(fs.readFileSync(path.join(fromPages(world), 'CNAME'), 'utf8'), 'board.example.com\n',
      'and a trailing slash is not a valid record either');

    setSite(world, { url: null });
    publish(world);
    assert(!fs.existsSync(path.join(fromPages(world), 'CNAME')), 'clearing it takes the file away');
    cleanup(world.root);
  });

  await test('with no custom domain the build is told the project path it serves under', () => {
    // Issue #165: a default Pages address is `<owner>.github.io/<name>/`, so a
    // build that emits root-relative assets 404s on every one of them. The
    // prefix is the repo's own name, from the slug the settings already carry.
    const world = mkWorld();
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0: ${out}`);
    assertEq(world.buildPrefix(), '/workkit/', 'the build ran with the project site’s path');
    assert(/\/workkit\//.test(out), `and the run says what the build got, got: ${out}`);
    cleanup(world.root);
  });

  await test('a custom domain serves at the root, and the build is told so', () => {
    // A CNAME cannot carry a path, so a set `site.url` is the whole of the
    // answer: the site is at the domain's root and the prefix is `/`.
    const world = mkWorld({ siteUrl: 'https://board.example.com' });
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0: ${out}`);
    assertEq(world.buildPrefix(), '/', 'the domain root, not the repo name');
    cleanup(world.root);
  });

  await test('a site key carrying nothing but the switch publishes the defaults', () => {
    // Nothing pre-creates the sub-keys, so an absent `url` has to read as no
    // CNAME rather than as an error.
    const world = mkWorld();
    fs.writeFileSync(
      world.settings,
      `${JSON.stringify({ version: 1, site: { repo: 'owner/workkit', publish: true } }, null, 2)}\n`,
    );
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0: ${out}`);
    const pages = fromPages(world);
    assert(fs.existsSync(path.join(pages, 'index.html')), 'the dashboard publishes');
    assert(fs.existsSync(path.join(pages, 'data', 'home.json')), 'with its home pointer');
    assert(fs.existsSync(path.join(onMain(world), 'data', 'repos.json')), 'and its roster on main');
    assert(!fs.existsSync(path.join(pages, 'CNAME')), 'and no CNAME');
    cleanup(world.root);
  });

  await test('`site.publish` off publishes NOTHING: not even a build', () => {
    // The all-or-nothing switch (issue #80), and it is default off: what Pages
    // serves is public even from a private repo, so publishing at all is the
    // owner's yes to give. The gate is before the build, so an off machine does
    // no work either.
    const world = mkWorld({ publish: false });
    const { code, out } = publish(world);
    assertEq(code, 0, 'a machine that publishes nothing is not broken');
    assert(/`site.publish` is off/.test(out), `it names the switch, got: ${out}`);
    assertEq(fs.existsSync(world.dist), false, 'nothing was even built');
    const branches = spawnSync('git', ['-C', world.bare, 'branch', '--list', 'gh-pages'], { encoding: 'utf8' }).stdout;
    assertEq(branches.trim(), '', 'and no branch was pushed');
    cleanup(world.root);
  });

  await test('an unanswered switch reads as off: null is nobody having said yes', () => {
    // What the seed now writes (issue #84): null means the question has not
    // been put, and a machine waiting on an answer publishes nothing.
    const world = mkWorld({ publish: null });
    const { code, out } = publish(world);
    assertEq(code, 0, 'exit 0: unanswered is not broken');
    assert(/`site.publish` is off/.test(out), `null is the off answer, got: ${out}`);
    assertEq(fs.existsSync(world.dist), false, 'and nothing was built');
    cleanup(world.root);
  });

  await test('an absent switch reads as off: the default is not to publish', () => {
    const world = mkWorld();
    fs.writeFileSync(
      world.settings,
      `${JSON.stringify({ version: 1, site: { repo: 'owner/workkit' } }, null, 2)}\n`,
    );
    const { code, out } = publish(world);
    assertEq(code, 0, 'exit 0');
    assert(/`site.publish` is off/.test(out), `the absent key is the off answer, got: ${out}`);
    cleanup(world.root);
  });

  await test('no jq: the skip names jq, not a switch that is already on', () => {
    // The switch is read through jq, so a machine without it reads empty, which
    // is indistinguishable from off. Blaming the switch would send an owner who
    // already said yes to turn on what is already on.
    const world = mkWorld();
    const { code, out } = publish({
      ...world,
      env: { ...world.env, PATH: binDirWithout('jq') },
    });
    assertEq(code, 0, 'exit 0: a missing tool is not a crash');
    assert(/jq/.test(out), `it names the missing tool, got: ${out}`);
    assert(!/is off/.test(out), `and never calls an unreadable switch an off one, got: ${out}`);
    assertEq(fs.existsSync(world.dist), false, 'nothing was built');
    cleanup(world.root);
  });

  await test('turning the switch off takes the published site down', () => {
    // Issue #113: off governs the site's EXISTENCE, not only its updates: a
    // site left serving forever made the all-or-nothing switch a half-truth. The
    // branch is generated content, so the next yes rebuilds it from scratch.
    const world = mkWorld({ roster: ['workkit'] });
    publish(world);
    assert(fs.existsSync(path.join(fromPages(world), 'index.html')), 'it published');

    // A repo that joined between the two runs: the roster refresh rides the
    // teardown run untouched (issue #111).
    const joined = path.join(world.root, 'repos', 'dotfiles');
    fs.mkdirSync(path.join(joined, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(joined, '.workkit', 'settings.json'), '{ "version": 1, "enabled": true }\n');
    git(joined, 'init', '-q', '-b', 'main');
    git(joined, 'remote', 'add', 'origin', 'https://github.com/owner/dotfiles.git');
    const index = JSON.parse(fs.readFileSync(path.join(world.workflowHome, '.repos.json'), 'utf8'));
    index.repos[gitPath(joined)] = { registered: '2026-07-31' };
    fs.writeFileSync(path.join(world.workflowHome, '.repos.json'), `${JSON.stringify(index, null, 2)}\n`);

    setSite(world, { publish: false });
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0: ${out}`);
    assertEq(fromPages(world), null, 'the branch Pages served is gone from the remote');
    assert(/taken down/.test(out) && /gh-pages/.test(out), `and the run says what it removed, got: ${out}`);
    assertEq(spawnSync('git', ['-C', world.tower, 'branch', '--list', 'gh-pages'], { encoding: 'utf8' }).stdout.trim(), '',
      'the stale local copy of it goes too');
    assert(world.ghCalls().some((argv) => /-X DELETE repos\/owner\/workkit\/pages/.test(argv)),
      `Pages itself is disabled, not just left with nothing to serve: ${world.ghCalls().join(' | ')}`);
    assert(/Pages is disabled/.test(out), `and that is said too, got: ${out}`);
    assert(JSON.parse(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8')).repos.includes('owner/dotfiles'),
      'while the roster refreshed as it always does');
    cleanup(world.root);
  });

  await test('a machine that never published hears nothing about a teardown', () => {
    const world = mkWorld({ publish: false });
    const { code, out } = publish(world);
    assertEq(code, 0, 'exit 0');
    assert(!/taken down/.test(out) && !/Pages is disabled/.test(out) && !/nothing to disable/.test(out),
      `nothing was removed, so nothing is reported, got: ${out}`);
    // Scoped to Pages: the run above the switch heals the home repo's labels
    // (issue #123), so gh is spoken to on every publish, never about Pages.
    assert(!world.ghCalls().some((argv) => /pages/.test(argv)),
      `and GitHub is never asked to disable Pages nobody enabled: ${world.ghCalls().join(' | ')}`);
    cleanup(world.root);
  });

  await test('Pages that was never configured is a 404 the teardown reads as already off', () => {
    const world = mkWorld({ pages: 'none' });
    publish(world);
    setSite(world, { publish: false });
    const { code, out } = publish(world);
    assertEq(code, 0, 'a 404 is the answer "already off", not a failure');
    assert(/nothing to disable/.test(out), `it says so, got: ${out}`);
    assertEq(fromPages(world), null, 'and the branch came down all the same');
    cleanup(world.root);
  });

  await test('a remote that cannot be reached is never read as a site that is not there', () => {
    // Issue #111: `ls-remote` answers 2 for "no such branch" and 128 for a
    // remote it could not reach, and reading the second as the first dropped the
    // local branch and then failed at the push. The pull is pointed at a
    // reachable copy of the remote so that the probe (and only the probe) is
    // the thing that cannot connect.
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
    assertEq(code, 0, `an unreachable remote is a skip, not a failure: ${out}`);
    assert(/could not be reached/.test(out), `it names what happened, got: ${out}`);
    assertEq(spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim(), before,
      'the published branch is exactly where it was');
    assert(spawnSync('git', ['-C', world.tower, 'branch', '--list', 'gh-pages'], { encoding: 'utf8' }).stdout.trim() !== '',
      'and the local branch was not dropped on the way to a push that could never land');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
