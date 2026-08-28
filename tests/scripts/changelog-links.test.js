//
// Tests for workflow/changelog-links.js — the release-time step that fills a
// CHANGELOG entry's commit link and contributor handle in from git and the
// GitHub API, so nobody types a sha.
//
// Each test builds a real git repository with real commits carrying real
// `Fixes #N` trailers; only `gh` is stubbed on PATH, because it is the one
// dependency that would reach the network.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync, execFileSync } = require('child_process');
const { group, test, assert, assertEq, summary } = require('../lib/harness');
const { recordArgv } = require('../lib/argv-log');

const SCRIPT = path.join(__dirname, '..', '..', 'workflow', 'changelog-links.js');
const { repoSlug } = require(SCRIPT);

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cll-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A fake `gh` that answers the commit-author query, or fails outright. */
const makeGhStub = ({ login = 'who', fails = false } = {}) => {
  const dir = mkTmp();
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/usr/bin/env bash',
    recordArgv(path.join(dir, 'gh.log')),
    ...(fails ? ['exit 1'] : [`printf '%s\\n' "${login}"`, 'exit 0']),
  ].join('\n'), { mode: 0o755 });
  return { binDir: bin, dir };
};

const CHANGELOG = (...bullets) => [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '### Added',
  '',
  ...bullets.flatMap((b) => [b, '']),
].join('\n');

/** A repo whose CHANGELOG is the given text, plus commits closing the issues. */
const mkRepo = (changelog, commits) => {
  const dir = mkTmp();
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'remote', 'add', 'origin', 'https://github.com/o/r.git');
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelog);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'initial');
  const shas = [];
  for (const message of commits) {
    fs.appendFileSync(path.join(dir, 'work.txt'), `${message}\n`);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', message);
    shas.push(git(dir, 'rev-parse', '--short', 'HEAD'));
  }
  return { dir, shas };
};

const runScript = (cwd, stub, args = []) => {
  const res = spawnSync('node', [SCRIPT, ...args], {
    cwd,
    env: { ...process.env, PATH: stub ? `${stub.binDir}:${process.env.PATH}` : '/usr/bin:/bin' },
    encoding: 'utf8',
    timeout: 20000,
  });
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') };
};

const readLog = (dir) => fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');

