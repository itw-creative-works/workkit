// Tests for workflow/lib/lock.js, the lock folder's rules in Node: the create-only claim,
// plain and tagged, the mark a run lock's claim names, the retire by that mark, the adopt
// of a folder with no mark, the judged retire every remover shares and the plain mutex. Each
// yes or no is a boolean, compared exactly. The 7-day sweep is held by its twin in twins.test.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect, mkTmp } = require('../lib/harness');
const {
  handLock, claimNaming, tagOf, deadPid, holding,
} = require('../lib/supervise');

const LOCK = path.join(__dirname, '..', '..', 'workflow', 'lib', 'lock.js');
const {
  claimDir, lockMark, retireLock, adoptLock, retireJudged, takeLock, dropLock,
} = require(LOCK);

/** A run lock folder made by hand in a scratch folder, holding <files>. */
const lockOf = (files) => handLock(path.join(mkTmp('lock-folder-'), 'lock'), files);
/** <lock>'s claim text, trimmed. */
const claimOf = (lock) => fs.readFileSync(path.join(lock, 'claim'), 'utf8').trim();

describe('lock.js: claimDir', () => {
  test('a tagged claim of a folder not there: true, the folder holding its claim naming the tag and the one mark id.<tag>; a second tagged claim: false, the folder as it was', () => {
    const lock = path.join(mkTmp('lock-claim-'), 'lock');
    expect(claimDir(lock, 'a.1.1'), 'the first claim takes the folder').toBe(true);
    expect(holding(lock), 'its claim and its one mark').toBe('claim id.a.1.1');
    expect(claimOf(lock), 'the claim names the tag').toBe('a.1.1');
    expect(claimDir(lock, 'b.1.1'), 'a folder that holds anything is another caller\'s').toBe(false);
    expect(holding(lock), 'the first claim\'s folder as it was, no id.b.1.1 left').toBe('claim id.a.1.1');
    expect(claimOf(lock), 'its claim still names the first tag').toBe('a.1.1');
  });

  test('a plain claim: true for the caller that makes the claim, false for the next, the folder holding the claim alone', () => {
    const lock = path.join(mkTmp('lock-plain-'), 'lock');
    expect(claimDir(lock), 'the first claim').toBe(true);
    expect(claimDir(lock), 'the second claim of the held folder').toBe(false);
    expect(holding(lock), 'the claim alone').toBe('claim');
  });
});

describe('lock.js: lockMark', () => {
  test('the id the claim names, a leftover id beside it or not; else gone.x; else id.orphan; null for an empty claim alone', () => {
    for (const [files, mark, what] of [
      [{ claim: claimNaming('a'), 'id.a': '', pid: '4242\n' }, 'id.a', 'a claim naming id.a'],
      [{ claim: claimNaming('a'), 'id.a': '', 'id.b': '', pid: '4242\n' }, 'id.a', 'a claim naming id.a and a leftover id.b'],
      [{ claim: claimNaming('a'), 'gone.x': '', pid: '4242\n' }, 'gone.x', 'gone.x and no named id'],
      [{ claim: '', 'id.orphan': '', pid: '4242\n' }, 'id.orphan', 'id.orphan alone'],
    ]) {
      expect(lockMark(lockOf(files)), what).toBe(mark);
    }
    expect(lockMark(lockOf({ claim: '', pid: '4242\n' })), 'an empty claim and no mark: null').toBe(null);
  });
});

describe('lock.js: retireLock', () => {
  test('an old mark on a lock made since: false, the new lock whole, its claim and pid file as they were', () => {
    const lock = lockOf({ claim: claimNaming('new'), 'id.new': '', pid: '4242\n' });
    expect(retireLock(lock, 'id.old'), 'a mark the folder does not hold').toBe(false);
    expect(holding(lock), 'the new lock is whole').toBe('claim id.new pid');
    expect(claimOf(lock), 'its claim still names the new mark').toBe('new');
    expect(fs.readFileSync(path.join(lock, 'pid'), 'utf8'), 'its pid file still names the new run').toBe('4242\n');
  });

  test('the mark the folder\'s claim names: true, the folder gone', () => {
    const lock = lockOf({ claim: claimNaming('a'), 'id.a': '', pid: '4242\n', done: '0\n' });
    expect(retireLock(lock, 'id.a'), 'the mark the folder holds').toBe(true);
    expect(holding(lock), 'the folder was removed').toBe('(none)');
  });

  test('a mark another caller already renamed to gone.x: false, the folder as that caller left it', () => {
    const lock = lockOf({ claim: claimNaming('a'), 'gone.x': '', pid: '4242\n' });
    expect(retireLock(lock, 'id.a'), 'a mark already retired').toBe(false);
    expect(holding(lock), 'the folder is as the other caller left it').toBe('claim gone.x pid');
  });

  test('the gone.<tag> mark of a live remover: false, the folder as it was', () => {
    const gone = `gone.${tagOf(process.pid)}`;
    const dead = deadPid();
    const lock = lockOf({ claim: claimNaming('a'), [gone]: '', pid: `${dead}\n`, done: '0\n' });
    expect(retireLock(lock, gone), 'a live remover keeps its mark').toBe(false);
    expect(holding(lock), 'the folder\'s files as they were').toBe(['claim', 'done', gone, 'pid'].sort().join(' '));
    expect(fs.readFileSync(path.join(lock, 'pid'), 'utf8'), 'its pid file as it was').toBe(`${dead}\n`);
  });
});

