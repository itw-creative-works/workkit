// Tests for workflow/review/covers.sh (`workkit review covers`): whether the
// full-panel review marker is newer than every path in the working diff. Every
// case is a real throwaway git repo; the marker is written by
// workflow/review/mark.sh (`workkit review mark`) itself under the case's own
// workflow home, so the machine's real marker is never touched.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect, mkTmp, SPAWN_DEADLINE } = require('../lib/harness');
const {
  BASH, NO_RC, shellPath, which, toolStem, basePathWithout,
} = require('../lib/platform');
const { mkRepo, OPT_IN_SHAPES } = require('../lib/git-repo');

const REVIEW = path.join(__dirname, '..', '..', 'workflow', 'review');
const SCRIPT = path.join(REVIEW, 'covers.sh');
const MARKER_SCRIPT = path.join(REVIEW, 'mark.sh');

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// An hour back and an hour ahead: far enough from the marker's own second that
// no clock tick decides a case.
const PAST = new Date(Date.now() - 3600 * 1000);
const FUTURE = new Date(Date.now() + 3600 * 1000);

const SETTINGS = '.workkit/settings.json';

// A settings text as jq leaves it.
const settingsJson = (keys) => `${JSON.stringify(keys, null, 2)}\n`;

/**
 * A scratch world: a repo holding `src/x.js`, `src/y.js`, `src/gone.js` and,
 * unless `tracked` is false, its settings carrying a version key, committed, with every
 * file dated an hour back; a home and a TMPDIR beside it.
 * Its `write` dates a file an hour back unless told otherwise.
 */
const mkWorld = ({ tracked = true } = {}) => {
  const files = {};
  for (const name of ['x', 'y', 'gone']) files[`src/${name}.js`] = `module.exports = '${name}';\n`;
  if (tracked) files[SETTINGS] = OPT_IN_SHAPES.retired;
  const w = mkRepo('review-covers-', files, PAST, { optIn: tracked });
  return { ...w, write: (rel, body, when = PAST) => w.write(rel, body, when) };
};

const spawnIn = (w, script, cwd = w.repo, args = []) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(script), ...args], {
    cwd, env: w.env, encoding: 'utf8', timeout: SPAWN_DEADLINE,
  });
  expect(res.status !== null, `the script finished (no timeout): ${res.error || ''}`).toBeTruthy();
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

const writeMarker = (w, cwd = w.repo) => expect(spawnIn(w, MARKER_SCRIPT, cwd, ['full']).code, 'mark.sh full wrote the markers').toBe(0);

/** The one full-panel marker the case's workflow home holds. */
const fullMarker = (w) => {
  const dir = path.join(w.workflowHome, 'markers', 'claude-review-full-marker');
  const [only] = fs.readdirSync(dir);
  return path.join(dir, only);
};

