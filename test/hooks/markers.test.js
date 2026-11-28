// Tests for the pure helpers in hooks/mods/markers.js: the gh journal mark (journalSizes, the folder's sized
// listing, journalMarkText and journalMarks, the mark's text and its read back, and journalsGrown, the pick of the
// journals a Bash call's Post hook reads), the call's marks on a real disk (markCall, callSince and journalSize in
// hooks/mods/guards.js), the marker paths, the folders Git Bash means by a path, the home variables only Git Bash
// can read, and sessionPath,
// the session's PATH with the git shim's folder first. The mark written and read through the hooks module:
// test/mods/post-tool-use-bash.test.ts; the session's PATH set through it: test/mods/session-path.test.ts.

const fs = require('fs');
const path = require('path');
const { describe, test, expect, mkTmp } = require('../lib/harness');
const { mods } = require('../lib/mods-inputs');
const { OPT_IN_SHAPES } = require('../lib/git-repo');
const { nodeHomeEnv } = require('../lib/platform');
const { ioIn } = require('../../workflow/lib/io');

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

  // A live mark is never empty: an empty one is a mark the Post hook ended.
  test('case 9: no journals make a mark of one empty line, read back as a mark of no journals', () => {
    const text = markers().journalMarkText([]);
    expect(text, 'the mark text').toBe('\n');
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

describe('markers: the call\'s marks on disk, markCall, callSince and journalSize in hooks/mods/guards.js', () => {
  const guards = () => mods('guards');
  const CALL_MS = 1700000000000;
  // The machine io over a scratch machine folder with one gh journal, `aaa`, each program it starts recorded.
  const diskWorld = () => {
    const dir = mkTmp('markers-disk-');
    const home = path.join(dir, '.workkit');
    const env = nodeHomeEnv(dir, { PATH: process.env.PATH, WORKFLOW_HOME: home });
    const base = ioIn(env);
    const starts = [];
    const io = { ...base, now: () => CALL_MS, run: (argv, init) => { starts.push(argv); return base.run(argv, init); } };
    const journal = `${home}/markers/claude-gh-journal/aaa`;
    fs.mkdirSync(path.dirname(journal), { recursive: true });
    fs.writeFileSync(journal, 'x\n');
    return { dir, home, env, io, starts, journal };
  };
  const marksOf = async (w, id) => ({
    mark: await markers().journalMarkPath(id, w.home),
    start: await markers().callStartPath(id, w.home),
  });
  const textOf = (file) => fs.readFileSync(file, 'utf8');

  test('case 16: marks written into folders that do not exist yet land, and no program starts', async () => {
    const w = diskWorld();
    await guards().markCall(w.io, w.env, 'toolu_1', w.dir);
    const { mark, start } = await marksOf(w, 'toolu_1');
    expect(textOf(mark), 'the journal mark landed: the journal and its length').toBe(`${w.journal}\n2`);
    expect(textOf(start), 'the call start landed: the time, then no repo root').toBe(`${CALL_MS}\n`);
    expect(w.starts, 'no mkdir, nor any other program').toEqual([]);
  });

  test('case 13: the Post read ends the call\'s mark and start by writing each empty, starting no program; the next read finds no marker', async () => {
    const w = diskWorld();
    await guards().markCall(w.io, w.env, 'toolu_1', w.dir);
    w.starts.length = 0;
    expect(await guards().callSince(w.io, w.env, 'toolu_1'), 'the first read: no journal grew, the start time, no repo').toEqual({ lines: [], since: CALL_MS, began: null });
    const { mark, start } = await marksOf(w, 'toolu_1');
    expect([textOf(mark), textOf(start)], 'both marks stay on disk, empty').toEqual(['', '']);
    expect(w.starts, 'no rm, nor any other program').toEqual([]);

    // A line the gate kept: an empty mark read as a mark of no journals would hand it over as the call's.
    fs.appendFileSync(w.journal, `${CALL_MS}\tissue\tedit\tacme/repo\t12\tstatus:qa\t\t\n`);
    expect(await guards().callSince(w.io, w.env, 'toolu_1'), 'the next read: no marker, so no lines and no start').toEqual({ lines: [], since: null, began: null });
    expect(w.starts, 'and still no program').toEqual([]);
  });

  // A journal line the gate writes, its cwd empty so the opt-in filter keeps it, and the line read back.
  const lineOf = (n, repo) => `${CALL_MS + n}\tissue\tedit\t${repo}\t${n}\tstatus:qa\t\t\n`;
  const parsed = (n, repo) => ({ ms: CALL_MS + n, verb: 'issue', sub: 'edit', repo, numbers: [String(n)], add: ['status:qa'], remove: [], cwd: '' });

  test('a journal that grew after the mark: callSince reads the lines it gained, not those before the mark, and no program starts', async () => {
    const w = diskWorld();
    fs.writeFileSync(w.journal, lineOf(11, 'acme/repo'));
    await guards().markCall(w.io, w.env, 'toolu_1', w.dir);
    fs.appendFileSync(w.journal, lineOf(12, 'acme/repo'));
    w.starts.length = 0;
    expect(await guards().callSince(w.io, w.env, 'toolu_1'), 'the #12 line alone').toEqual({ lines: [parsed(12, 'acme/repo')], since: CALL_MS, began: null });
    expect(w.starts, 'no tail, nor any other program').toEqual([]);
  });

  // One read answers at most 4 MiB. The line's two-byte character starts on the last byte of the first range past
  // the mark, so a reader that decodes each range alone, or stops at the edge, breaks or loses the line.
  test('case 14b: a journal grown past 4 MiB: the line across the range edge arrives whole, its two-byte character included', async () => {
    const w = diskWorld();
    await guards().markCall(w.io, w.env, 'toolu_1', w.dir);
    const line = lineOf(12, 'acme/ré');
    const before = Buffer.byteLength(line.slice(0, line.indexOf('é')));
    const pad = 4 * 1024 * 1024 - 1 - before;
    fs.appendFileSync(w.journal, `${'#'.repeat(pad - 1)}\n${line}`);
    w.starts.length = 0;
    expect(await guards().callSince(w.io, w.env, 'toolu_1'), 'the #12 line, whole').toEqual({ lines: [parsed(12, 'acme/ré')], since: CALL_MS, began: null });
    expect(w.starts, 'and no program').toEqual([]);
  });

  test('case 14: journalSize is the journal\'s length in bytes off its stat, 0 for a missing journal, and starts no program', async () => {
    const w = diskWorld();
    fs.writeFileSync(w.journal, 'héllo\n');
    expect(await guards().journalSize(w.io, w.journal), 'six characters, seven bytes').toBe(7);
    expect(await guards().journalSize(w.io, `${w.home}/markers/claude-gh-journal/none`), 'a missing journal').toBe(0);
    expect(w.starts, 'no wc, nor any other program').toEqual([]);
  });
});

describe('markers: the marker paths', () => {
  // The workflow home is handed over explicitly: the marker lives under its
  // markers folder, keyed by the sha1 of the root (SHA1_THING, of /repos/thing).
  // A session marker lives under the session's TMPDIR.
  const WH = '/w/home/.workkit';
  const TMP = '/w/tmp';

  test('reviewMarkerPath is the review marker dir plus the sha of the root', async () => {
    expect(await markers().reviewMarkerPath('/repos/thing', WH), 'the path').toBe(`${WH}/markers/claude-review-marker/${SHA1_THING}`);
  });

  test('reviewFullMarkerPath is the full-panel marker dir plus the sha of the root', async () => {
    expect(await markers().reviewFullMarkerPath('/repos/thing', WH), 'the path').toBe(`${WH}/markers/claude-review-full-marker/${SHA1_THING}`);
  });

  test('triageMarkerPath is the triage marker dir plus the sha of the anchor', async () => {
    expect(await markers().triageMarkerPath('/repos/thing', WH), 'the path').toBe(`${WH}/markers/claude-triage-marker/${SHA1_THING}`);
  });

  test('suiteMarkerPath is the suite marker dir plus the sha of the root', async () => {
    expect(await markers().suiteMarkerPath('/repos/thing', WH), 'the path').toBe(`${WH}/markers/claude-suite-marker/${SHA1_THING}`);
  });

  test('sessionKey spells a session id as a file name, every character but a letter or a digit as _', () => {
    expect(markers().sessionKey('a1-b.c'), 'the key').toBe('a1_b_c');
  });

  test('sessionMarker is the named dir plus the session id with every non-alphanumeric as _', async () => {
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

  test('shellEnvOf: TMPDIR, WORKFLOW_HOME, WORKFLOW_CLAUDE_HOME and HOME are the folders they name; an unset one stays unset', () => {
    const got = markers().shellEnvOf({
      TMPDIR: '/tmp/cg-x', WORKFLOW_HOME: '/c/Users/x/wk', WORKFLOW_CLAUDE_HOME: '/tmp/ch', HOME: '/c/Users/x', X: '1', ...WIN,
    }, 'win32');
    expect(got.TMPDIR, 'TMPDIR').toBe('D:/a/_temp/cg-x');
    expect(got.WORKFLOW_HOME, 'WORKFLOW_HOME').toBe('C:/Users/x/wk');
    expect(got.WORKFLOW_CLAUDE_HOME, 'WORKFLOW_CLAUDE_HOME').toBe('D:/a/_temp/ch');
    expect(got.HOME, 'HOME').toBe('C:/Users/x');
    expect(got.X, 'the rest rides along').toBe('1');
    const unset = markers().shellEnvOf({ ...WIN }, 'win32');
    expect(unset.TMPDIR, 'TMPDIR unset reads /tmp').toBe('D:/a/_temp');
    expect(!('WORKFLOW_HOME' in unset) && !('HOME' in unset), 'an unset folder is not added').toBeTruthy();
    expect(markers().shellEnvOf({ TMPDIR: '/var/t', HOME: '/Users/x' }, 'darwin').HOME, 'off Windows as given').toBe('/Users/x');
  });

  test('shellOnlyHomes: on Windows the home variables set to a folder only Git Bash can read, each spelled as given; none off Windows', () => {
    const { shellOnlyHomes } = markers();
    expect(shellOnlyHomes({ WORKFLOW_HOME: '/home/x/.workkit', HOME: '/c/Users/x', ...WIN }, 'win32'), 'a /home path, beside a drive mount')
      .toEqual([{ name: 'WORKFLOW_HOME', spelled: '/home/x/.workkit' }]);
    expect(shellOnlyHomes({ HOME: '/cygdrive/c/x', ...WIN }, 'win32'), 'a /cygdrive path').toEqual([{ name: 'HOME', spelled: '/cygdrive/c/x' }]);
    for (const folder of ['/c/x', '/tmp/wk', 'C:/x', 'C:\\x', '//server/x']) {
      const all = { WORKFLOW_HOME: folder, WORKFLOW_CLAUDE_HOME: folder, HOME: folder, ...WIN };
      expect(shellOnlyHomes(all, 'win32'), `${folder} in each of the three, with a native TEMP`).toEqual([]);
    }
    expect(shellOnlyHomes({ ...WIN }, 'win32'), 'none set').toEqual([]);
    for (const platform of ['darwin', 'linux']) {
      expect(shellOnlyHomes({ HOME: '/home/x' }, platform), `${platform}: a /home path is any program's`).toEqual([]);
    }
  });

  // The Windows folder Git Bash's / is, as a node started from Git Bash reads a /home value under it.
  const SHELL_ROOT = 'C:/Program Files/Git';

  test('shellOnlyHomes: on Windows a home variable inside the Git Bash root is named, however its spelling, and spelled as Git Bash spells it', () => {
    const { shellOnlyHomes } = markers();
    const named = (value, root, label) => expect(shellOnlyHomes({ WORKFLOW_HOME: value, ...WIN }, 'win32', root), label)
      .toEqual([{ name: 'WORKFLOW_HOME', spelled: '/home/x' }]);
    named('C:/Program Files/Git/home/x', SHELL_ROOT, 'a /home path as Git Bash hands it on');
    named('C:\\Program Files\\Git\\home\\x', SHELL_ROOT, 'the same folder in backslashes');
    named('c:/Program Files/Git/home/x', SHELL_ROOT, 'the same folder with a lower-case drive letter');
    named('C:/Program Files/Git/home/x', `${SHELL_ROOT}/`, 'the root given with a closing slash');
    expect(shellOnlyHomes({ HOME: 'C:/Program Files/Git', WORKFLOW_HOME: 'C:/Program Files/Git/home/x/.workkit', ...WIN }, 'win32', SHELL_ROOT), 'the root itself is /, in HOME_VARS order')
      .toEqual([{ name: 'WORKFLOW_HOME', spelled: '/home/x/.workkit' }, { name: 'HOME', spelled: '/' }]);
  });

  test('shellOnlyHomes: on Windows a folder outside the Git Bash root is not named, nor one inside it with no root given', () => {
    const { shellOnlyHomes } = markers();
    expect(shellOnlyHomes({ WORKFLOW_HOME: 'C:/Users/x', ...WIN }, 'win32', SHELL_ROOT), 'a drive path elsewhere').toEqual([]);
    expect(shellOnlyHomes({ WORKFLOW_HOME: 'C:/Program Files/Gitea/x', ...WIN }, 'win32', SHELL_ROOT), 'a folder sharing only the root\'s first letters').toEqual([]);
    expect(shellOnlyHomes({ WORKFLOW_HOME: 'C:/Program Files/Git/home/x', ...WIN }, 'win32'), 'no root given').toEqual([]);
  });

  test('shellOnlyHomes: off Windows a root names nothing either', () => {
    const { shellOnlyHomes } = markers();
    const homes = { WORKFLOW_HOME: 'C:/Program Files/Git/home/x', HOME: '/home/x' };
    for (const platform of ['darwin', 'linux']) {
      expect(shellOnlyHomes(homes, platform, SHELL_ROOT), `${platform}: with the root`).toEqual([]);
      expect(shellOnlyHomes(homes, platform), `${platform}: with no root`).toEqual([]);
    }
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