const run = async () => {
  group('changelog-links: reading the remote');

  await test('parses both GitHub remote URL forms, and rejects others', () => {
    const dir = mkTmp();
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'remote', 'add', 'origin', 'git@github.com:alice/.dotfiles.git');
    assertEq(repoSlug(dir), 'alice/.dotfiles', 'ssh form');
    git(dir, 'remote', 'set-url', 'origin', 'https://github.com/alice/.dotfiles.git');
    assertEq(repoSlug(dir), 'alice/.dotfiles', 'https form');
    git(dir, 'remote', 'set-url', 'origin', 'https://gitlab.com/alice/x.git');
    assertEq(repoSlug(dir), null, 'a non-GitHub remote has nothing to link to');
    git(dir, 'remote', 'set-url', 'origin', 'https://github.com/alice/.dotfiles/');
    assertEq(repoSlug(dir), 'alice/.dotfiles', 'a trailing slash is tolerated');
    git(dir, 'remote', 'remove', 'origin');
    assertEq(repoSlug(dir), null, 'no origin remote resolves to no slug');
    cleanup(dir);
  });

  group('changelog-links: filling entries in');

  await test('an entry gains its commit link and the author handle', () => {
    const { dir, shas } = mkRepo(
      CHANGELOG('- [#4](../../issues/4) — Plugins install from settings.json.'),
      ['refactor(setup): install plugins\n\nFixes #4'],
    );
    const stub = makeGhStub({ login: 'Octocat' });
    const { code } = runScript(dir, stub);
    assertEq(code, 0, 'exit 0');
    const text = readLog(dir);
    assert(text.includes(`[\`${shas[0]}\`](../../commit/${shas[0]})`), `a relative commit link, got: ${text}`);
    assert(text.includes('Thanks [@Octocat]!'), `a shortcut attribution, got: ${text}`);
    assert(text.includes('[@Octocat]: https://github.com/Octocat'), `defined once at the bottom, got: ${text}`);
    assert(!text.includes('github.com/o/r'), `the repo URL appears nowhere, got: ${text}`);
    assert(text.includes('— Plugins install from settings.json.'), `prose intact, got: ${text}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a contributor is defined once however many entries name them', () => {
    const { dir } = mkRepo(
      CHANGELOG(
        '- [#4](../../issues/4) — First.',
        '- [#5](../../issues/5) — Second.',
      ),
      ['feat: a\n\nFixes #4', 'feat: b\n\nFixes #5'],
    );
    const stub = makeGhStub({ login: 'who' });
    runScript(dir, stub);
    const text = readLog(dir);
    assertEq(text.match(/Thanks \[@who\]!/g).length, 2, 'both entries thank them');
    assertEq(text.match(/^\[@who\]: /gm).length, 1, `one definition, got: ${text}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a new definition is separated from the entry above it by a blank line', () => {
    // Appended straight under a bullet, a definition is absorbed as that
    // paragraph's lazy continuation and the reference renders as literal text.
    // A stray definition elsewhere in the file must not suppress the blank line.
    const { dir } = mkRepo(
      `[@old]: https://github.com/old\n\n${CHANGELOG('- [#4](../../issues/4) — Text.')}`,
      ['feat: a\n\nFixes #4'],
    );
    const stub = makeGhStub({ login: 'fresh' });
    runScript(dir, stub);
    const lines = readLog(dir).split('\n');
    const at = lines.findIndex((l) => l.startsWith('[@fresh]:'));
    assert(at > 0, 'the definition was written');
    assertEq(lines[at - 1].trim(), '', `preceded by a blank line, got: ${JSON.stringify(lines.slice(at - 2, at + 1))}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a definition differing only in case is not duplicated', () => {
    // Markdown labels are case-insensitive, so `[@Who]:` already defines `who`.
    const { dir } = mkRepo(
      `${CHANGELOG('- [#4](../../issues/4) — Text.')}\n[@Who]: https://github.com/Who\n`,
      ['feat: a\n\nFixes #4'],
    );
    const stub = makeGhStub({ login: 'who' });
    runScript(dir, stub);
    assertEq(readLog(dir).match(/^\[@[Ww]ho\]: /gm).length, 1, `one definition, got: ${readLog(dir)}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('the file ends with a Contributors section naming each person', () => {
    // Link definitions render as nothing, so a bare one at the bottom left the
    // file ending on what looked like a stray line. The section gives the
    // `Thanks [@who]!` credits a visible roll.
    const { dir } = mkRepo(
      CHANGELOG('- [#4](../../issues/4) — Text.'),
      ['feat: a\n\nFixes #4'],
    );
    const stub = makeGhStub({ login: 'who' });
    runScript(dir, stub);
    const lines = readLog(dir).trimEnd().split('\n');
    const at = lines.indexOf('## Contributors');
    assert(at > 0, `a Contributors heading, got: ${readLog(dir)}`);
    assert(lines.slice(at).includes('- [@who]'), `a visible bullet per person, got: ${lines.slice(at)}`);
    assertEq(lines[lines.length - 1], '[@who]: https://github.com/who', 'definitions close the file');
    assertEq(lines[at - 2], '---', 'the section is set off by a rule');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a second backfill rebuilds the section byte for byte', () => {
    // The section is rebuilt on every run, so a non-idempotent rebuild would
    // stack a second heading or a second rule on each release.
    const { dir } = mkRepo(
      CHANGELOG('- [#4](../../issues/4) — Text.'),
      ['feat: a\n\nFixes #4'],
    );
    const stub = makeGhStub({ login: 'who' });
    runScript(dir, stub);
    const first = readLog(dir);
    runScript(dir, stub);
    assertEq(readLog(dir), first, 'a re-run changes nothing');
    assertEq((first.match(/^## Contributors$/gm) || []).length, 1, 'exactly one section');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a bare entry ends with exactly one handle, however often the backfill runs', () => {
    const { dir } = mkRepo(
      CHANGELOG('- [#4](../../issues/4) — Text.'),
      ['feat: a\n\nFixes #4'],
    );
    const stub = makeGhStub({ login: 'alice' });
    runScript(dir, stub);
    runScript(dir, stub);
    const entry = readLog(dir).split('\n').find((l) => l.startsWith('- [#4]'));
    assertEq((entry.match(/Thanks \[@alice\]!/g) || []).length, 1, `one handle, got: ${entry}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('an entry already carrying its handle is not given a second one', () => {
    // Entries are written at build time, handle and all — the normal park flow.
    // The backfill used to append its own attribution regardless, and every
    // such entry shipped "Thanks [@who]! Thanks [@who]! —" (issue #199).
    const { dir, shas } = mkRepo(
      CHANGELOG('- [#4](../../issues/4) Thanks [@alice]! — Text.'),
      ['feat: a\n\nFixes #4'],
    );
    const stub = makeGhStub({ login: 'alice' });
    runScript(dir, stub);
    runScript(dir, stub);
    const entry = readLog(dir).split('\n').find((l) => l.startsWith('- [#4]'));
    assertEq((entry.match(/Thanks \[@alice\]!/g) || []).length, 1, `one handle, got: ${entry}`);
    assert(entry.includes(`[\`${shas[0]}\`](../../commit/${shas[0]})`), `the commit link still landed, got: ${entry}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a later contributor joins the existing section', () => {
    const { dir } = mkRepo(
      CHANGELOG('- [#4](../../issues/4) — First.'),
      ['feat: a\n\nFixes #4'],
    );
    runScript(dir, makeGhStub({ login: 'first' }));

    // A second release: a new entry, a new commit, a different person.
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'),
      readLog(dir).replace('### Added\n', '### Added\n\n- [#5](../../issues/5) — Second.\n'));
    fs.appendFileSync(path.join(dir, 'work.txt'), 'more\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'feat: b\n\nFixes #5');
    const stub = makeGhStub({ login: 'second' });
    runScript(dir, stub);

    const text = readLog(dir);
    assertEq((text.match(/^## Contributors$/gm) || []).length, 1, `still one section, got: ${text}`);
    assert(text.includes('- [@first]') && text.includes('- [@second]'), `both are listed, got: ${text}`);
    assert(text.includes('[@first]: https://github.com/first'), 'the first definition survives');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('an existing contributor definition is never rewritten', () => {
    const { dir } = mkRepo(
      `${CHANGELOG('- [#4](../../issues/4) — Text.')}\n[@who]: https://example.com/custom\n`,
      ['feat: a\n\nFixes #4'],
    );
    const stub = makeGhStub({ login: 'who' });
    runScript(dir, stub);
    const text = readLog(dir);
    assert(text.includes('[@who]: https://example.com/custom'), 'the hand-edited URL survives');
    assertEq(text.match(/^\[@who\]: /gm).length, 1, `not duplicated, got: ${text}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('an issue closed by two commits lists both, thanking each person once', () => {
    const { dir, shas } = mkRepo(
      CHANGELOG('- [#7](https://github.com/o/r/issues/7) — The two-part change.'),
      ['feat: part one\n\nFixes #7', 'feat: part two\n\nFixes #7'],
    );
    const stub = makeGhStub({ login: 'who' });
    runScript(dir, stub);
    const text = readLog(dir);
    for (const sha of shas) assert(text.includes(`\`${sha}\``), `lists ${sha}, got: ${text}`);
    assertEq(text.match(/Thanks/g).length, 1, 'one Thanks, not one per commit');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a commit-link-shaped string in the prose does not suppress the fill', () => {
    // "Already linked" is anchored to the metadata run after the issue link;
    // testing the whole line skipped this entry silently — never filled, never
    // reported as unmatched.
    const { dir, shas } = mkRepo(
      CHANGELOG('- [#4](../../issues/4) — Reverts [`abcdef1`](../../commit/abcdef1) from the last release.'),
      ['fix: revert\n\nFixes #4'],
    );
    const stub = makeGhStub({ login: 'who' });
    runScript(dir, stub);
    const first = readLog(dir);
    assert(first.includes(`[\`${shas[0]}\`](../../commit/${shas[0]})`), `filled, got: ${first}`);
    assert(first.includes('[`abcdef1`](../../commit/abcdef1)'), 'the prose mention survives');
    runScript(dir, stub);
    assertEq(readLog(dir), first, 'and a re-run changes nothing');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a CRLF file keeps its line endings on write', () => {
    // The writer normalizes for parsing but must join with the file's dominant
    // ending — it used to hand every CRLF file back as LF.
    const { dir, shas } = mkRepo(
      CHANGELOG('- [#4](../../issues/4) — Text.').replace(/\n/g, '\r\n'),
      ['feat: a\n\nFixes #4'],
    );
    const stub = makeGhStub({ login: 'who' });
    runScript(dir, stub);
    const text = readLog(dir);
    assert(text.includes(`\`${shas[0]}\``), `filled, got: ${text}`);
    assert(text.includes('\r\n'), 'still CRLF');
    assert(!/[^\r]\n/.test(text), 'no lone LF was written');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('re-running changes nothing — an entry with links is left alone', () => {
    const { dir } = mkRepo(
      CHANGELOG('- [#4](https://github.com/o/r/issues/4) — Plugins install from settings.json.'),
      ['refactor: x\n\nFixes #4'],
    );
    const stub = makeGhStub();
    runScript(dir, stub);
    const first = readLog(dir);
    const second = runScript(dir, stub);
    assertEq(readLog(dir), first, 'byte-identical on the second run');
    assert(second.out.includes('nothing to fill in'), `says so, got: ${second.out}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('an entry whose issue no commit closes is left untouched', () => {
    const body = '- [#99](https://github.com/o/r/issues/99) — An entry from an older release.';
    const { dir } = mkRepo(CHANGELOG(body), ['feat: unrelated work']);
    const stub = makeGhStub();
    runScript(dir, stub);
    assert(readLog(dir).includes(body), 'unchanged');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a `(no issue)` entry is left untouched', () => {
    const body = '- (no issue) — A change with nothing filed for it.';
    const { dir } = mkRepo(CHANGELOG(body), ['feat: x\n\nFixes #4']);
    const stub = makeGhStub();
    runScript(dir, stub);
    assert(readLog(dir).includes(body), 'unchanged');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('without gh the commit link still lands, and the missing handle is reported', () => {
    // Offline is an expected external condition, not a failure: the commit link
    // comes from git alone, so the release is never blocked on the network.
    const { dir, shas } = mkRepo(
      CHANGELOG('- [#4](https://github.com/o/r/issues/4) — Plugins install from settings.json.'),
      ['refactor: x\n\nFixes #4'],
    );
    const stub = makeGhStub({ fails: true });
    const { code, out } = runScript(dir, stub);
    assertEq(code, 0, 'exit 0');
    const text = readLog(dir);
    assert(text.includes(`\`${shas[0]}\``), `commit link, got: ${text}`);
    assert(!text.includes('Thanks'), `no attribution, got: ${text}`);
    assert(out.includes('could not be resolved'), `reports it, got: ${out}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('`Closes #N` and `Resolves #N` count as closing trailers too', () => {
    const { dir } = mkRepo(
      CHANGELOG(
        '- [#4](https://github.com/o/r/issues/4) — First.',
        '- [#5](https://github.com/o/r/issues/5) — Second.',
      ),
      ['feat: a\n\nCloses #4', 'feat: b\n\nResolves #5'],
    );
    const stub = makeGhStub();
    runScript(dir, stub);
    const text = readLog(dir);
    assertEq(text.match(/commit\//g).length, 2, `both linked, got: ${text}`);
    cleanup(dir); cleanup(stub.dir);
  });

  group('changelog-links: what it must never rewrite');

  // Both cases wrote real commit links into the file on the first cut. The
  // damage is permanent, so each one is pinned.

  await test('an example bullet inside a fenced block is left alone', () => {
    const fenced = '- [#4](https://github.com/o/r/issues/4) — What changed.';
    const { dir } = mkRepo([
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '### Added',
      '',
      '```markdown',
      fenced,
      '```',
      '',
    ].join('\n'), ['feat: x\n\nFixes #4']);
    const stub = makeGhStub();
    runScript(dir, stub);
    assert(readLog(dir).includes(fenced), 'the documented example is not an entry');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a Contributors heading inside a fenced example does not truncate the file', () => {
    // The rebuild cuts the file at the Contributors heading and re-emits the
    // tail. Taking the FIRST match discarded everything below a heading that
    // merely appeared in a fenced example — every released section, gone, on a
    // write. The heading is only this section's when the whole remainder has
    // this section's shape.
    const { dir } = mkRepo([
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '### Added',
      '',
      '- [#4](../../issues/4) — Text.',
      '',
      '## Format',
      '',
      'The file ends with a contributors block:',
      '',
      '```markdown',
      '## Contributors',
      '',
      '- [@someone]',
      '```',
      '',
      '## [1.0.0] - 2020-01-01',
      '- (no issue) — The first release.',
      '',
    ].join('\n'), ['feat: x\n\nFixes #4']);
    const stub = makeGhStub({ login: 'who' });
    runScript(dir, stub);
    const text = readLog(dir);
    assert(text.includes('## [1.0.0] - 2020-01-01'), `the released section survives, got: ${text}`);
    assert(text.includes('- (no issue) — The first release.'), 'its entry survives');
    assertEq((text.match(/```/g) || []).length, 2, 'the fence is still closed');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a trailing rule that is not part of the section is kept', () => {
    // `---` above the heading belongs to the rebuilt section. A CHANGELOG whose
    // last content line is its own rule must not lose it on the first backfill.
    const { dir } = mkRepo([
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '### Added',
      '',
      '- [#4](../../issues/4) — Text.',
      '',
      '---',
      '',
    ].join('\n'), ['feat: x\n\nFixes #4']);
    const stub = makeGhStub({ login: 'who' });
    runScript(dir, stub);
    const text = readLog(dir);
    assertEq((text.match(/^---$/gm) || []).length, 2, `the original rule plus the section's, got: ${text}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('an entry in an already-released section is left alone', () => {
    // An old release whose issue number recurs in this range must not be
    // stamped with this release's sha.
    const old = '- [#4](https://github.com/o/r/issues/4) — The 2020 entry.';
    const { dir } = mkRepo([
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '### Added',
      '',
      '## [1.0.0] - 2020-01-01',
      '',
      '### Added',
      '',
      old,
      '',
    ].join('\n'), ['feat: x\n\nFixes #4']);
    const stub = makeGhStub();
    runScript(dir, stub);
    assert(readLog(dir).includes(old), 'history is not rewritten');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('an entry whose issue has no closing commit is named, not passed in silence', () => {
    const { dir } = mkRepo(
      CHANGELOG('- [#99](https://github.com/o/r/issues/99) — Nothing closes this one.'),
      ['feat: unrelated work with no trailer'],
    );
    const stub = makeGhStub();
    const { out } = runScript(dir, stub);
    assert(out.includes('#99 has no closing commit'), `reports it, got: ${out}`);
    assert(out.includes('Fixes #99'), `says how to fix it, got: ${out}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a flag with no value is a usage error, not a stack trace', () => {
    const { dir } = mkRepo(CHANGELOG('- [#4](x) — Text.'), ['feat: x\n\nFixes #4']);
    const stub = makeGhStub();
    for (const flag of ['--file', '--range']) {
      const { code, out } = runScript(dir, stub, [flag]);
      assertEq(code, 2, `${flag} exits 2`);
      assert(out.includes(`${flag} needs a value`), `names the flag, got: ${out}`);
      assert(!out.includes('TypeError'), `no stack trace, got: ${out}`);
    }
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a range git cannot read fails with a readable message', () => {
    const { dir } = mkRepo(CHANGELOG('- [#4](x) — Text.'), ['feat: x\n\nFixes #4']);
    const stub = makeGhStub();
    const { code, out } = runScript(dir, stub, ['--range', 'v9.9.9..HEAD']);
    assertEq(code, 1, 'exit 1');
    assert(out.includes('cannot read the range'), `says so, got: ${out}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('--dry-run reports the count and writes nothing', () => {
    const { dir } = mkRepo(
      CHANGELOG('- [#4](https://github.com/o/r/issues/4) — Plugins install from settings.json.'),
      ['refactor: x\n\nFixes #4'],
    );
    const before = readLog(dir);
    const stub = makeGhStub();
    const { out } = runScript(dir, stub, ['--dry-run']);
    assert(out.includes('would fill 1'), `reports the count, got: ${out}`);
    assertEq(readLog(dir), before, 'file untouched');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('--range limits which commits are considered', () => {
    const { dir } = mkRepo(
      CHANGELOG('- [#4](https://github.com/o/r/issues/4) — Plugins install from settings.json.'),
      ['refactor: x\n\nFixes #4', 'chore: later work'],
    );
    const stub = makeGhStub();
    const { out } = runScript(dir, stub, ['--range', 'HEAD~1..HEAD', '--dry-run']);
    assert(out.includes('nothing to fill in'), `the closing commit is outside the range, got: ${out}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a repo with no GitHub remote exits non-zero instead of writing a broken link', () => {
    const { dir } = mkRepo(CHANGELOG('- [#4](x) — Text.'), ['feat: x\n\nFixes #4']);
    git(dir, 'remote', 'set-url', 'origin', 'https://gitlab.com/o/r.git');
    const stub = makeGhStub();
    const { code, out } = runScript(dir, stub);
    assertEq(code, 1, 'exit 1');
    assert(out.includes('not a GitHub remote'), `says why, got: ${out}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a repo with no origin remote gets its own message', () => {
    // Distinct from "not a GitHub remote" — the fix here is adding a remote,
    // not changing one.
    const { dir } = mkRepo(CHANGELOG('- [#4](x) — Text.'), ['feat: x\n\nFixes #4']);
    git(dir, 'remote', 'remove', 'origin');
    const stub = makeGhStub();
    const { code, out } = runScript(dir, stub);
    assertEq(code, 1, 'exit 1');
    assert(out.includes('no origin remote'), `says so, got: ${out}`);
    assert(!out.includes('not a GitHub remote'), `not the wrong message, got: ${out}`);
    cleanup(dir); cleanup(stub.dir);
  });

  return summary();
};

module.exports = run;