describe('review covers: the verdict', () => {
  test('a marker newer than every edited, staged, deleted and untracked path: covered', () => {
    const w = mkWorld();
    w.write('src/x.js', "module.exports = 'x2';\n");
    w.write('src/y.js', "module.exports = 'y2';\n");
    w.git('add', 'src/y.js');
    fs.rmSync(path.join(w.repo, 'src', 'gone.js'));
    w.write('src/new.js', "module.exports = 'new';\n");
    // The deletion dated the folder now; a same-second marker would not cover it.
    fs.utimesSync(path.join(w.repo, 'src'), PAST, PAST);
    writeMarker(w);
    const { code, out, err } = spawnIn(w, SCRIPT);
    expect(code, `exit 0: ${err}`).toBe(0);
    expect(out, `the covered line: ${out}`).toBe('review-covers: covered\n');
    cleanup(w.dir);
  });

  test('a tracked file edited after the marker: stale, naming it', () => {
    const w = mkWorld();
    w.write('src/y.js', "module.exports = 'y2';\n");
    writeMarker(w);
    w.write('src/x.js', "module.exports = 'x2';\n", FUTURE);
    const { code, out, err } = spawnIn(w, SCRIPT);
    expect(code, `exit 1: ${out}${err}`).toBe(1);
    expect(out, `the stale line: ${out}${err}`).toBe('review-covers: stale: src/x.js\n');
    cleanup(w.dir);
  });

  test('an untracked file newer than the marker: stale, naming it', () => {
    const w = mkWorld();
    writeMarker(w);
    w.write('src/new.js', "module.exports = 'new';\n", FUTURE);
    const { code, out, err } = spawnIn(w, SCRIPT);
    expect(code, `exit 1: ${out}${err}`).toBe(1);
    expect(out, `the stale line: ${out}${err}`).toBe('review-covers: stale: src/new.js\n');
    cleanup(w.dir);
  });

  test('a tracked file deleted after the marker: stale, naming it', () => {
    const w = mkWorld();
    writeMarker(w);
    fs.rmSync(path.join(w.repo, 'src', 'gone.js'));
    // The deletion's own second can be the marker's, so the folder is dated past it.
    fs.utimesSync(path.join(w.repo, 'src'), FUTURE, FUTURE);
    const { code, out, err } = spawnIn(w, SCRIPT);
    expect(code, `exit 1: ${out}${err}`).toBe(1);
    expect(out, `the stale line: ${out}${err}`).toBe('review-covers: stale: src/gone.js\n');
    cleanup(w.dir);
  });

  test('an edit stamped the marker\'s own second: stale, naming it', () => {
    const w = mkWorld();
    writeMarker(w);
    const at = fs.statSync(fullMarker(w)).mtime;
    w.write('src/x.js', "module.exports = 'x2';\n", at);
    const { code, out, err } = spawnIn(w, SCRIPT);
    expect(code, `exit 1: ${out}${err}`).toBe(1);
    expect(out, `the stale line: ${out}${err}`).toBe('review-covers: stale: src/x.js\n');
    cleanup(w.dir);
  });

  test('no marker: stale, no full-panel marker', () => {
    const w = mkWorld();
    const { code, out, err } = spawnIn(w, SCRIPT);
    expect(code, `exit 1: ${out}${err}`).toBe(1);
    expect(out, `the no-marker line: ${out}${err}`).toBe('review-covers: stale: no full-panel marker\n');
    cleanup(w.dir);
  });

  test('only the plain review marker: stale, no full-panel marker', () => {
    const w = mkWorld();
    w.write('src/x.js', "module.exports = 'x2';\n");
    expect(spawnIn(w, MARKER_SCRIPT).code, 'mark.sh wrote the plain marker').toBe(0);
    const { code, out, err } = spawnIn(w, SCRIPT);
    expect(code, `exit 1: ${out}${err}`).toBe(1);
    expect(out, `a lone lens covers nothing: ${out}${err}`).toBe('review-covers: stale: no full-panel marker\n');
    cleanup(w.dir);
  });

  test('an empty working diff: stale, no working diff', () => {
    const w = mkWorld();
    writeMarker(w);
    const { code, out, err } = spawnIn(w, SCRIPT);
    expect(code, `exit 1: ${out}${err}`).toBe(1);
    expect(out, `the script cannot see commits: ${out}${err}`).toBe('review-covers: stale: no working diff\n');
    cleanup(w.dir);
  });
});

describe('review covers: the heal\'s removal of the version key', () => {
  test('a code edit before the marker, then only the settings version key removed: covered', () => {
    const w = mkWorld();
    w.write('src/x.js', "module.exports = 'x2';\n");
    writeMarker(w);
    w.write(SETTINGS, OPT_IN_SHAPES.current, FUTURE);
    const { code, out, err } = spawnIn(w, SCRIPT);
    expect(code, `exit 0: ${out}${err}`).toBe(0);
    expect(out, `the removal alone needs no review: ${out}${err}`).toBe('review-covers: covered\n');
    cleanup(w.dir);
  });

  test('the version key\'s removal the only change: stale, no working diff', () => {
    const w = mkWorld();
    writeMarker(w);
    w.write(SETTINGS, OPT_IN_SHAPES.current, FUTURE);
    const { code, out, err } = spawnIn(w, SCRIPT);
    expect(code, `exit 1: ${out}${err}`).toBe(1);
    expect(out, `the removal is no diff to cover: ${out}${err}`).toBe('review-covers: stale: no working diff\n');
    cleanup(w.dir);
  });

  test('the version key removed and another settings key changed: stale, naming the settings', () => {
    const w = mkWorld();
    w.write('src/x.js', "module.exports = 'x2';\n");
    writeMarker(w);
    w.write(SETTINGS, settingsJson({ enabled: false }), FUTURE);
    const { code, out, err } = spawnIn(w, SCRIPT);
    expect(code, `exit 1: ${out}${err}`).toBe(1);
    expect(out, `the stale line: ${out}${err}`).toBe(`review-covers: stale: ${SETTINGS}\n`);
    cleanup(w.dir);
  });

  test('the version key removed and a code file edited: stale, naming the code file only', () => {
    const w = mkWorld();
    writeMarker(w);
    w.write(SETTINGS, OPT_IN_SHAPES.current, FUTURE);
    w.write('src/x.js', "module.exports = 'x2';\n", FUTURE);
    const { code, out, err } = spawnIn(w, SCRIPT);
    expect(code, `exit 1: ${out}${err}`).toBe(1);
    expect(out, `the settings path sorts first, so it is skipped: ${out}${err}`).toBe('review-covers: stale: src/x.js\n');
    cleanup(w.dir);
  });

  test('settings not tracked in HEAD: stale, naming the settings', () => {
    const w = mkWorld({ tracked: false });
    w.write('src/x.js', "module.exports = 'x2';\n");
    writeMarker(w);
    w.write(SETTINGS, OPT_IN_SHAPES.current, FUTURE);
    const { code, out, err } = spawnIn(w, SCRIPT);
    expect(code, `exit 1: ${out}${err}`).toBe(1);
    expect(out, `no HEAD copy to diff against: ${out}${err}`).toBe(`review-covers: stale: ${SETTINGS}\n`);
    cleanup(w.dir);
  });
});

