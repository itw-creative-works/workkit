// Tests for workflow/changelog/changelog-links.js, the release-time CHANGELOG backfill:
// filling each entry's commit link and handle in, and the Contributors
// section the handles define. The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const { skipWithoutNodeStub } = require('../../lib/platform');
const {
  cleanup, git, makeGhStub, CHANGELOG, mkRepo, runScript, readLog,
} = require('./helpers');

describe('changelog-links: filling entries in', { skip: skipWithoutNodeStub() }, () => {
  test('an entry gains its commit link and the author handle', () => {
    const { dir, shas } = mkRepo(
      CHANGELOG('- [#4](../../issues/4) - Plugins install from settings.json.'),
      ['refactor(setup): install plugins\n\nFixes #4'],
    );
    const stub = makeGhStub({ login: 'Octocat' });
    const { code } = runScript(dir, stub);
    expect(code, 'exit 0').toBe(0);
    const text = readLog(dir);
    expect(text.includes(`[\`${shas[0]}\`](../../commit/${shas[0]})`), `a relative commit link, got: ${text}`).toBeTruthy();
    expect(text.includes('Thanks [@Octocat]!'), `a shortcut attribution, got: ${text}`).toBeTruthy();
    expect(text.includes('[@Octocat]: https://github.com/Octocat'), `defined once at the bottom, got: ${text}`).toBeTruthy();
    expect(!text.includes('github.com/o/r'), `the repo URL appears nowhere, got: ${text}`).toBeTruthy();
    expect(text.includes('- Plugins install from settings.json.'), `prose intact, got: ${text}`).toBeTruthy();
    cleanup(dir); cleanup(stub.dir);
  });

  test('a contributor is defined once however many entries name them', () => {
    const { dir } = mkRepo(
      CHANGELOG(
        '- [#4](../../issues/4) - First.',
        '- [#5](../../issues/5) - Second.',
      ),
      ['feat: a\n\nFixes #4', 'feat: b\n\nFixes #5'],
    );
    const stub = makeGhStub({ login: 'who' });
    runScript(dir, stub);
    const text = readLog(dir);
    expect(text.match(/Thanks \[@who\]!/g).length, 'both entries thank them').toBe(2);
    expect(text.match(/^\[@who\]: /gm).length, `one definition, got: ${text}`).toBe(1);
    cleanup(dir); cleanup(stub.dir);
  });

  test('a new definition is separated from the entry above it by a blank line', () => {
    // Appended straight under a bullet, a definition is absorbed as that
    // paragraph's lazy continuation and the reference renders as literal text.
    // A stray definition elsewhere in the file must not suppress the blank line.
    const { dir } = mkRepo(
      `[@old]: https://github.com/old\n\n${CHANGELOG('- [#4](../../issues/4) - Text.')}`,
      ['feat: a\n\nFixes #4'],
    );
    const stub = makeGhStub({ login: 'fresh' });
    runScript(dir, stub);
    const lines = readLog(dir).split('\n');
    const at = lines.findIndex((l) => l.startsWith('[@fresh]:'));
    expect(at > 0, 'the definition was written').toBeTruthy();
    expect(lines[at - 1].trim(), `preceded by a blank line, got: ${JSON.stringify(lines.slice(at - 2, at + 1))}`).toBe('');
    cleanup(dir); cleanup(stub.dir);
  });

  test('a definition differing only in case is not duplicated', () => {
    // Markdown labels are case-insensitive, so `[@Who]:` already defines `who`.
    const { dir } = mkRepo(
      `${CHANGELOG('- [#4](../../issues/4) - Text.')}\n[@Who]: https://github.com/Who\n`,
      ['feat: a\n\nFixes #4'],
    );
    const stub = makeGhStub({ login: 'who' });
    runScript(dir, stub);
    expect(readLog(dir).match(/^\[@[Ww]ho\]: /gm).length, `one definition, got: ${readLog(dir)}`).toBe(1);
    cleanup(dir); cleanup(stub.dir);
  });

  test('the file ends with a Contributors section naming each person', () => {
    // Link definitions render as nothing; the section gives the
    // `Thanks [@who]!` credits a visible roll.
    const { dir } = mkRepo(
      CHANGELOG('- [#4](../../issues/4) - Text.'),
      ['feat: a\n\nFixes #4'],
    );
    const stub = makeGhStub({ login: 'who' });
    runScript(dir, stub);
    const lines = readLog(dir).trimEnd().split('\n');
    const at = lines.indexOf('## Contributors');
    expect(at > 0, `a Contributors heading, got: ${readLog(dir)}`).toBeTruthy();
    expect(lines.slice(at).includes('- [@who]'), `a visible bullet per person, got: ${lines.slice(at)}`).toBeTruthy();
    expect(lines[lines.length - 1], 'definitions close the file').toBe('[@who]: https://github.com/who');
    expect(lines[at - 2], 'the section is set off by a rule').toBe('---');
    cleanup(dir); cleanup(stub.dir);
  });

  test('a second backfill rebuilds the section byte for byte', () => {
    // The section is rebuilt on every run, so a non-idempotent rebuild would
    // stack a second heading or a second rule on each release.
    const { dir } = mkRepo(
      CHANGELOG('- [#4](../../issues/4) - Text.'),
      ['feat: a\n\nFixes #4'],
    );
    const stub = makeGhStub({ login: 'who' });
    runScript(dir, stub);
    const first = readLog(dir);
    runScript(dir, stub);
    expect(readLog(dir), 'a re-run changes nothing').toBe(first);
    expect((first.match(/^## Contributors$/gm) || []).length, 'exactly one section').toBe(1);
    cleanup(dir); cleanup(stub.dir);
  });

  test('an entry already carrying its handle is not given a second one', () => {
    // Entries are written at build time, handle and all, so a second
    // attribution would ship as "Thanks [@who]! Thanks [@who]! -".
    const { dir, shas } = mkRepo(
      CHANGELOG('- [#4](../../issues/4) Thanks [@alice]! - Text.'),
      ['feat: a\n\nFixes #4'],
    );
    const stub = makeGhStub({ login: 'alice' });
    runScript(dir, stub);
    runScript(dir, stub);
    const entry = readLog(dir).split('\n').find((l) => l.startsWith('- [#4]'));
    expect((entry.match(/Thanks \[@alice\]!/g) || []).length, `one handle, got: ${entry}`).toBe(1);
    expect(entry.includes(`[\`${shas[0]}\`](../../commit/${shas[0]})`), `the commit link still landed, got: ${entry}`).toBeTruthy();
    cleanup(dir); cleanup(stub.dir);
  });

  test('a later contributor joins the existing section', () => {
    const { dir } = mkRepo(
      CHANGELOG('- [#4](../../issues/4) - First.'),
      ['feat: a\n\nFixes #4'],
    );
    runScript(dir, makeGhStub({ login: 'first' }));

    // A second release: a new entry, a new commit, a different person.
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'),
      readLog(dir).replace('### Added\n', '### Added\n\n- [#5](../../issues/5) - Second.\n'));
    fs.appendFileSync(path.join(dir, 'work.txt'), 'more\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'feat: b\n\nFixes #5');
    const stub = makeGhStub({ login: 'second' });
    runScript(dir, stub);

    const text = readLog(dir);
    expect((text.match(/^## Contributors$/gm) || []).length, `still one section, got: ${text}`).toBe(1);
    expect(text.includes('- [@first]') && text.includes('- [@second]'), `both are listed, got: ${text}`).toBeTruthy();
    expect(text.includes('[@first]: https://github.com/first'), 'the first definition survives').toBeTruthy();
    cleanup(dir); cleanup(stub.dir);
  });

  test('an existing contributor definition is never rewritten', () => {
    const { dir } = mkRepo(
      `${CHANGELOG('- [#4](../../issues/4) - Text.')}\n[@who]: https://example.com/custom\n`,
      ['feat: a\n\nFixes #4'],
    );
    const stub = makeGhStub({ login: 'who' });
    runScript(dir, stub);
    const text = readLog(dir);
    expect(text.includes('[@who]: https://example.com/custom'), 'the hand-edited URL survives').toBeTruthy();
    expect(text.match(/^\[@who\]: /gm).length, `not duplicated, got: ${text}`).toBe(1);
    cleanup(dir); cleanup(stub.dir);
  });

  test('an issue closed by two commits lists both, thanking each person once', () => {
    const { dir, shas } = mkRepo(
      CHANGELOG('- [#7](https://github.com/o/r/issues/7) - The two-part change.'),
      ['feat: part one\n\nFixes #7', 'feat: part two\n\nFixes #7'],
    );
    const stub = makeGhStub({ login: 'who' });
    runScript(dir, stub);
    const text = readLog(dir);
    for (const sha of shas) expect(text.includes(`\`${sha}\``), `lists ${sha}, got: ${text}`).toBeTruthy();
    expect(text.match(/Thanks/g).length, 'one Thanks, not one per commit').toBe(1);
    cleanup(dir); cleanup(stub.dir);
  });

  test('a commit-link-shaped string in the prose does not suppress the fill', () => {
    // "Already linked" is anchored to the metadata run after the issue link,
    // never the whole line, or this entry would be skipped silently.
    const { dir, shas } = mkRepo(
      CHANGELOG('- [#4](../../issues/4) - Reverts [`abcdef1`](../../commit/abcdef1) from the last release.'),
      ['fix: revert\n\nFixes #4'],
    );
    const stub = makeGhStub({ login: 'who' });
    runScript(dir, stub);
    const first = readLog(dir);
    expect(first.includes(`[\`${shas[0]}\`](../../commit/${shas[0]})`), `filled, got: ${first}`).toBeTruthy();
    expect(first.includes('[`abcdef1`](../../commit/abcdef1)'), 'the prose mention survives').toBeTruthy();
    runScript(dir, stub);
    expect(readLog(dir), 'and a re-run changes nothing').toBe(first);
    cleanup(dir); cleanup(stub.dir);
  });

  test('a CRLF file keeps its line endings on write', () => {
    // The writer normalizes for parsing but must join with the file's dominant
    // ending.
    const { dir, shas } = mkRepo(
      CHANGELOG('- [#4](../../issues/4) - Text.').replace(/\n/g, '\r\n'),
      ['feat: a\n\nFixes #4'],
    );
    const stub = makeGhStub({ login: 'who' });
    runScript(dir, stub);
    const text = readLog(dir);
    expect(text.includes(`\`${shas[0]}\``), `filled, got: ${text}`).toBeTruthy();
    expect(text.includes('\r\n'), 'still CRLF').toBeTruthy();
    expect(!/[^\r]\n/.test(text), 'no lone LF was written').toBeTruthy();
    cleanup(dir); cleanup(stub.dir);
  });

  test('an entry whose issue no commit closes is left untouched', () => {
    const body = '- [#99](https://github.com/o/r/issues/99) - An entry from an older release.';
    const { dir } = mkRepo(CHANGELOG(body), ['feat: unrelated work']);
    const stub = makeGhStub();
    runScript(dir, stub);
    expect(readLog(dir).includes(body), 'unchanged').toBeTruthy();
    cleanup(dir); cleanup(stub.dir);
  });

  test('a `(no issue)` entry is left untouched', () => {
    const body = '- (no issue) - A change with nothing filed for it.';
    const { dir } = mkRepo(CHANGELOG(body), ['feat: x\n\nFixes #4']);
    const stub = makeGhStub();
    runScript(dir, stub);
    expect(readLog(dir).includes(body), 'unchanged').toBeTruthy();
    cleanup(dir); cleanup(stub.dir);
  });

  test('without gh the commit link still lands, and the missing handle is reported', () => {
    // Offline is an expected external condition, not a failure: the commit link
    // comes from git alone, so the release is never blocked on the network.
    const { dir, shas } = mkRepo(
      CHANGELOG('- [#4](https://github.com/o/r/issues/4) - Plugins install from settings.json.'),
      ['refactor: x\n\nFixes #4'],
    );
    const stub = makeGhStub({ fails: true });
    const { code, out } = runScript(dir, stub);
    expect(code, 'exit 0').toBe(0);
    const text = readLog(dir);
    expect(text.includes(`\`${shas[0]}\``), `commit link, got: ${text}`).toBeTruthy();
    expect(!text.includes('Thanks'), `no attribution, got: ${text}`).toBeTruthy();
    expect(out.includes('could not be resolved'), `reports it, got: ${out}`).toBeTruthy();
    cleanup(dir); cleanup(stub.dir);
  });

  test('`Closes #N` and `Resolves #N` count as closing trailers too', () => {
    const { dir } = mkRepo(
      CHANGELOG(
        '- [#4](https://github.com/o/r/issues/4) - First.',
        '- [#5](https://github.com/o/r/issues/5) - Second.',
      ),
      ['feat: a\n\nCloses #4', 'feat: b\n\nResolves #5'],
    );
    const stub = makeGhStub();
    runScript(dir, stub);
    const text = readLog(dir);
    expect(text.match(/commit\//g).length, `both linked, got: ${text}`).toBe(2);
    cleanup(dir); cleanup(stub.dir);
  });

  test('`Fixed #N` and `Closes: #N`, which the commit gate accepts, link their entries too', () => {
    const { dir, shas } = mkRepo(
      CHANGELOG(
        '- [#4](https://github.com/o/r/issues/4) - First.',
        '- [#5](https://github.com/o/r/issues/5) - Second.',
      ),
      ['feat: a\n\nFixed #4', 'feat: b\n\nCloses: #5'],
    );
    const stub = makeGhStub();
    runScript(dir, stub);
    const lines = readLog(dir).split('\n');
    const entry = (n) => lines.find((l) => l.startsWith(`- [#${n}]`));
    expect(entry(4).includes(`(../../commit/${shas[0]})`), `#4 linked to its Fixed commit, got: ${entry(4)}`).toBeTruthy();
    expect(entry(5).includes(`(../../commit/${shas[1]})`), `#5 linked to its Closes: commit, got: ${entry(5)}`).toBeTruthy();
    cleanup(dir); cleanup(stub.dir);
  });
});