describe('lock.js: adoptLock', () => {
  test('a lock a live run holds, its mark there: false, no id.orphan left, its claim and mark unchanged', () => {
    const lock = lockOf({ claim: claimNaming('live'), 'id.live': '', pid: `${process.pid}\n` });
    expect(adoptLock(lock), 'a mark is there').toBe(false);
    expect(holding(lock), 'no id.orphan, the live lock whole').toBe('claim id.live pid');
    expect(claimOf(lock), 'its claim still names its mark').toBe('live');
  });

  test('a folder with no mark, empty or an older kit\'s lock of an empty claim and a gone pid: true, the folder gone', () => {
    for (const [files, what] of [[{}, 'an empty folder'], [{ claim: '', pid: `${deadPid()}\n` }, 'an older kit\'s lock']]) {
      const lock = lockOf(files);
      expect(adoptLock(lock), `${what} is adopted`).toBe(true);
      expect(holding(lock), `${what}: the folder was removed`).toBe('(none)');
    }
  });

  test('names read, then the folder changed (a new taker\'s lock in its place, or one more file): false given the old names, the folder untouched, no id.orphan left', () => {
    const dead = deadPid();
    const taken = lockOf({ pid: `${dead}\n` });
    const seenTaken = fs.readdirSync(taken).sort();
    fs.rmSync(taken, { recursive: true });
    handLock(taken, { claim: claimNaming('new'), 'id.new': '' });
    expect(adoptLock(taken, seenTaken), 'a new taker\'s lock is not adopted').toBe(false);
    expect(holding(taken), 'the new taker\'s files untouched, no id.orphan').toBe('claim id.new');
    expect(claimOf(taken), 'its claim still names its mark').toBe('new');
    const grown = lockOf({ pid: `${dead}\n` });
    const seenGrown = fs.readdirSync(grown).sort();
    fs.writeFileSync(path.join(grown, 'done'), '0\n');
    expect(adoptLock(grown, seenGrown), 'a folder that holds one more file is not adopted').toBe(false);
    expect(holding(grown), 'no id.orphan, the folder otherwise as it was').toBe('done pid');
    expect(fs.readFileSync(path.join(grown, 'pid'), 'utf8'), 'its pid file untouched').toBe(`${dead}\n`);
  });
});

describe('lock.js: retireJudged', () => {
  /** A judge answering <over>, counting its calls. */
  const judgeOf = (over) => {
    const judge = () => { judge.asked += 1; return over; };
    judge.asked = 0;
    return judge;
  };

  test('a lock judged over is retired by its mark: true; one judged live stays whole: the judge\'s false', async () => {
    const over = lockOf({ claim: claimNaming('a'), 'id.a': '', pid: `${deadPid()}\n`, done: '0\n' });
    const yesJudge = judgeOf(true);
    expect(await retireJudged(over, yesJudge), 'the folder went').toBe(true);
    expect(yesJudge.asked > 0, 'the judge was asked').toBeTruthy();
    expect(holding(over), 'the lock judged over is gone').toBe('(none)');
    const live = lockOf({ claim: claimNaming('b'), 'id.b': '', pid: `${process.pid}\n` });
    expect(await retireJudged(live, judgeOf(false)), 'the judge\'s own answer').toBe(false);
    expect(holding(live), 'the lock judged live is whole').toBe('claim id.b pid');
  });

  test('a gone.<tag> mark whose remover lives: null, the judge never asked, nothing touched', async () => {
    const gone = `gone.${tagOf(process.pid)}`;
    const lock = lockOf({ claim: claimNaming('a'), [gone]: '', pid: `${deadPid()}\n` });
    const judge = judgeOf(true);
    expect(await retireJudged(lock, judge), 'a live remover answers before any judge').toBe(null);
    expect(judge.asked, 'the judge was never asked').toBe(0);
    expect(holding(lock), 'the folder as it was').toBe(['claim', gone, 'pid'].sort().join(' '));
  });

  test('a folder with no mark judged over is adopted: true, the folder gone, no id.orphan left', async () => {
    const lock = lockOf({ pid: `${deadPid()}\n` });
    expect(await retireJudged(lock, judgeOf(true)), 'the folder went').toBe(true);
    expect(holding(lock), 'the folder was removed').toBe('(none)');
  });

  test('a lock made in the old one\'s place while the judge looked: false, the new lock whole', async () => {
    const lock = lockOf({ claim: claimNaming('old'), 'id.old': '', pid: `${deadPid()}\n`, done: '0\n' });
    // The judge reads the old run as over, and meanwhile a new taker replaces the folder.
    const judge = () => {
      fs.rmSync(lock, { recursive: true });
      handLock(lock, { claim: claimNaming('new'), 'id.new': '', pid: `${process.pid}\n` });
      return true;
    };
    expect(await retireJudged(lock, judge), 'the old mark is gone, so another caller retired it first').toBe(false);
    expect(holding(lock), 'the new lock is whole').toBe('claim id.new pid');
    expect(claimOf(lock), 'its claim still names the new mark').toBe('new');
  });
});

describe('lock.js: takeLock and dropLock', () => {
  test('a take makes the folder\'s parent; the drop removes the folder, and the next take holds it again', async () => {
    const lock = path.join(mkTmp('lock-mutex-'), 'state', 'lock');
    expect(await takeLock(lock), 'the take of a folder whose parent is not there').toBe(true);
    expect(holding(lock), 'the folder holds its claim').toBe('claim');
    dropLock(lock);
    expect(holding(lock), 'the drop removed the folder').toBe('(none)');
    expect(await takeLock(lock), 'the next take').toBe(true);
  });

  test('a drop while a new taker\'s file sits in the folder: the claim goes, the folder stays', () => {
    const lock = lockOf({ claim: '', next: '' });
    dropLock(lock);
    expect(holding(lock), 'the folder stays with the other file alone').toBe('next');
  });
});