describe('review mark: the plain and the full-panel marker', () => {
  // The markers mark.sh left under the case's workflow home, by folder.
  const markersAfter = (args) => {
    const w = mkWorld();
    expect(spawnIn(w, MARKER_SCRIPT, w.repo, args).code, `mark.sh ${args.join(' ')} exits 0`).toBe(0);
    const markers = path.join(w.workflowHome, 'markers');
    const count = (dir) => (fs.existsSync(path.join(markers, dir)) ? fs.readdirSync(path.join(markers, dir)).length : 0);
    const found = { plain: count('claude-review-marker'), full: count('claude-review-full-marker') };
    cleanup(w.dir);
    return found;
  };

  test('mark.sh full writes both review markers', () => {
    expect(JSON.stringify(markersAfter(['full'])), 'the plain and the full-panel marker').toBe(JSON.stringify({ plain: 1, full: 1 }));
  });

  test('mark.sh with no argument writes the plain marker alone', () => {
    expect(JSON.stringify(markersAfter([])), 'no full-panel marker').toBe(JSON.stringify({ plain: 1, full: 0 }));
  });
});

describe('review covers: a repo with no commit yet', () => {
  // A repo beside the world's with no commit, `a.js` staged and dated an hour back, the full-panel marker written.
  const unbornMarked = (w) => {
    const fresh = path.join(w.dir, 'fresh');
    fs.mkdirSync(fresh);
    const git = (...args) => expect(spawnSync('git', args, { cwd: fresh, env: w.env }).status, `git ${args[0]}`).toBe(0);
    git('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(fresh, 'a.js'), 'a\n');
    fs.utimesSync(path.join(fresh, 'a.js'), PAST, PAST);
    git('add', 'a.js');
    writeMarker(w, fresh);
    return fresh;
  };

  test('a staged file older than the marker: covered', () => {
    const w = mkWorld();
    const fresh = unbornMarked(w);
    const { code, out, err } = spawnIn(w, SCRIPT, fresh);
    expect(code, `exit 0, the staged file is the diff: ${out}${err}`).toBe(0);
    expect(out, `the covered line: ${out}${err}`).toBe('review-covers: covered\n');
    cleanup(w.dir);
  });

  test('a staged file written after the marker: stale, naming it', () => {
    const w = mkWorld();
    const fresh = unbornMarked(w);
    fs.writeFileSync(path.join(fresh, 'a.js'), 'a2\n');
    fs.utimesSync(path.join(fresh, 'a.js'), FUTURE, FUTURE);
    const { code, out, err } = spawnIn(w, SCRIPT, fresh);
    expect(code, `exit 1: ${out}${err}`).toBe(1);
    expect(out, `the staged file is never dropped: ${out}${err}`).toBe('review-covers: stale: a.js\n');
    cleanup(w.dir);
  });
});

describe('review covers: usage', () => {
  test('outside a git repo: exit 2 with one review-covers: line', () => {
    const w = mkWorld();
    const { code, out, err } = spawnIn(w, SCRIPT, w.tmp);
    expect(code, `exit 2: ${err}`).toBe(2);
    expect(out, 'nothing on stdout').toBe('');
    expect(err.split('\n').filter(Boolean).length === 1 && err.startsWith('review-covers: '), `one line: ${err}`).toBeTruthy();
    cleanup(w.dir);
  });

  test('no shasum and no sha1sum on PATH: exit 2 with one review-covers: line', () => {
    const w = mkWorld();
    const bin = basePathWithout(mkTmp('review-covers-'), 'shasum');
    for (const name of fs.readdirSync(bin)) {
      if (toolStem(name) === 'sha1sum') fs.rmSync(path.join(bin, name));
    }
    expect(!which('shasum', bin) && !which('sha1sum', bin), 'the PATH holds neither hash command').toBeTruthy();
    const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT)], {
      cwd: w.repo, env: { ...w.env, PATH: bin }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
    });
    expect(res.status, `exit 2: ${res.stdout}${res.stderr}`).toBe(2);
    expect(res.stdout, 'nothing on stdout').toBe('');
    const lines = res.stderr.split('\n').filter(Boolean);
    expect(lines.length === 1 && lines[0].startsWith('review-covers: '), `one review-covers: line: ${res.stderr}`).toBeTruthy();
    cleanup(w.dir);
  });
});
