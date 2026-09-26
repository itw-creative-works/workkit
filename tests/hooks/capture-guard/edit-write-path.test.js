//
// Tests for hooks/safety/capture-guard: the Edit and Write path, the drain's
// marker-gated rewrite, and the append no marker opens because the agent never
// adds to the capture file.
// The shared prologue (the scratch repo and TMPDIR, the marker helpers, the hook runner) is ./helpers.js.
//

const path = require('path');
const {
  group, test, assert, assertEq, summary, WORKKIT_DIR: W, selfRun,
} = require('../../lib/harness');
const { shellPath } = require('../../lib/platform');
const {
  REPO, CAPTURE, skipWithoutDigest, clearMarker, touchMarker, runHook, bash,
} = require('./helpers');

const edit = (file) => runHook({ tool_name: 'Edit', tool_input: { file_path: shellPath(file) } });
const write = (file) => runHook({ tool_name: 'Write', tool_input: { file_path: shellPath(file) } });

const run = async () => {
  skipWithoutDigest();

  group('capture-guard: the Edit and Write path');

  // The drain is the one write the file takes from an agent, so Edit/Write
  // ride the same marker the reads do.
  await test('editing or writing the capture file with no marker: exit 2', () => {
    clearMarker();
    for (const call of [() => edit(CAPTURE), () => write(CAPTURE), () => edit(`${W}/capture.md`)]) {
      const { code, stderr } = call();
      assertEq(code, 2, 'an unannounced write must block');
      assert(stderr.includes('capture-guard'), 'names itself');
      assert(stderr.includes('triage'), 'names the sanctioned path');
      // The branch is the rewrite gate, so the refusal names the rewrite:
      // the append rule is a different act and a different message.
      assert(stderr.includes('BLOCKED rewriting'), 'the message matches the act');
    }
  });

  await test('editing or writing it with a fresh marker: exit 0', () => {
    touchMarker();
    for (const call of [() => edit(CAPTURE), () => write(CAPTURE)]) {
      const { code, stderr } = call();
      assertEq(code, 0, `the triage drain clears entries, got: ${stderr}`);
    }
  });

  await test('writing another file in .workkit/: exit 0', () => {
    clearMarker();
    assertEq(write(path.join(REPO, W, 'agents', 'session.md')).code, 0, 'only the capture file is gated');
  });

  group('capture-guard: the agent never adds to the capture file');

  // Owner ruling, 2026-08-05: clear it on triage, never add to it. No marker
  // opens an append: the marker means a DRAIN is running, not a capture.
  await test('an append into the capture file: exit 2 with and without a marker', () => {
    const appends = [
      `echo "- a thought" >> ${W}/capture.md`,
      `echo "- a thought" >>${W}/capture.md`,
      `printf -- '- x\\n' >> "${W}/capture.md"`,
      `echo x | tee -a ${W}/capture.md`,
      `cd ${W} && echo hi >> capture.md`,
    ];
    clearMarker();
    for (const c of appends) {
      const { code, stderr } = bash(c);
      assertEq(code, 2, `an append is never the agent's: ${c}`);
      assert(stderr.includes('never adds to it'), 'states the rule');
    }
    touchMarker();
    for (const c of appends) {
      assertEq(bash(c).code, 2, `and a triage run does not open it either: ${c}`);
    }
  });

  await test('the capture CLI run by the agent: exit 2 with and without a marker', () => {
    const captures = [
      'bash ~/.claude/workkit/wk.sh note "a thought"',
      'workkit note "a thought"',
      'wk.sh note the thought',
      'cd /tmp && wk note "a thought"',
    ];
    clearMarker();
    for (const c of captures) {
      const { code, stderr } = bash(c);
      assertEq(code, 2, `capture is the owner's: ${c}`);
      assert(stderr.includes('status:inbox'), 'points at the issue instead');
    }
    touchMarker();
    for (const c of captures) {
      assertEq(bash(c).code, 2, `and a triage run does not open it either: ${c}`);
    }
  });

  // The CLI is caught where it is RUN, not where it is mentioned: prose about
  // capture in an issue body, and a search for it, touch no capture file.
  await test('the capture CLI merely named: exit 0', () => {
    clearMarker();
    for (const c of [
      `gh issue create --body 'the owner runs wk.sh note "x" to capture'`,
      'gh issue comment 1 --body "use workkit note for capture"',
      'rg wk.sh note docs/',
    ]) {
      const { code, stderr } = bash(c);
      assertEq(code, 0, `a mention runs nothing: ${c}, got: ${stderr}`);
    }
  });

  await test('a rewrite of the capture file: marker-gated like a read', () => {
    const rewrites = [
      `echo x > ${W}/capture.md`,
      `echo x | tee ${W}/capture.md`,
      `sed -i '' 's/a/b/' ${W}/capture.md`,
      `perl -pi -e 's/a/b/' ${W}/capture.md`,
    ];
    clearMarker();
    for (const c of rewrites) {
      assertEq(bash(c).code, 2, `a rewrite outside a triage run blocks: ${c}`);
    }
    touchMarker();
    for (const c of rewrites) {
      const { code, stderr } = bash(c);
      assertEq(code, 0, `the drain rewrites freely: ${c}, got: ${stderr}`);
    }
  });

  await test('a command redirecting elsewhere while naming the capture file: exit 0', () => {
    clearMarker();
    for (const c of [
      `echo "${W}/capture.md" > /dev/null`,
      `echo "the captures live at ${W}/capture.md" >> notes.txt`,
      `ls -la ${W}/capture.md`,
    ]) {
      const { code, stderr } = bash(c);
      assertEq(code, 0, `only a write TO the capture file is gated: ${c}, got: ${stderr}`);
    }
  });

  // tee, sed -i and perl -i are judged by their OWN argument: a pipeline whose
  // writer points at another file writes to that file, whatever the command
  // line mentions elsewhere.
  await test('a writer keyword pointed at another file: exit 0', () => {
    clearMarker();
    for (const c of [
      `wc -l ${W}/capture.md | tee -a /tmp/log`,
      `wc -l ${W}/capture.md | tee /tmp/log`,
      `ls ${W}/capture.md; echo hi | tee -a other.log`,
      `ls ${W}/capture.md; sed -i '' s/a/b/ other.txt`,
      `git log --oneline -- ${W}/capture.md | tee changes.log`,
    ]) {
      const { code, stderr } = bash(c);
      assertEq(code, 0, `the keyword's own target decides: ${c}, got: ${stderr}`);
    }
  });

  await test('the same keywords pointed AT the capture file: still gated', () => {
    clearMarker();
    assertEq(bash(`tee -a ${W}/capture.md`).code, 2, 'an append is never the agent\'s');
    assertEq(bash(`sed -i '' s/a/b/ ${W}/capture.md`).code, 2, 'a rewrite needs the marker');
    touchMarker();
    assertEq(bash(`tee -a ${W}/capture.md`).code, 2, 'and no marker opens the append');
    assertEq(bash(`sed -i '' s/a/b/ ${W}/capture.md`).code, 0, 'while the drain rewrites freely');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
