//
// Tests for hooks/safety/capture-guard: the Read path, gated by the triage
// marker, and every other file left open.
// The shared prologue (the scratch repo and TMPDIR, the marker helpers, the hook runner) is ./helpers.js.
//

const path = require('path');
const {
  group, test, assert, assertEq, summary, WORKKIT_DIR: W, selfRun,
} = require('../../lib/harness');
const {
  REPO, CAPTURE, skipWithoutDigest, clearMarker, touchMarker, read,
} = require('./helpers');

const run = async () => {
  skipWithoutDigest();

  group('capture-guard: the Read path');

  await test('reading the capture file with no marker: exit 2, names the rule and the skill', () => {
    clearMarker();
    const { code, stderr } = read(CAPTURE);
    assertEq(code, 2, 'an unannounced read must block');
    assert(stderr.includes('capture-guard'), 'names itself');
    assert(stderr.includes('triage'), 'names the sanctioned path');
    assert(stderr.includes('capture surface'), 'states the rule');
  });

  await test('reading the capture file with a fresh marker: exit 0', () => {
    touchMarker();
    const { code, stderr } = read(CAPTURE);
    assertEq(code, 0, `a triage run reads freely, got: ${stderr}`);
  });

  await test('a marker 31 minutes old: exit 2', () => {
    touchMarker(31 * 60);
    assertEq(read(CAPTURE).code, 2, 'a stale marker is not a triage run');
  });

  await test('a relative capture path is gated too: exit 2', () => {
    clearMarker();
    assertEq(read(`${W}/capture.md`).code, 2, 'the path is matched by suffix, not by shape');
  });

  await test('any other file: exit 0', () => {
    clearMarker();
    for (const f of [
      path.join(REPO, W, 'agents', 'session.md'),
      path.join(REPO, 'capture.md'),
      path.join(REPO, 'README.md'),
    ]) {
      const { code, stderr } = read(f);
      assertEq(code, 0, `${f} must pass, got: ${stderr}`);
    }
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
