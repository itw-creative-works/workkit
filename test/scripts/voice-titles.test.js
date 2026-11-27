// Tests for title, section and done of workflow/lib/voice.js, the run's headings
// and its closing line: their bytes with color off, quiet, the stream WK_LOG_STDERR
// picks, and the two-space indent a heading sets for this process alone. Each
// case speaks in a node of its own, so the streams and the env are real.

const path = require('path');
const { describe, test, expect } = require('../lib/harness');
const { jsPath } = require('../lib/platform');
const { speak, VOICE } = require('../lib/speak');

const LIB = path.join(__dirname, '..', '..', 'workflow', 'lib');

describe('voice: title, section and done', () => {
  test('their bytes with color off, each level line after a heading two spaces in, the closing line at the margin', () => {
    const res = speak([
      "v.ok('before');",
      "v.title('Setup');",
      "v.ok('linked');",
      "v.warn('careful');",
      "v.section('Links');",
      "v.info('worth knowing');",
      "v.done('all current');",
    ]);
    expect(res.stdout).toBe('✓ before\nSetup\n  ✓ linked\n\nLinks\n  › worth knowing\n✨ all current\n');
    expect(res.stderr).toBe('  ⚠ careful\n');
  });

  test('under quiet the three print nothing, and the indent they set still holds', () => {
    const res = speak([
      'v.setQuiet(true);',
      "v.title('Setup');",
      "v.section('Links');",
      "v.done('all current');",
      "v.ok('linked');",
      "v.warn('careful');",
    ]);
    expect(res.stdout).toBe('  ✓ linked\n');
    expect(res.stderr).toBe('  ⚠ careful\n');
  });

  test('with WK_LOG_STDERR=1 the three print on stderr', () => {
    const res = speak(["v.title('Setup');", "v.section('Links');", "v.done('all current');"], { WK_LOG_STDERR: '1' });
    expect(res.stdout).toBe('');
    expect(res.stderr).toBe('Setup\n\nLinks\n✨ all current\n');
  });

  test('a child started after a title gets no indent; the process that set it keeps it', () => {
    const child = `require(${jsPath(VOICE)}).ok('child');`;
    const res = speak([
      "v.title('Setup');",
      `require(${jsPath(path.join(LIB, 'run.js'))}).spawnSync(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'inherit' });`,
      "v.ok('parent');",
    ]);
    expect(res.stdout).toBe('Setup\n✓ child\n  ✓ parent\n');
  });
});
