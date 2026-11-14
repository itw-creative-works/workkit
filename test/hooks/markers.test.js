// Tests for the pure helpers in hooks/mods/markers.js: the gh journal mark (journalSizes, the folder's sized
// listing, journalMarkText and journalMarks, the mark's text and its read back, and journalsGrown, the pick of the
// journals a Bash call's Post hook reads), the marker paths, the folders Git Bash means by a path, and sessionPath,
// the session's PATH with the git shim's folder first. The mark written and read through the hooks module:
// test/mods/post-tool-use-bash.test.ts; the session's PATH set through it: test/mods/session-path.test.ts.

const { describe, test, expect } = require('../lib/harness');
const { mods } = require('../lib/mods-inputs');
const { OPT_IN_SHAPES } = require('../lib/git-repo');

const markers = () => mods('markers');

const SHA1_THING = '15da8f6dacb5c1cbf08b4fbd577410882e5c5ae4';
const same = (actual, expected, label) => expect(JSON.stringify(actual), label).toBe(JSON.stringify(expected));

const HOME = '/w/home/.workkit';
const A = '/w/home/.workkit/markers/claude-gh-journal/aaa';
const B = '/w/home/.workkit/markers/claude-gh-journal/bbb';
const C = '/w/home/.workkit/markers/claude-gh-journal/ccc';
const D = '/w/home/.workkit/markers/claude-gh-journal/ddd';
const SIZES = { [A]: 62, [B]: 0 };

describe('markers: the gh journal mark', () => {
  test('case 9: two sized journals make a path line and a length line each, in the order given, and read back as the same pairs', () => {
    const text = markers().journalMarkText([{ journal: A, bytes: 62 }, { journal: B, bytes: 0 }]);
    expect(text, 'the mark text').toBe(`${A}\n62\n${B}\n0`);
    same(markers().journalMarks(text), [{ journal: A, bytes: 62 }, { journal: B, bytes: 0 }], 'the mark read back');
  });

  test('case 9: no journals make the empty mark, read back as none', () => {
    const text = markers().journalMarkText([]);
    expect(text, 'the mark text').toBe('');
    same(markers().journalMarks(text), [], 'the mark read back');
  });

  test('case 9: journalSizes lists the journal folder and answers each journal\'s full path and length, in name order', async () => {
    const listed = [];
    const list = async (dir) => {
      listed.push(dir);
      return ['bbb', 'aaa'];
    };
    const sized = await markers().journalSizes(list, async (journal) => SIZES[journal], HOME);
    same(listed, [`${HOME}/markers/claude-gh-journal`], 'the folder listed');
    same(sized, [{ journal: A, bytes: 62 }, { journal: B, bytes: 0 }], 'aaa before bbb, each with its length');
  });

  test('case 10: an empty path line is skipped with its length line', () => {
    same(markers().journalMarks(`\n5\n${B}\n9`), [{ journal: B, bytes: 9 }], 'the one named journal');
  });
});

describe('markers: journalsGrown', () => {
  const MARKS = [{ journal: A, bytes: 10 }, { journal: B, bytes: 20 }, { journal: C, bytes: 30 }];

  test('case 11: a grown journal answers its marked length, an unmarked one and one shorter than its mark 0, in the order after the call', () => {
    const now = [{ journal: D, bytes: 7 }, { journal: A, bytes: 15 }, { journal: C, bytes: 12 }];
    same(markers().journalsGrown(MARKS, now), [{ journal: D, bytes: 0 }, { journal: A, bytes: 10 }, { journal: C, bytes: 0 }], 'D from its start, A past 10, C from its start');
  });

  test('case 11: a journal at its marked length is left out', () => {
    const now = [{ journal: B, bytes: 20 }];
    same(markers().journalsGrown(MARKS, now), [], 'B at its length');
  });
});

