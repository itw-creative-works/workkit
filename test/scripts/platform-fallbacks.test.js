// Tests that workflow/workkit.sh's platform fallbacks, the copies a partial kit
// with no lib/platform.sh runs, answer as platform.sh's originals do. Each side
// loads on its own in a fresh bash: platform.sh sourced alone, or the fallback
// statements cut from workkit.sh alone; then the same call runs in both.

const fs = require('fs');
const path = require('path');
const { describe, test, expect, mkTmp, SPAWN_DEADLINE } = require('../lib/harness');
const { SYSTEM_PATH, NO_RC, shellPath, spawnBash, stubTool, systemPathWith, skipWithoutFileLink } = require('../lib/platform');

const WORKFLOW = path.join(__dirname, '..', '..', 'workflow');
const PLATFORM = shellPath(path.join(WORKFLOW, 'lib', 'platform.sh'));
const WORKKIT = path.join(WORKFLOW, 'workkit.sh');

const NAMES = ['wk_is_cloud', 'wk_npm_script_shell', 'wk_user_dir', 'wk_script_shell_exe', 'wk_physical_path'];

// The exit a probe takes when the function never got defined, so two
// "command not found" answers can never pass as a match.
const UNDEFINED = 99;

/** Whether evaluating `text` alone in a fresh bash defines the function `name`. */
const defines = (text, name) => spawnBash([...NO_RC, '-c', 'eval "$1" || exit 1; declare -F "$2" >/dev/null', 'probe', text, name], {
  env: { PATH: SYSTEM_PATH }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
}).status === 0;

/**
 * The fallback statement for `name` in workkit.sh: from its `declare -f <name>`
 * guard line, the fewest whole lines that, evaluated alone, define the function.
 * @param {string} name
 * @returns {string}
 */
const fallbackOf = (name) => {
  const lines = fs.readFileSync(WORKKIT, 'utf8').split('\n');
  const starts = lines.flatMap((line, i) => (line.startsWith(`declare -f ${name} `) ? [i] : []));
  expect(starts.length, `workkit.sh has one fallback guard for ${name}`).toBe(1);
  for (let end = starts[0] + 1; end <= lines.length; end += 1) {
    const text = lines.slice(starts[0], end).join('\n');
    if (defines(text, name)) return text;
  }
  throw new Error(`workkit.sh's ${name} guard never completes a definition`);
};

let fallbacks;
/** Every fallback statement, cut once per process. */
const fallbackLoad = () => {
  fallbacks = fallbacks || NAMES.map(fallbackOf).join('\n');
  return fallbacks;
};

/** Run `args` in a fresh bash after `load`, with only `env` set. */
const probe = (load, args, env, cwd) => {
  const script = `${load}\ndeclare -F "$1" >/dev/null || exit ${UNDEFINED}\n"$@"`;
  const res = spawnBash([...NO_RC, '-c', script, 'probe', ...args], {
    env: { PATH: SYSTEM_PATH, ...env }, cwd, encoding: 'utf8', timeout: SPAWN_DEADLINE,
  });
  expect(res.status !== null, `the shell finished (no timeout): ${res.error || ''}`).toBeTruthy();
  expect(res.status !== UNDEFINED, `${args[0]} was defined by: ${load.split('\n')[0]}`).toBeTruthy();
  return { code: res.status, out: res.stdout, err: res.stderr };
};

/** Assert the fallback and the original give the same output and exit code. */
const same = (label, args, env = {}, cwd = undefined) => {
  const original = probe(`. ${JSON.stringify(PLATFORM)}`, args, env, cwd);
  const fallback = probe(fallbackLoad(), args, env, cwd);
  expect(JSON.stringify(fallback), `${args.join(' ')}, ${label}`).toBe(JSON.stringify(original));
};

describe('workkit.sh fallbacks answer as platform.sh does', () => {
  test('wk_is_cloud: CLAUDE_CODE_REMOTE true, unset, false and empty', () => {
    same('true', ['wk_is_cloud'], { CLAUDE_CODE_REMOTE: 'true' });
    same('unset', ['wk_is_cloud']);
    same('false', ['wk_is_cloud'], { CLAUDE_CODE_REMOTE: 'false' });
    same('empty', ['wk_is_cloud'], { CLAUDE_CODE_REMOTE: '' });
  });

  test("wk_npm_script_shell: npm's CRLF value, its LF value, its failure alone and with output", () => {
    const answers = {
      crlf: ['printf "C:/h/.workkit/script-shell.exe\\r\\n"'],
      lf: ['printf "/usr/local/bin/bash\\n"'],
      failed: ['exit 3'],
      'failed with output': ['printf "half\\r\\n"', 'exit 2'],
    };
    for (const [label, body] of Object.entries(answers)) {
      const dir = mkTmp('wf-fallbacks-');
      stubTool(dir, 'npm', ['#!/bin/bash', ...body]);
      same(label, ['wk_npm_script_shell'], { PATH: systemPathWith(dir) });
    }
  });

  const homes = {
    'WORKFLOW_HOME set': { WORKFLOW_HOME: '/w/kit', HOME: '/h' },
    'HOME only': { HOME: '/h' },
    'WORKFLOW_HOME empty': { WORKFLOW_HOME: '', HOME: '/h' },
    'neither set': {},
  };

  test('wk_user_dir: WORKFLOW_HOME set, empty or unset, with and without HOME', () => {
    for (const [label, env] of Object.entries(homes)) same(label, ['wk_user_dir'], env);
  });

  test('wk_script_shell_exe: WORKFLOW_HOME set, empty or unset, with and without HOME', () => {
    for (const [label, env] of Object.entries(homes)) same(label, ['wk_script_shell_exe'], env);
  });

  test('wk_physical_path: a linked folder, a missing folder and a bare name', () => {
    const dir = mkTmp('wf-fallbacks-');
    const real = path.join(dir, 'real');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, 'shell.sh'), '');
    // A junction on Windows, a symlink elsewhere (where the type is ignored).
    fs.symlinkSync(real, path.join(dir, 'linked'), 'junction');
    same('linked folder', ['wk_physical_path', `${shellPath(dir)}/linked/shell.sh`]);
    same('missing folder', ['wk_physical_path', `${shellPath(dir)}/missing/shell.sh`]);
    same('bare name', ['wk_physical_path', 'shell.sh'], {}, real);
  });

  test('wk_physical_path: a link to a file', { skip: skipWithoutFileLink() }, () => {
    const dir = mkTmp('wf-fallbacks-');
    fs.writeFileSync(path.join(dir, 'target.sh'), '');
    fs.symlinkSync(path.join(dir, 'target.sh'), path.join(dir, 'link.sh'), 'file');
    same('link to a file', ['wk_physical_path', `${shellPath(dir)}/link.sh`]);
  });
});
