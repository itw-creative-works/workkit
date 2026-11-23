// Tests for workflow/lib/write.js: writeWhole's mode for the new file, and editJson,
// a JSON file changed whole through a temp file beside its target, on real files in
// a scratch folder. writeWhole's failed-write cleanup is the records and login
// suites' own cases, through their writers.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp,
} = require('../lib/harness');
const { skipWithoutModes, skipWithoutFileLink } = require('../lib/platform');

const WRITE = path.join(__dirname, '..', '..', 'workflow', 'lib', 'write.js');

const addB = (value) => ({ ...value, b: [2] });
const EDITED = '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}\n';

describe('lib/write: writeWhole', () => {
  test('a mode given: the file lands at it, even over a temp file a killed write left at a wider mode', { skip: skipWithoutModes('a file mode cannot be read back') }, () => {
    const { writeWhole } = require(WRITE);
    const dir = mkTmp('wk-write-mode-');
    const file = path.join(dir, 'login.json');
    const stale = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(stale, 'stale\n');
    fs.chmodSync(stale, 0o644);
    writeWhole(file, '{}\n', { mode: 0o600 });
    expect((fs.statSync(file).mode & 0o777).toString(8), 'owner read and write only').toBe('600');
  });

  test('a mode given: the file lands at exactly it under a umask that would narrow it', { skip: skipWithoutModes('a file mode cannot be read back') }, () => {
    const { writeWhole } = require(WRITE);
    const dir = mkTmp('wk-write-umask-');
    const file = path.join(dir, 'checks.yml');
    const saved = process.umask(0o077);
    try {
      writeWhole(file, 'name: checks\n', { mode: 0o644 });
    } finally {
      process.umask(saved);
    }
    expect((fs.statSync(file).mode & 0o777).toString(8), 'everyone reads it, as the mode says, though the umask took the group and others away').toBe('644');
  });
});

describe('lib/write: editJson', () => {
  test('the file is written as two-space JSON with one newline at the end, its mode kept', { skip: skipWithoutModes('a file mode cannot be read back') }, () => {
    const { editJson } = require(WRITE);
    const dir = mkTmp('wk-edit-json-');
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '{"a":1}');
    fs.chmodSync(file, 0o640);
    expect(editJson(file, addB), 'the edit reports it wrote').toBe(true);
    expect(fs.readFileSync(file, 'utf8'), 'the changed value, whole').toBe(EDITED);
    expect((fs.statSync(file).mode & 0o777).toString(8), 'the mode it had').toBe('640');
    expect(fs.readdirSync(dir), 'no temp file left beside it').toEqual(['settings.json']);
  });

  test('a linked file is written through its link to the target, and the link stays a link', { skip: skipWithoutFileLink() }, () => {
    const { editJson } = require(WRITE);
    const dir = mkTmp('wk-edit-json-');
    const real = path.join(dir, 'real');
    fs.mkdirSync(real);
    const target = path.join(real, 'settings.json');
    fs.writeFileSync(target, '{ "a": 1 }\n');
    const link = path.join(dir, 'settings.json');
    fs.symlinkSync(target, link, 'file');
    expect(editJson(link, addB), 'the edit reports it wrote').toBe(true);
    expect(fs.lstatSync(link).isSymbolicLink(), 'the address is still a link').toBe(true);
    expect(fs.readlinkSync(link), 'to the same target').toBe(target);
    expect(fs.readFileSync(target, 'utf8'), 'the target holds the change').toBe(EDITED);
    expect([fs.readdirSync(dir).sort(), fs.readdirSync(real)], 'no temp file in either folder').toEqual([['real', 'settings.json'], ['settings.json']]);
  });

  test('a write that fails leaves the file as it was, no temp file, and answers false', { skip: skipWithoutModes('a read-only folder does not stop the write') }, () => {
    const { editJson } = require(WRITE);
    const dir = mkTmp('wk-edit-json-');
    const file = path.join(dir, 'settings.json');
    const before = '{"a":1}';
    fs.writeFileSync(file, before);
    fs.chmodSync(dir, 0o555);
    try {
      expect(editJson(file, addB), 'the edit reports it did not write').toBe(false);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
    expect(fs.readFileSync(file, 'utf8'), 'the file as it was').toBe(before);
    expect(fs.readdirSync(dir), 'no temp file left beside it').toEqual(['settings.json']);
  });

  test('create: a missing file is made, holding what the change returned from {}', () => {
    const { editJson } = require(WRITE);
    const dir = mkTmp('wk-edit-json-');
    const file = path.join(dir, '.repos.json');
    expect(editJson(file, (value) => ({ ...value, repos: { '/w/a': 'enabled' } }), { create: true }), 'the edit reports it wrote').toBe(true);
    expect(fs.readFileSync(file, 'utf8'), 'the change applied to {}').toBe('{\n  "repos": {\n    "/w/a": "enabled"\n  }\n}\n');
  });

  test('create: an edit of a missing file that fails leaves no file behind', () => {
    const { editJson } = require(WRITE);
    const dir = mkTmp('wk-edit-json-');
    const file = path.join(dir, '.repos.json');
    const refuse = () => { throw new Error('the change refused'); };
    expect(editJson(file, refuse, { create: true }), 'the edit reports it did not write').toBe(false);
    expect(fs.readdirSync(dir), 'the {} it began from is taken away again, and no temp file is left').toEqual([]);
  });
});
