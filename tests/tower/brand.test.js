//
// Tests for the tower's brand mark, pinned on the authored source (the svg and the
// config keys, JSON5 read as text), never the minted tree a fresh clone lacks.
//

const fs = require('fs');
const path = require('path');
const { group, test, assert, summary, selfRun } = require('../lib/harness');

const app = path.join(__dirname, '..', '..', 'tower', 'app');
const MARK = path.join(app, 'assets', 'logo', 'brandmark.svg');
const CONFIG = path.join(app, 'config', 'omega.json5');
const TARGET = path.join(app, 'targets', 'web');

// What @omega.js/web's ensure-target step writes when missing (its scaffold/
// tree and the brand-root workflow); committed, so a dev or build leaves it clean.
const SCAFFOLD = [
  path.join(app, '.github', 'workflows', 'web-build.yml'),
  path.join(TARGET, '.gitattributes'),
  path.join(TARGET, '.gitignore'),
  path.join(TARGET, '.nvmrc'),
  path.join(TARGET, 'src', 'pages', 'example.md.txt'),
  path.join(TARGET, 'src', 'service-worker.js'),
];

// The one hex: the config's `color` composes both themes' accent ramps from it,
// and the mark is drawn in it. An accent the mark does not wear is two brands.
const BRAND = '#2563EB';

// The drawn extent of the mark, in viewBox units, read off its shapes and any
// translate on a <g>. An arc must be a half circle, so the ring it belongs to
// is the box it adds; any other element or command fails loudly, never skips.
const EPS = 0.01;
const glyphBox = (svg) => {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const offsets = [[0, 0]];
  const add = (x, y) => {
    const [dx, dy] = offsets[offsets.length - 1];
    box.minX = Math.min(box.minX, x + dx);
    box.maxX = Math.max(box.maxX, x + dx);
    box.minY = Math.min(box.minY, y + dy);
    box.maxY = Math.max(box.maxY, y + dy);
  };
  const attr = (attrs, name) => Number((attrs.match(new RegExp(`\\b${name}="([^"]+)"`)) || [])[1]);
  const tracePath = (d) => {
    const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g);
    let x = 0;
    let y = 0;
    let startX = 0;
    let startY = 0;
    let cmd = null;
    let i = 0;
    const num = () => Number(tokens[i++]);
    while (i < tokens.length) {
      if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
      const rel = cmd === cmd.toLowerCase();
      const ox = rel ? x : 0;
      const oy = rel ? y : 0;
      switch (cmd.toUpperCase()) {
        case 'M': case 'L':
          x = ox + num();
          y = oy + num();
          if (cmd.toUpperCase() === 'M') {
            startX = x;
            startY = y;
            cmd = rel ? 'l' : 'L';
          }
          break;
        case 'H': x = ox + num(); break;
        case 'V': y = oy + num(); break;
        case 'Z':
          x = startX;
          y = startY;
          break;
        case 'A': {
          const rx = num();
          const ry = num();
          i += 3;
          const ex = ox + num();
          const ey = oy + num();
          assert(rx === ry && Math.abs(Math.hypot(ex - x, ey - y) - 2 * rx) < EPS, `arc ${x},${y} -> ${ex},${ey} r${rx} is not a half circle`);
          const cx = (x + ex) / 2;
          const cy = (y + ey) / 2;
          add(cx - rx, cy - rx);
          add(cx + rx, cy + rx);
          x = ex;
          y = ey;
          break;
        }
        default: throw new Error(`path command ${cmd} is not measured`);
      }
      add(x, y);
    }
  };

  for (const [, close, tag, attrs] of svg.matchAll(/<(\/?)([a-zA-Z]+)\b([^>]*)>/g)) {
    if (tag === 'svg') continue;
    if (tag === 'g') {
      if (close) {
        offsets.pop();
        continue;
      }
      const t = attrs.match(/transform="translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)"/);
      assert(t || !/transform=/.test(attrs), `a <g> transform other than translate is not measured: ${attrs}`);
      const [dx, dy] = offsets[offsets.length - 1];
      offsets.push(t ? [dx + Number(t[1]), dy + Number(t[2])] : [dx, dy]);
      if (/\/\s*$/.test(attrs)) offsets.pop();
      continue;
    }
    if (close) continue;
    if (tag === 'circle') {
      const [cx, cy, r] = ['cx', 'cy', 'r'].map((name) => attr(attrs, name));
      add(cx - r, cy - r);
      add(cx + r, cy + r);
    } else if (tag === 'rect') {
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((name) => attr(attrs, name));
      add(x, y);
      add(x + w, y + h);
    } else if (tag === 'path') {
      tracePath(attrs.match(/\bd="([^"]+)"/)[1]);
    } else {
      throw new Error(`<${tag}> is not measured`);
    }
  }
  return box;
};

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

  await test('the glyph fills the box edge to edge across and sits centered down, on a bare canvas', () => {
    const svg = fs.readFileSync(MARK, 'utf8');
    const open = svg.match(/<svg\b[^>]*>/)[0];
    assert(!/\s(width|height)=/.test(open), 'no width/height: the viewBox alone sizes the mark');
    const viewBox = open.match(/viewBox="0 0 (\d+) \1"/);
    assert(viewBox, `an integer square viewBox - got ${open}`);

    const n = Number(viewBox[1]);
    const box = glyphBox(svg);
    const fmt = `x ${box.minX}..${box.maxX}, y ${box.minY}..${box.maxY} in 0 0 ${n} ${n}`;
    assert(Math.abs(box.minX) < EPS && Math.abs(box.maxX - n) < EPS, `the glyph spans the full width - ${fmt}`);
    assert(Math.abs(box.minY - (n - box.maxY)) < EPS, `equal space above and below - ${fmt}`);
    assert(!/<rect\b/.test(svg), 'no <rect>: the canvas is transparent');
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