describe('markers: the marker paths', () => {
  // The workflow home is handed over explicitly: the marker lives under its
  // markers folder, keyed by the sha1 of the root (SHA1_THING, of /repos/thing).
  // A session marker lives under the session's TMPDIR.
  const WH = '/w/home/.workkit';
  const TMP = '/w/tmp';

  test('hook_review_marker_path is the review marker dir plus the sha of the root', async () => {
    expect(await markers().reviewMarkerPath('/repos/thing', WH), 'the path').toBe(`${WH}/markers/claude-review-marker/${SHA1_THING}`);
  });

  test('hook_review_full_marker_path is the full-panel marker dir plus the sha of the root', async () => {
    expect(await markers().reviewFullMarkerPath('/repos/thing', WH), 'the path').toBe(`${WH}/markers/claude-review-full-marker/${SHA1_THING}`);
  });

  test('hook_triage_marker_path is the triage marker dir plus the sha of the anchor', async () => {
    expect(await markers().triageMarkerPath('/repos/thing', WH), 'the path').toBe(`${WH}/markers/claude-triage-marker/${SHA1_THING}`);
  });

  test('wk_suite_marker_path is the suite marker dir plus the sha of the root', async () => {
    expect(await markers().suiteMarkerPath('/repos/thing', WH), 'the path').toBe(`${WH}/markers/claude-suite-marker/${SHA1_THING}`);
  });

  test('hook_session_marker is the named dir plus the session id with every non-alphanumeric as _', async () => {
    expect(await markers().sessionMarker('workkit-thing', 'ab-12/c.d e', TMP), 'the path').toBe(`${TMP}/workkit-thing/ab_12_c_d_e`);
  });
});

