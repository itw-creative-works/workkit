// Tests for scripts/review-covers.sh: whether the full-panel review marker is
// newer than every path in the working diff. Every case is a real throwaway git
// repo; the marker is written by scripts/review-marker.sh itself under the
// case's own TMPDIR, so the machine's real marker is never touched.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const {
  BASH, NO_RC, shellPath, which, toolStem, basePathWithout,
} = require('../lib/platform');
const { mkTmp } = require('../lib/scratch');
const { mkRepo } = require('../lib/git-repo');

const SCRIPTS = path.join(__dirname, '..', '..', 'scripts');
const SCRIPT = path.join(SCRIPTS, 'review-covers.sh');
const MARKER_SCRIPT = path.join(SCRIPTS, 'review-marker.sh');

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// An hour back and an hour ahead: far enough from the marker's own second that
// no clock tick decides a case.
const PAST = new Date(Date.now() - 3600 * 1000);
const FUTURE = new Date(Date.now() + 3600 * 1000);

/**
 * A scratch world: a repo holding `src/x.js`, `src/y.js` and `src/gone.js`,
 * committed, with every file dated an hour back; a home and a TMPDIR beside it.
 * Its `write` dates a file an hour back unless told otherwise.
 */
const mkWorld = () => {
  const files = {};
  for (const name of ['x', 'y', 'gone']) files[`src/${name}.js`] = `module.exports = '${name}';\n`;
  const w = mkRepo('review-covers-', files, PAST);
  return { ...w, write: (rel, body, when = PAST) => w.write(rel, body, when) };
};

