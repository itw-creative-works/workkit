//
// Tests for standards.sh: the local working files it seeds.
// The shared prologue (the repo and gh-stub factories, runScript, the constants) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const {
  group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR: W,
} = require('../../lib/harness');
const { cleanup, makeRepo, readFile, runScript } = require('./helpers');

const run = async () => {
  group('standards.sh: local working files');

  await test('creates .workkit/capture.md with the capture header', () => {
    const repo = makeRepo();
    runScript(repo);
    const capture = path.join(repo, W, 'capture.md');
    assert(fs.existsSync(capture), 'the capture file is created');
    const text = fs.readFileSync(capture, 'utf8');
    assert(text.includes('Triage drains every entry'), 'header explains the drain');
    cleanup(repo);
  });

  await test('never overwrites a capture file that has entries', () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, W, 'capture.md'), 'my precious note\n');
    const { output: stdout } = runScript(repo);
    assertEq(fs.readFileSync(path.join(repo, W, 'capture.md'), 'utf8'), 'my precious note\n', 'existing content untouched');
    assert(stdout.includes('already exists'), 'reported as a skip');
    cleanup(repo);
  });

  await test('creates .workkit/agents/session.md with its three fixed sections', () => {
    const repo = makeRepo();
    runScript(repo);
    const text = readFile(path.join(repo, W, 'agents', 'session.md'));
    assert(text.startsWith('# Session'), `titled Session, got: ${text.slice(0, 20)}`);
    for (const section of ['## Active', '## Queue', '## Notes']) {
      assert(text.includes(section), `${section} present`);
    }
    // Fixed shape: the three sections and nothing else.
    assertEq((text.match(/^## /gm) || []).length, 3, 'exactly three sections');
    assert(/priority.*high/i.test(text) && /low/i.test(text), 'Queue states the order rule');
    assert(/promoted/i.test(text), 'Notes states the promotion rule');
    cleanup(repo);
  });

  await test('the seeded session.md states its purpose and the light bar', () => {
    // The docs:session hook reads this file back at every session start; the
    // header is what tells the agent it is a queue and not a journal.
    const repo = makeRepo();
    runScript(repo);
    const text = readFile(path.join(repo, W, 'agents', 'session.md'));
    assert(/compaction/i.test(text), 'names the job it does: surviving a compaction');
    assert(/40/.test(text), 'states the light bar');
    cleanup(repo);
  });

  await test('never overwrites a session file that has content', () => {
    const repo = makeRepo();
    fs.mkdirSync(path.join(repo, W, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(repo, W, 'agents', 'session.md'), '# Session\n\n## Active\n#42: mid-flight\n');
    const { output: stdout } = runScript(repo);
    assert(
      readFile(path.join(repo, W, 'agents', 'session.md')).includes('#42: mid-flight'),
      'the session in progress is never clobbered',
    );
    assert(stdout.includes(`session: ${W}/agents/session.md already exists`), `reported as a skip, got: ${stdout}`);
    cleanup(repo);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
