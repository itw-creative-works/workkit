//
// Tests for the tower's brand mark - the three AUTHORED artifacts of #53.
//
// Everything else the mark becomes is MINTED: the favicon set, the PNG ladder,
// the pure-black variant, the copies the web build bridges to
// /assets/images/brand/. Those live in the gitignored `.omega/` and `dist/`,
// they are regenerated on every manage cycle, and asserting on them here would
// pin a generated tree that no commit carries - a red suite on a fresh clone
// that has never run a build. So the pins are on the SOURCE: the svg in the
// brand repo's logo dir, and the two config keys that decide what the framework
// does with it.
//
// The config is JSON5 and this repo's tests carry no dependencies, so it is
// read as TEXT - the same way app.test.js asks its questions of main.scss.
// The next group pins two config shapes the installed omega depends on: the
// target's type, which its validator refuses without, and the absence of a
// repo block, whose presence would switch the repo service on. The last group
// pins the scaffold omega writes into the target: every dev or build writes
// any of those files it finds missing, so a committed set is what keeps the
// tree clean after a run.
//

const fs = require('fs');
const path = require('path');
const { group, test, assert, summary, selfRun } = require('../lib/harness');

const app = path.join(__dirname, '..', '..', 'tower', 'app');
const MARK = path.join(app, 'assets', 'logo', 'brandmark.svg');
const CONFIG = path.join(app, 'config', 'omega.json5');
const TARGET = path.join(app, 'targets', 'web');

// What @omega.js/web's ensure-target step writes when missing (its scaffold/
// tree, and the brand-root workflow it composes from it).
const SCAFFOLD = [
  path.join(app, '.github', 'workflows', 'web-build.yml'),
  path.join(TARGET, '.gitattributes'),
  path.join(TARGET, '.gitignore'),
  path.join(TARGET, '.nvmrc'),
  path.join(TARGET, 'src', 'pages', 'example.md.txt'),
  path.join(TARGET, 'src', 'service-worker.js'),
];

// The one hex (issue #53, owner decision 2026-08-03; blue since #149) - the
// config's `color` composes both themes' accent ramps from it, and the mark is
// drawn in it. ONE hex for both: an accent the mark does not wear is two brands.
const BRAND = '#2563EB';

const run = async () => {
  group('tower/brand: the mark');

  await test('the brandmark source is where the assets service looks for it', () => {
    assert(fs.existsSync(MARK), 'tower/app/assets/logo/brandmark.svg - the root of every derived asset');
  });

  await test('it is one brand fill, square, and carries no text', () => {
    const svg = fs.readFileSync(MARK, 'utf8');
    const fills = svg.match(/#[0-9A-Fa-f]{3,8}/g) || [];
    assert(fills.length > 0, 'the mark states its color');
    assert(fills.every((hex) => hex.toUpperCase() === BRAND), `every fill is ${BRAND}, so the black variant reduces cleanly - found ${fills.join(', ')}`);

    const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
    assert(viewBox, 'it declares a viewBox');
    assert(viewBox[1] === viewBox[2], `square, so the favicon ladder crops nothing - got ${viewBox[1]}x${viewBox[2]}`);

    assert(!/<text|<tspan/.test(svg), 'no text: the wordmark is composed from brand.font, never drawn into the mark');
  });

  group('tower/brand: what the config does with it');

  await test('brand.color is the one hex', () => {
    const config = fs.readFileSync(CONFIG, 'utf8');
    assert(new RegExp(`color:\\s*"${BRAND}"`).test(config), `brand.color: "${BRAND}" - the accent ramps are derived from it`);
  });

  await test('brand.images.brandmark points at the path the web build bridges to', () => {
    const config = fs.readFileSync(CONFIG, 'utf8');
    assert(/brandmark:\s*"\/assets\/images\/brand\/brandmark\.svg"/.test(config),
      'the key is not auto-set by the mint - without it the sidebar stays text-only (@omega.js/web static-assets.js copies the color variant to exactly this path)');
  });

  group('tower/brand: the target type and the repo block');

  await test('targets.web declares its type', () => {
    // Every target key is a name and every entry names its framework; an
    // entry without one fails the build's config validation outright.
    const config = fs.readFileSync(CONFIG, 'utf8');
    assert(/targets:\s*\{\s*web:\s*\{[\s\S]*?type:\s*["']web["']/.test(config), 'targets.web carries type: "web"');
  });

  await test('the config carries no repo block', () => {
    // Presence is the switch: a repo block would derive a `workkit-omega`
    // source repo the manager should reconcile, and the tower's source is
    // workkit's own repo, which the manager never touches.
    const config = fs.readFileSync(CONFIG, 'utf8');
    assert(!/^\s*repo:\s*\{/m.test(config), 'no repo: block in the brand config');
  });

  group('tower/brand: the scaffold omega writes');

  await test('every scaffold file is committed, so a dev or build leaves the tree clean', () => {
    const missing = SCAFFOLD.filter((file) => !fs.existsSync(file));
    assert(missing.length === 0, `missing: ${missing.map((file) => path.relative(app, file)).join(', ')}`);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