const spawnIn = (w, script, cwd = w.repo, args = []) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(script), ...args], {
    cwd, env: w.env, encoding: 'utf8', timeout: 20000,
  });
  assert(res.status !== null, `the script finished (no timeout): ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

const writeMarker = (w, cwd = w.repo) => assertEq(spawnIn(w, MARKER_SCRIPT, cwd, ['full']).code, 0,
  'review-marker.sh full wrote the markers');

/** The one full-panel marker the case's TMPDIR holds. */
const fullMarker = (w) => {
  const dir = path.join(w.tmp, 'claude-review-full-marker');
  const [only] = fs.readdirSync(dir);
  return path.join(dir, only);
};

const run = async () => {
  group('review-covers.sh: the verdict');

  await test('a marker newer than every edited, staged, deleted and untracked path: covered', () => {
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
    assertEq(code, 0, `exit 0: ${err}`);
    assertEq(out, 'review-covers: covered\n', `the covered line: ${out}`);
    cleanup(w.dir);
  });

  await test('a tracked file edited after the marker: stale, naming it', () => {
    const w = mkWorld();
    w.write('src/y.js', "module.exports = 'y2';\n");
    writeMarker(w);
    w.write('src/x.js', "module.exports = 'x2';\n", FUTURE);
    const { code, out, err } = spawnIn(w, SCRIPT);
    assertEq(code, 1, `exit 1: ${out}${err}`);
    assertEq(out, 'review-covers: stale: src/x.js\n', `the stale line: ${out}${err}`);
    cleanup(w.dir);
  });

  await test('an untracked file newer than the marker: stale, naming it', () => {
    const w = mkWorld();
    writeMarker(w);
    w.write('src/new.js', "module.exports = 'new';\n", FUTURE);
    const { code, out, err } = spawnIn(w, SCRIPT);
    assertEq(code, 1, `exit 1: ${out}${err}`);
    assertEq(out, 'review-covers: stale: src/new.js\n', `the stale line: ${out}${err}`);
    cleanup(w.dir);
  });

  await test('a tracked file deleted after the marker: stale, naming it', () => {
    const w = mkWorld();
    writeMarker(w);
    fs.rmSync(path.join(w.repo, 'src', 'gone.js'));
    // The deletion's own second can be the marker's, so the folder is dated past it.
    fs.utimesSync(path.join(w.repo, 'src'), FUTURE, FUTURE);
    const { code, out, err } = spawnIn(w, SCRIPT);
    assertEq(code, 1, `exit 1: ${out}${err}`);
    assertEq(out, 'review-covers: stale: src/gone.js\n', `the stale line: ${out}${err}`);
    cleanup(w.dir);
  });

  await test('an edit stamped the marker\'s own second: stale, naming it', () => {
    const w = mkWorld();
    writeMarker(w);
    const at = fs.statSync(fullMarker(w)).mtime;
    w.write('src/x.js', "module.exports = 'x2';\n", at);
    const { code, out, err } = spawnIn(w, SCRIPT);
    assertEq(code, 1, `exit 1: ${out}${err}`);
    assertEq(out, 'review-covers: stale: src/x.js\n', `the stale line: ${out}${err}`);
    cleanup(w.dir);
  });

  await test('no marker: stale, no full-panel marker', () => {
    const w = mkWorld();
    const { code, out, err } = spawnIn(w, SCRIPT);
    assertEq(code, 1, `exit 1: ${out}${err}`);
    assertEq(out, 'review-covers: stale: no full-panel marker\n', `the no-marker line: ${out}${err}`);
    cleanup(w.dir);
  });

  await test('only the plain review marker: stale, no full-panel marker', () => {
    const w = mkWorld();
    w.write('src/x.js', "module.exports = 'x2';\n");
    assertEq(spawnIn(w, MARKER_SCRIPT).code, 0, 'review-marker.sh wrote the plain marker');
    const { code, out, err } = spawnIn(w, SCRIPT);
    assertEq(code, 1, `exit 1: ${out}${err}`);
    assertEq(out, 'review-covers: stale: no full-panel marker\n', `a lone lens covers nothing: ${out}${err}`);
    cleanup(w.dir);
  });

  await test('an empty working diff: stale, no working diff', () => {
    const w = mkWorld();
    writeMarker(w);
    const { code, out, err } = spawnIn(w, SCRIPT);
    assertEq(code, 1, `exit 1: ${out}${err}`);
    assertEq(out, 'review-covers: stale: no working diff\n', `the script cannot see commits: ${out}${err}`);
    cleanup(w.dir);
  });

  group('review-marker.sh: the plain and the full-panel marker');

  // The markers review-marker.sh left under the case's TMPDIR, by folder.
  const markersAfter = (args) => {
    const w = mkWorld();
    assertEq(spawnIn(w, MARKER_SCRIPT, w.repo, args).code, 0, `review-marker.sh ${args.join(' ')} exits 0`);
    const count = (dir) => (fs.existsSync(path.join(w.tmp, dir)) ? fs.readdirSync(path.join(w.tmp, dir)).length : 0);
    const found = { plain: count('claude-review-marker'), full: count('claude-review-full-marker') };
    cleanup(w.dir);
    return found;
  };

  await test('review-marker.sh full writes both review markers', () => {
    assertEq(JSON.stringify(markersAfter(['full'])), JSON.stringify({ plain: 1, full: 1 }), 'the plain and the full-panel marker');
  });

  await test('review-marker.sh with no argument writes the plain marker alone', () => {
    assertEq(JSON.stringify(markersAfter([])), JSON.stringify({ plain: 1, full: 0 }), 'no full-panel marker');
  });

  group('review-covers.sh: usage');

  await test('a git read that fails (no commit yet): exit 2 with one review-covers: line', () => {
    const w = mkWorld();
    const fresh = path.join(w.dir, 'fresh');
    fs.mkdirSync(fresh);
    const git = (...args) => assertEq(spawnSync('git', args, { cwd: fresh, env: w.env }).status, 0, `git ${args[0]}`);
    git('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(fresh, 'a.js'), 'a\n');
    git('add', 'a.js');
    writeMarker(w, fresh);
    const { code, out, err } = spawnIn(w, SCRIPT, fresh);
    assertEq(code, 2, `exit 2, never a verdict: ${out}${err}`);
    assertEq(out, '', 'nothing on stdout');
    assertEq(err, 'review-covers: could not list the working diff.\n', `the one line: ${err}`);
    cleanup(w.dir);
  });

  await test('outside a git repo: exit 2 with one review-covers: line', () => {
    const w = mkWorld();
    const { code, out, err } = spawnIn(w, SCRIPT, w.tmp);
    assertEq(code, 2, `exit 2: ${err}`);
    assertEq(out, '', 'nothing on stdout');
    assert(err.split('\n').filter(Boolean).length === 1 && err.startsWith('review-covers: '), `one line: ${err}`);
    cleanup(w.dir);
  });

  await test('no shasum and no sha1sum on PATH: exit 2 with one review-covers: line', () => {
    const w = mkWorld();
    const bin = basePathWithout(mkTmp('review-covers-'), 'shasum');
    for (const name of fs.readdirSync(bin)) {
      if (toolStem(name) === 'sha1sum') fs.rmSync(path.join(bin, name));
    }
    assert(!which('shasum', bin) && !which('sha1sum', bin), 'the PATH holds neither hash command');
    const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT)], {
      cwd: w.repo, env: { ...w.env, PATH: bin }, encoding: 'utf8', timeout: 20000,
    });
    assertEq(res.status, 2, `exit 2: ${res.stdout}${res.stderr}`);
    assertEq(res.stdout, '', 'nothing on stdout');
    const lines = res.stderr.split('\n').filter(Boolean);
    assert(lines.length === 1 && lines[0].startsWith('review-covers: '), `one review-covers: line: ${res.stderr}`);
    cleanup(w.dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(module.exports);
