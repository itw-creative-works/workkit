// Tests for standards.sh: the local working files it seeds.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const {
  describe, test, expect, WORKKIT_DIR: W,
} = require('../../lib/harness');
const { cleanup, makeRepo, readFile, runScript } = require('./helpers');

describe('standards.sh: local working files', () => {
  test('creates .workkit/capture.md with the capture header', () => {
    const repo = makeRepo();
    runScript(repo);
    const capture = path.join(repo, W, 'capture.md');
    expect(fs.existsSync(capture), 'the capture file is created').toBeTruthy();
    const text = fs.readFileSync(capture, 'utf8');
    expect(text.includes('Triage drains every entry'), 'header explains the drain').toBeTruthy();
    cleanup(repo);
  });

  test('never overwrites a capture file that has entries', () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, W, 'capture.md'), 'my precious note\n');
    const { output: stdout } = runScript(repo);
    expect(fs.readFileSync(path.join(repo, W, 'capture.md'), 'utf8'), 'existing content untouched').toBe('my precious note\n');
    expect(stdout.includes('already exists'), 'reported as a skip').toBeTruthy();
    cleanup(repo);
  });

  test('creates .workkit/agents/session.md with its three fixed sections', () => {
    const repo = makeRepo();
    runScript(repo);
    const text = readFile(path.join(repo, W, 'agents', 'session.md'));
    expect(text.startsWith('# Session'), `titled Session, got: ${text.slice(0, 20)}`).toBeTruthy();
    for (const section of ['## Active', '## Queue', '## Notes']) {
      expect(text.includes(section), `${section} present`).toBeTruthy();
    }
    // Fixed shape: the three sections and nothing else.
    expect((text.match(/^## /gm) || []).length, 'exactly three sections').toBe(3);
    expect(/priority.*high/i.test(text) && /low/i.test(text), 'Queue states the order rule').toBeTruthy();
    expect(/promoted/i.test(text), 'Notes states the promotion rule').toBeTruthy();
    cleanup(repo);
  });

  test('never overwrites a session file that has content', () => {
    const repo = makeRepo();
    fs.mkdirSync(path.join(repo, W, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(repo, W, 'agents', 'session.md'), '# Session\n\n## Active\n#42: mid-flight\n');
    const { output: stdout } = runScript(repo);
    expect(
      readFile(path.join(repo, W, 'agents', 'session.md')).includes('#42: mid-flight'),
      'the session in progress is never clobbered',
    ).toBeTruthy();
    expect(stdout.includes(`session: ${W}/agents/session.md already exists`), `reported as a skip, got: ${stdout}`).toBeTruthy();
    cleanup(repo);
  });
});
