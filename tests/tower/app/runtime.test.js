//
// Tests for the tower dashboard's runtime: the shape it takes when published.
// The header this suite's notes point at (why a page module is out of reach
// under Node) is the one atop ./helpers.js, which holds the shared prologue.
//

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { libs } = require('./helpers');

const run = async () => {
  group('tower/app: the runtime’s published shape');

  await test('the pages that read this machine say so instead of drawing empty', () => {
    const pages = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages');
    for (const name of ['crew.js', 'usage.js', 'health.js']) {
      assert(/local: true/.test(fs.readFileSync(path.join(pages, name), 'utf8')), `${name} declares itself local-only`);
    }
    for (const name of ['index.js', 'board.js', 'brief.js']) {
      assert(!/local: true/.test(fs.readFileSync(path.join(pages, name), 'utf8')), `${name} works off-machine and does not`);
    }
  });

  await test('a tokenless landing is sent to Settings, and Settings draws itself where it lands', () => {
    const source = fs.readFileSync(path.join(libs, 'page.js'), 'utf8');
    // The three arms of the locked state, in the order the runtime asks them.
    // Settings FIRST (#167): it is the page the token is typed on, so it draws
    // with nothing behind it - and it is asked before the hostname fork,
    // because a viewer who opened Settings asked for it wherever this page was
    // served from.
    assert(/MODE === 'locked'[\s\S]{0,600}if \(options\.tokenless\) \{\n\s+options\.render\(body, \{ feeds: \{\}, selectedRepo: selectedRepo\(\) \}\);/.test(source),
      'a locked Settings page is rendered, with an empty state and no poller');
    assert(/isLocalHost\(location\.hostname\)\) \{\n\s+body\.innerHTML = towerDownNotice\(location\.href\)/.test(source),
      'a locked copy on this machine is still the tower-down notice, whole page (#89)');
    assert(/body\.innerHTML = settingsNotice\(settingsHref\(selectedRepo\(\)\)\);\n\s+location\.replace\(settingsHref\(selectedRepo\(\)\)\);/.test(source),
      'and anywhere else the page says where the token goes and takes the viewer there');
    assert(/location\.replace\(/.test(source) && !/location\.assign\(/.test(source),
      'replace, so Back does not bounce off a page that has no data either');
    assert(!/body\.innerHTML = tokenPrompt/.test(source), 'the prompt is never the body, and no longer exists to be one');
    assert(/MODE === 'github' && options\.local[\s\S]{0,120}localOnlyNotice\(\)/.test(source), 'and a local-only page says where its data lives');
    assert(source.includes('githubPageFeeds(options.feeds)') && source.includes('githubFetcher'),
      'an unlocked copy polls GitHub through the same loop');
    assert(/githubPageFeeds\(\[name\]\)\[name\]\) state\.feeds\[name\] = localOnlySlot\(\)/.test(source),
      'and a feed only the machine can answer is filled with the marked slot rather than left spinning');
  });

  await test('a published board draws each page of the sweep as it lands (#194)', () => {
    const source = fs.readFileSync(path.join(libs, 'page.js'), 'utf8');
    // The poller's fetcher contract is `(path) => body`, so the progress goes
    // around it rather than through it: the runtime writes the board-so-far
    // into the board feed's own slot, in the shape a landed read has, and
    // paints - and the poller's own answer lands over it at the end.
    assert(/poller\.state\.feeds\.board = \{ ok: true, data: partial, status: null, reason: null \};\n\s+paint\(\);/.test(source),
      'the board so far is written into the slot every reader already reads, and the page is painted from it');
    assert(/fetcher: LIVE \? feedFetcher : \(path\) => githubFetcher\(path, onBoardPage\)/.test(source),
      'and only a published copy carries it - a tower answers the whole board in one read');

    const api = fs.readFileSync(path.join(libs, 'api.js'), 'utf8');
    assert(/githubFetcher = async \(path, onPage\) => unwrapFeed\(await readFeed\(path, \{ \.\.\.githubContext\(\), onPage \}\)\)/.test(api),
      'the fetcher hands it to the one door, beside the token and the fetch');

    const source2 = fs.readFileSync(path.join(libs, 'github.js'), 'utf8');
    assert(/fetchBoard\(slugs, path === '\/api\/board' \? ctx : \{ \.\.\.ctx, onPage: null \}\)/.test(source2),
      'and the brief - built from the same sweep - never pushes half a board into the board’s slot');

    const overview = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages', 'index.js'), 'utf8');
    assert(/\.filter\(\(repo\) => repo\.error \|\| repo\.loading \|\| repo\.truncated\)/.test(overview),
      'the Overview draws a line for a repo that is still arriving, beside the two it already drew');
    assert(/loading \$\{repo\.count\} of \$\{repo\.totalCount\} open issues/.test(overview),
      'the progress line says how many of how many, and clears when the sweep stops marking that repo');
    assert(/inlineLoading\(/.test(overview) && !/spinner-border/.test(overview),
      'drawn with the framework’s own inline wait - the page invents no spinner of its own');
  });

  await test('a token GitHub refused is carried to the page that owns the token', () => {
    // The reason used to be dumped on the page as a bare problem - on a page
    // with no field in it - and then into a dialog nothing could dismiss. Now
    // it goes where a token is typed: Settings reads it off the state and puts
    // it in its own card, and every other page shows the line that points there.
    const source = fs.readFileSync(path.join(libs, 'page.js'), 'utf8');
    assert(/isTokenRefusal/.test(source), 'the refusal is recognised by the one predicate that names it');
    assert(/state\.tokenProblem = refused\.reason/.test(source), 'the reason rides the state, like the selection and the re-read do');
    assert(/if \(!options\.tokenless\) \{\n\s+swap\(body, settingsNotice\(settingsHref\(state\.selectedRepo\), refused\.reason\)\);\n\s+return;/.test(source),
      'every other page draws the pointer line instead of its data');
    assert(/state\.tokenProblem = '';\n\s+if \(MODE === 'github'\)/.test(source),
      'and a paint that finds no refusal clears it, so a 403 that was a rate limit stops being said');
    assert(/swap\(body,/.test(source),
      'written through swap like every page body, so a read landing after all draws the page back over it');
  });

  await test('nothing in the runtime opens a dialog for a token any more', () => {
    const source = fs.readFileSync(path.join(libs, 'page.js'), 'utf8');
    // The runtime and the selector it imports (page/selector.js): the negatives
    // hold over both, the once-per-page count over the runtime alone.
    const whole = source + fs.readFileSync(path.join(libs, 'page', 'selector.js'), 'utf8');
    assert(!/openTokenModal|hideTokenModal|prompted/.test(whole), 'the opener, the closer and the flag between them are gone');
    assert(!/clearToken|readToken|writeToken/.test(whole), 'and so is the chrome’s forget - the token’s storage is Settings’ business now');
    assert(!/TOKEN_KEY/.test(whole), 'the runtime names no token key at all; the storage it does reach is the favorites’ (#186)');
    assertEq((source.match(/chromeMarkup\(\)/g) || []).length, 1, 'the chrome frame is written exactly once per page');
    assert(!/chromeKey/.test(whole), 'with no key to compare, since nothing on it varies');
    assert(!/state\.tokenMode/.test(whole), 'and no flag for a button that no longer exists');
  });

  await test('the Overview says local-only where its machine-bound numbers would be', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages', 'index.js'), 'utf8');
    for (const cell of ['Live sessions', 'Uncommitted', 'Unpushed', 'Unreleased']) {
      assert(new RegExp(`machineStat\\(state, '(sessions|health)', '${cell}'`).test(source), `${cell} is a machine reading, and the tile knows it`);
    }
    assert(/machineStat = \(state, name, label, value, href\) => \(localOnly\(state, name\)[\s\S]{0,120}LOCAL_ONLY_NOTICE\)/.test(source),
      'a local-only feed draws a dash with the sentence, never a 0 summed from an empty feed');
    assert(/localOnly\(state, 'sessions'\)\) body = localOnlyNotice\(\)/.test(source), 'the crew panel says it too');
    assert(/localOnly\(state, 'health'\)\) body = localOnlyNotice\(\)/.test(source),
      'and so does the health panel, which is about readings and not about the roster it lists');
  });

  await test('the Health page names a tower older than its checkout, and nothing otherwise', () => {
    // The page imports the framework, so it is out of reach of these suites
    // (see the header) - what can be pinned is the source of the decision: the
    // notice is drawn from BOTH commits being present and differing, which is
    // what keeps an unreadable git and a published copy silent.
    const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages', 'health.js'), 'utf8');
    assert(/meta\.bootCommit && meta\.currentHead && meta\.bootCommit !== meta\.currentHead/.test(source),
      'both shas present and differing is the whole condition');
    assert(/stale\(meta\)[\s\S]{0,200}npm run tower/.test(source), 'and the notice it draws names the restart command');
    assert(/restartNotice\(meta\)/.test(source), 'which the render actually places');
    assert(/problem\(/.test(source), 'in the framework’s existing warning shape, no new colour pairing');
    assert(/API started/.test(source), 'and the start time is on the page beside it');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
