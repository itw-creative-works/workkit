// Tests for workflow/review/covers.sh (`workkit review covers`): whether the
// full-panel review marker is newer than every path in the working diff. Every
// case is a real throwaway git repo; the marker is written by
// workflow/review/mark.sh (`workkit review mark`) itself under the case's own
// workflow home, so the machine's real marker is never touched.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun, mkTmp, SPAWN_DEADLINE } = require('../lib/harness');
const {
  BASH, NO_RC, shellPath, which, toolStem, basePathWithout,
} = require('../lib/platform');
const { mkRepo } = require('../lib/git-repo');

const REVIEW = path.join(__dirname, '..', '..', 'workflow', 'review');
const SCRIPT = path.join(REVIEW, 'covers.sh');
const MARKER_SCRIPT = path.join(REVIEW, 'mark.sh');

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// An hour back and an hour ahead: far enough from the marker's own second that
// no clock tick decides a case.
const PAST = new Date(Date.now() - 3600 * 1000);
const FUTURE = new Date(Date.now() + 3600 * 1000);

const SETTINGS = '.workkit/settings.json';

// The repo's settings as jq leaves them, the shape the standards heal writes.
const settingsJson = (version, rest = { enabled: true }) => `${JSON.stringify({ version, ...rest }, null, 2)}\n`;

/**
 * A scratch world: a repo holding `src/x.js`, `src/y.js`, `src/gone.js` and,
 * unless `tracked` is false, its settings at version 1, committed, with every
 * file dated an hour back; a home and a TMPDIR beside it.
 * Its `write` dates a file an hour back unless told otherwise.
 */
const mkWorld = ({ tracked = true } = {}) => {
  const files = {};
  for (const name of ['x', 'y', 'gone']) files[`src/${name}.js`] = `module.exports = '${name}';\n`;
  if (tracked) files[SETTINGS] = settingsJson(1);
  const w = mkRepo('review-covers-', files, PAST, { optIn: tracked });
  return { ...w, write: (rel, body, when = PAST) => w.write(rel, body, when) };
};

const spawnIn = (w, script, cwd = w.repo, args = []) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(script), ...args], {
    cwd, env: w.env, encoding: 'utf8', timeout: SPAWN_DEADLINE,
  });
  assert(res.status !== null, `the script finished (no timeout): ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

const writeMarker = (w, cwd = w.repo) => assertEq(spawnIn(w, MARKER_SCRIPT, cwd, ['full']).code, 0,
  'mark.sh full wrote the markers');

/** The one full-panel marker the case's workflow home holds. */
const fullMarker = (w) => {
  const dir = path.join(w.workflowHome, 'markers', 'claude-review-full-marker');
  const [only] = fs.readdirSync(dir);
  return path.join(dir, only);
};

const cases = async () => {
  group('review covers: the verdict');

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
    assertEq(spawnIn(w, MARKER_SCRIPT).code, 0, 'mark.sh wrote the plain marker');
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

  group('review covers: the heal\'s version stamp');

  await test('a code edit before the marker, then only the settings version stamped: covered', () => {
    const w = mkWorld();
    w.write('src/x.js', "module.exports = 'x2';\n");
    writeMarker(w);
    w.write(SETTINGS, settingsJson(2), FUTURE);
    const { code, out, err } = spawnIn(w, SCRIPT);
    assertEq(code, 0, `exit 0: ${out}${err}`);
    assertEq(out, 'review-covers: covered\n', `the stamp alone needs no review: ${out}${err}`);
    cleanup(w.dir);
  });

  await test('the version stamp the only change: stale, no working diff', () => {
    const w = mkWorld();
    writeMarker(w);
    w.write(SETTINGS, settingsJson(2), FUTURE);
    const { code, out, err } = spawnIn(w, SCRIPT);
    assertEq(code, 1, `exit 1: ${out}${err}`);
    assertEq(out, 'review-covers: stale: no working diff\n', `the stamp is no diff to cover: ${out}${err}`);
    cleanup(w.dir);
  });

  await test('the version stamped and another settings key changed: stale, naming the settings', () => {
    const w = mkWorld();
    w.write('src/x.js', "module.exports = 'x2';\n");
    writeMarker(w);
    w.write(SETTINGS, settingsJson(2, { enabled: false }), FUTURE);
    const { code, out, err } = spawnIn(w, SCRIPT);
    assertEq(code, 1, `exit 1: ${out}${err}`);
    assertEq(out, `review-covers: stale: ${SETTINGS}\n`, `the stale line: ${out}${err}`);
    cleanup(w.dir);
  });

  await test('the version stamped and a code file edited: stale, naming the code file only', () => {
    const w = mkWorld();
    writeMarker(w);
    w.write(SETTINGS, settingsJson(2), FUTURE);
    w.write('src/x.js', "module.exports = 'x2';\n", FUTURE);
    const { code, out, err } = spawnIn(w, SCRIPT);
    assertEq(code, 1, `exit 1: ${out}${err}`);
    assertEq(out, 'review-covers: stale: src/x.js\n', `the settings path sorts first, so it is skipped: ${out}${err}`);
    cleanup(w.dir);
  });

  await test('settings not tracked in HEAD: stale, naming the settings', () => {
    const w = mkWorld({ tracked: false });
    w.write('src/x.js', "module.exports = 'x2';\n");
    writeMarker(w);
    w.write(SETTINGS, settingsJson(2), FUTURE);
    const { code, out, err } = spawnIn(w, SCRIPT);
    assertEq(code, 1, `exit 1: ${out}${err}`);
    assertEq(out, `review-covers: stale: ${SETTINGS}\n`, `no HEAD copy to diff against: ${out}${err}`);
    cleanup(w.dir);
  });

  group('review mark: the plain and the full-panel marker');

  // The markers mark.sh left under the case's workflow home, by folder.
  const markersAfter = (args) => {
    const w = mkWorld();
    assertEq(spawnIn(w, MARKER_SCRIPT, w.repo, args).code, 0, `mark.sh ${args.join(' ')} exits 0`);
    const markers = path.join(w.workflowHome, 'markers');
    const count = (dir) => (fs.existsSync(path.join(markers, dir)) ? fs.readdirSync(path.join(markers, dir)).length : 0);
    const found = { plain: count('claude-review-marker'), full: count('claude-review-full-marker') };
    cleanup(w.dir);
    return found;
  };

  await test('mark.sh full writes both review markers', () => {
    assertEq(JSON.stringify(markersAfter(['full'])), JSON.stringify({ plain: 1, full: 1 }), 'the plain and the full-panel marker');
  });

  await test('mark.sh with no argument writes the plain marker alone', () => {
    assertEq(JSON.stringify(markersAfter([])), JSON.stringify({ plain: 1, full: 0 }), 'no full-panel marker');
  });

  group('review covers: usage');

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
      cwd: w.repo, env: { ...w.env, PATH: bin }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
    });
    assertEq(res.status, 2, `exit 2: ${res.stdout}${res.stderr}`);
    assertEq(res.stdout, '', 'nothing on stdout');
    const lines = res.stderr.split('\n').filter(Boolean);
    assert(lines.length === 1 && lines[0].startsWith('review-covers: '), `one review-covers: line: ${res.stderr}`);
    cleanup(w.dir);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(module.exports);