describe('markers: shellDirOf and tempDirOf, the folder Git Bash means by a path and by ${TMPDIR:-/tmp}', () => {
  // The Windows inputs are handed over, so every branch runs on any platform.
  const WIN = { TEMP: 'D:\\a\\_temp', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' };

  test('off Windows TMPDIR is the answer as given, /tmp when unset', () => {
    expect(markers().tempDirOf({ TMPDIR: '/var/folders/gx/T/', ...WIN }, 'darwin'), 'as given').toBe('/var/folders/gx/T/');
    expect(markers().tempDirOf({ ...WIN }, 'linux'), 'unset reads /tmp, whatever TEMP says').toBe('/tmp');
  });

  test('on Windows /tmp, unset or with a rest, is the Windows temp folder plus the rest', () => {
    expect(markers().tempDirOf({ ...WIN }, 'win32'), 'unset is TEMP').toBe('D:/a/_temp');
    expect(markers().tempDirOf({ TMPDIR: '/tmp', ...WIN }, 'win32'), '/tmp is TEMP').toBe('D:/a/_temp');
    expect(markers().tempDirOf({ TMPDIR: '/tmp/cg-x/', ...WIN }, 'win32'), 'the rest kept, its trailing slash off').toBe('D:/a/_temp/cg-x');
    const local = { LOCALAPPDATA: WIN.LOCALAPPDATA };
    expect(markers().tempDirOf({ TMPDIR: '/tmp/cg-x', ...local }, 'win32'), 'no TEMP: %LOCALAPPDATA%\\Temp').toBe('C:/Users/x/AppData/Local/Temp/cg-x');
    expect(markers().tempDirOf({ TEMP: '/tmp', ...local }, 'win32'), 'a POSIX TEMP names no Windows folder').toBe('C:/Users/x/AppData/Local/Temp');
  });

  test('on Windows a native TMP outranks TEMP, as Git Bash mounts /tmp on it', () => {
    expect(markers().tempDirOf({ TMPDIR: '/tmp/cg-x', TMP: 'C:\\Users\\x\\Tmp', ...WIN }, 'win32'), 'TMP first').toBe('C:/Users/x/Tmp/cg-x');
    expect(markers().tempDirOf({ TMP: '/tmp', ...WIN }, 'win32'), 'a POSIX TMP falls through to TEMP').toBe('D:/a/_temp');
  });

  test('on Windows the /<drive>/ form is that drive', () => {
    expect(markers().tempDirOf({ TMPDIR: '/d/a/_temp/cg-x', ...WIN }, 'win32'), 'the drive form').toBe('D:/a/_temp/cg-x');
  });

  test('on Windows a native path is as given, in forward slashes', () => {
    expect(markers().tempDirOf({ TMPDIR: 'D:\\a\\_temp\\cg-x\\', ...WIN }, 'win32'), 'backslashes').toBe('D:/a/_temp/cg-x');
    expect(markers().tempDirOf({ TMPDIR: 'E:/scratch', ...WIN }, 'win32'), 'forward slashes').toBe('E:/scratch');
  });

  test('shellEnvOf: TMPDIR, WORKFLOW_HOME and HOME are the folders they name; an unset one stays unset', () => {
    const got = markers().shellEnvOf({ TMPDIR: '/tmp/cg-x', WORKFLOW_HOME: '/c/Users/x/wk', HOME: '/c/Users/x', X: '1', ...WIN }, 'win32');
    expect(got.TMPDIR, 'TMPDIR').toBe('D:/a/_temp/cg-x');
    expect(got.WORKFLOW_HOME, 'WORKFLOW_HOME').toBe('C:/Users/x/wk');
    expect(got.HOME, 'HOME').toBe('C:/Users/x');
    expect(got.X, 'the rest rides along').toBe('1');
    const unset = markers().shellEnvOf({ ...WIN }, 'win32');
    expect(unset.TMPDIR, 'TMPDIR unset reads /tmp').toBe('D:/a/_temp');
    expect(!('WORKFLOW_HOME' in unset) && !('HOME' in unset), 'an unset folder is not added').toBeTruthy();
    expect(markers().shellEnvOf({ TMPDIR: '/var/t', HOME: '/Users/x' }, 'darwin').HOME, 'off Windows as given').toBe('/Users/x');
  });

  test('guards: the facts carry TMPDIR as the folder it names, by the kit root\'s spelling', async () => {
    // The file chain's folder is an opted-in repo, so the guard below runs.
    const read = async (p) => (p === '/r/.workkit/settings.json' ? OPT_IN_SHAPES.current : null);
    const io = { pluginRoot: 'C:/kit', top: async () => '/r', read, run: async () => null, stat: async () => null, now: () => 0 };
    const call = { cwd: '/r' };
    const { bashFacts } = mods('facts');
    expect(bashFacts(io, { TMPDIR: '/tmp/cg-x', ...WIN }, call).env.TMPDIR, 'a drive-letter kit translates').toBe('D:/a/_temp/cg-x');
    expect(bashFacts({ ...io, pluginRoot: '/kit' }, { TMPDIR: '/tmp/cg-x', ...WIN }, call).env.TMPDIR, 'a POSIX kit reads it as given').toBe('/tmp/cg-x');
    expect(bashFacts(io, { WORKFLOW_HOME: '/c/Users/x/wk', ...WIN }, call).env.WORKFLOW_HOME, 'the machine folder too').toBe('C:/Users/x/wk');
    const chain = await mods('guards').runChain(io, { TMPDIR: '/tmp/cg-x', ...WIN }, [{ hook: 'safety:vendor-guard', run: async (facts) => ({ context: facts.env.TMPDIR }) }], { tool: 'Write', gateDir: '/r' });
    expect(chain.notice, 'the file chain\'s facts translate the same').toBe('D:/a/_temp/cg-x');
  });
});

describe('markers: sessionPath, the session\'s PATH with the git shim\'s folder first', () => {
  const SHIM = '/kit/workflow/gitshim';

  test('a PATH without the folder gets it first, the rest kept in order', () => {
    expect(markers().sessionPath('/usr/bin:/bin', SHIM, 'darwin'), 'the folder first').toBe(`${SHIM}:/usr/bin:/bin`);
    expect(markers().sessionPath(`/usr/bin:${SHIM}:/bin`, SHIM, 'linux'), 'a later copy does not count as first').toBe(`${SHIM}:/usr/bin:${SHIM}:/bin`);
  });

  test('a PATH that already starts with the folder is the same string', () => {
    const current = `${SHIM}:/usr/bin:/bin`;
    expect(markers().sessionPath(current, SHIM, 'darwin'), 'unchanged').toBe(current);
  });

  test('on Windows the folder is in its native form and the separator is ;, and a second pass changes nothing', () => {
    const current = 'C:\\Windows\\system32;C:\\Program Files\\Git\\bin';
    const once = markers().sessionPath(current, 'C:/kit/workflow/gitshim', 'win32');
    const [first, ...rest] = once.split(';');
    // Either slash spells a native Windows path; the drive form is what Git Bash's /c/ form is not.
    expect(first.replace(/\\/g, '/'), `the folder first, in its drive form, got: ${once}`).toBe('C:/kit/workflow/gitshim');
    expect(rest.join(';'), 'then ; and the PATH as it was').toBe(current);
    expect(markers().sessionPath(once, 'C:/kit/workflow/gitshim', 'win32'), 'already first: unchanged').toBe(once);
  });
});
