/* eslint-disable no-console */
// The kit's workflows: each parses, holds no plain value with a colon and no `run:` line
// but a program start; checks.yml's triggers and jobs; ci.yml's Scope step gates the rest
// and is checks.yml's but name and path; the hook lists around the install; the 60 minute
// limits; every kit script runs on the kit's own Node ("$WORKKIT_NODE"), the repo on its own.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('../lib/platform');
const {
  describe, test, expect, run, SPAWN_DEADLINE,
} = require('../lib/harness');
const {
  indentOf, isContent, block, inlineValue, listValue, listItems, unquote, plainColonLines, runLines,
} = require('../lib/workflow-yaml');

const ROOT = path.join(__dirname, '..', '..');
const KIT_WORKFLOWS = path.join(ROOT, '.github', 'workflows');
const WORKFLOW = path.join(KIT_WORKFLOWS, 'checks.yml');
const CI = path.join(KIT_WORKFLOWS, 'ci.yml');
// The kit's own workflows and the workflow templates it installs into a repo.
const WORKFLOW_DIRS = [KIT_WORKFLOWS, path.join(ROOT, 'workflow', 'templates', 'github-workflows')];
// Every workflow and template, as `{ rel, file }`, `rel` from the kit's root with `/`.
const workflowFiles = () => WORKFLOW_DIRS.flatMap((dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.yml'))
  .map((f) => ({ rel: path.relative(ROOT, path.join(dir, f)).split(path.sep).join('/'), file: path.join(dir, f) })));

// Ruby's YAML is the real parser the kit reads with, so no dependency ships for it.
const HAS_RUBY = spawnSync('ruby', ['-ryaml', '-e', ''], { timeout: SPAWN_DEADLINE }).status === 0;
// Parses each file named for syntax alone, so an anchor or a date value passes,
// printing `<file>: <message>` for one YAML refuses.
const RUBY_PARSE = 'ARGV.each { |f| begin; YAML.parse_file(f); rescue => e; puts "#{f}: #{e.message.delete_prefix("(#{f}): ")}"; end }';

// The children of a block, at the indent of its first content line.
const childIndent = (keyBlock) => {
  const first = keyBlock.slice(1).find(isContent);
  return first ? indentOf(first) : -1;
};

// `needs:` as a list, whether written as one name or as a list.
const needsOf = (keyBlock) => {
  const one = inlineValue(keyBlock);
  return one && !one.startsWith('[') ? [one] : listValue(keyBlock);
};

// A reader of `jobs.<name>.<key>` blocks in `file`, each asserted present.
const jobKey = (file = WORKFLOW) => {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const jobs = block(lines, 'jobs', 0);
  expect(jobs, `${path.basename(file)} has a top-level \`jobs:\``).toBeTruthy();
  const at = childIndent(jobs);
  return (name, k) => {
    const job = block(jobs, name, at);
    expect(job, `jobs.${name} exists`).toBeTruthy();
    const found = block(job, k, childIndent(job));
    expect(found, `jobs.${name} carries \`${k}\``).toBeTruthy();
    return found;
  };
};

// The value of `k` at `indent` in `lines`, null when absent; a `|` or `>` body as its trimmed lines.
const valueOf = (lines, k, indent) => {
  const found = block(lines, k, indent);
  if (!found) return null;
  const inline = inlineValue(found);
  return /^[|>]/.test(inline) ? found.slice(1).filter(isContent).map((l) => l.trim()).join('\n') : unquote(inline);
};

// A job's steps parsed from its `steps:` block, each `{ name, id, if, run, uses, nodeVersion }`.
const parseSteps = (stepsBlock) => listItems(stepsBlock).map((item) => {
  const at = indentOf(item[0]);
  const withs = block(item, 'with', at);
  const step = Object.fromEntries(['name', 'id', 'if', 'run', 'uses'].map((k) => [k, valueOf(item, k, at)]));
  return { ...step, nodeVersion: withs ? valueOf(withs, 'node-version', childIndent(withs)) : null };
});

// ci.yml's `jobs.test.steps`, parsed.
const ciSteps = () => parseSteps(jobKey(CI)('test', 'steps'));

// Every job of `file` that has steps, as `{ job, steps }`.
const stepJobs = (file) => {
  const jobs = block(fs.readFileSync(file, 'utf8').split(/\r?\n/), 'jobs', 0);
  const at = childIndent(jobs);
  return jobs.slice(1).filter((l) => isContent(l) && indentOf(l) === at).map((l) => l.trim().replace(/:.*$/, ''))
    .map((job) => {
      const jobBlock = block(jobs, job, at);
      return { job, stepsBlock: block(jobBlock, 'steps', childIndent(jobBlock)) };
    })
    .filter((j) => j.stepsBlock).map(({ job, stepsBlock }) => ({ job, steps: parseSteps(stepsBlock) }));
};

// Each kit script a step's run starts, as `{ script, starter, arg }`: its file name
// under .github/scripts/, the word before it and the word after it (null when none).
const kitCalls = (step) => (step.run || '').split('\n').flatMap((line) => {
  const words = line.trim().split(/\s+/).map(unquote);
  return words.flatMap((word, at) => {
    const m = word.match(/(?:^|\/)\.github\/scripts\/([^/]+)$/);
    return m ? [{ script: m[1], starter: words[at - 1] || null, arg: words[at + 1] || null }] : [];
  });
});

const isSetupNode = (step) => (step.uses || '').startsWith('actions/setup-node@');
// The kit's own Node: setup-node at lts/*.
const isKitNode = (step) => isSetupNode(step) && step.nodeVersion === 'lts/*';
// The step that writes WORKKIT_NODE for the later steps: `ci-env.js node`.
const setsKitNode = (step) => kitCalls(step).some((c) => c.script === 'ci-env.js' && c.arg === 'node');
// A kit script started on the kit's Node by the variable ci-env.js wrote.
const onKitNode = (call) => call.starter === '$WORKKIT_NODE';

// The word a step's run line passes .github/scripts/ci-hooks.js, or null when it runs no such script.
const hooksEvent = (step) => (kitCalls(step).find((c) => c.script === 'ci-hooks.js') || { arg: null }).arg;

// Shell words that make a line logic rather than a program start.
const SHELL_WORDS = new Set(['if', 'then', 'elif', 'else', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac',
  'select', 'function', '{', '}', '(', ')', '!', '[[']);

// What makes one shell line more than one program start, each named: a shell word
// first, and outside quotes a `$(`, a backtick, a pipe, `&&`, `>>` or `;` (`$(` and
// the backtick inside double quotes too). A `${{ }}` expression is GitHub's, gone before the shell reads.
const lineFaults = (text) => {
  const line = text.replace(/\$\{\{.*?\}\}/g, 'X');
  const faults = [];
  const first = line.split(/\s+/)[0];
  if (SHELL_WORDS.has(first)) faults.push(`\`${first}\``);
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const two = line.slice(i, i + 2);
    if (quote === "'") {
      if (c === "'") quote = null;
    } else if (two === '$(' || c === '`') {
      faults.push(`\`${two === '$(' ? '$(' : '`'}\``);
    } else if (quote === '"') {
      if (c === '\\') i++;
      else if (c === '"') quote = null;
    } else if (c === '\\') {
      i++;
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (two === '&&' || two === '>>' || two === '||') {
      faults.push(`\`${two}\``);
      i++;
    } else if (c === '|' || c === ';') {
      faults.push(c === '|' ? 'a pipe' : '`;`');
    }
  }
  return [...new Set(faults)];
};

// Each `run:` line of `text` that is more than one program start, as `<rel>:<line>: <faults>: <text>`.
const runFaults = (rel, text) => runLines(text).flatMap(({ line, text: shell }) => {
  const faults = lineFaults(shell);
  return faults.length ? [`${rel}:${line}: ${faults.join(', ')}: ${shell}`] : [];
});

// Every content line of the step with id scope in `jobs.<job>.steps` of `file`,
// trimmed, its `name:` left out and the release-push.js argument as one fixed
// word: the two parts the two copies spell apart.
const scopeStep = (file, job) => {
  const step = listItems(jobKey(file)(job, 'steps')).find((item) => {
    const id = block(item, 'id', indentOf(item[0]));
    return id && unquote(inlineValue(id)) === 'scope';
  });
  expect(step, `${path.basename(file)} jobs.${job} has a step with id scope`).toBeTruthy();
  const name = new RegExp(`^ {${indentOf(step[0])}}name:`);
  return step.filter((line) => isContent(line) && !name.test(line))
    .map((line) => line.trim().replace(/"[^"\s]*release-push\.js"|\S*release-push\.js/, 'RELEASE_PUSH')).join('\n');
};

describe('workflows: a plain value holding a colon', () => {
  test('names a run line whose plain value holds `: `, and only that line', () => {
    const text = 'jobs:\n  a:\n    steps:\n      - name: x\n        run: echo "a release push: no suite"\n';
    expect(JSON.stringify(plainColonLines(text)), 'lines named').toBe('[5]');
  });

  test('every kit workflow and installed workflow template is free of such a line', () => {
    const named = [];
    for (const dir of WORKFLOW_DIRS) {
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.yml'))) {
        const text = fs.readFileSync(path.join(dir, file), 'utf8');
        const lines = text.split(/\r?\n/);
        for (const n of plainColonLines(text)) named.push(`${path.relative(ROOT, dir)}/${file}:${n}: ${lines[n - 1].trim()}`);
      }
    }
    expect(named.join('\n'), 'lines YAML refuses').toBe('');
  });
});

describe('workflows: a run: line starts one program', () => {
  test('names the file and each line holding an if, a $(, a pipe, a >>, an && or an ||, and only those', () => {
    const text = [
      'jobs:', //                                                              1
      '  a:', //                                                               2
      '    defaults:', //                                                      3
      '      run:', //                                                         4
      '        shell: bash', //                                                5
      '    steps:', //                                                         6
      '      - run: |', //                                                     7
      '          if [ -f package-lock.json ]; then', //                        8
      '            npm ci', //                                                 9
      '          fi', //                                                       10
      '      - run: echo "v=$(node x.js)" >> "$GITHUB_OUTPUT"', //             11
      '      - run: npm test | tee log', //                                    12
      '      - name: fine', //                                                 13
      '        run: |', //                                                     14
      '          git config --global user.name "checks"', //                   15
      '          node "$RUNNER_TEMP/kit/.github/scripts/ci-env.js" node', //   16
      "          echo 'a | b && c >> d'", //                                   17
      '      - run: test "$A" = x || exit 1', //                               18
      "      - run: 'node a.js && node b.js'", //                              19
      '      - run: exit 1', //                                                20
    ].join('\n');
    const named = runFaults('x.yml', text).map((f) => f.replace(/: .*$/, ''));
    expect(named.join(' '), 'the lines named').toBe('x.yml:8 x.yml:10 x.yml:11 x.yml:12 x.yml:18 x.yml:19');
  });

  test('every kit workflow and installed workflow template holds program starts only', () => {
    const faults = workflowFiles().flatMap(({ rel, file }) => runFaults(rel, fs.readFileSync(file, 'utf8')));
    expect(faults.join('\n'), 'run: lines holding shell logic').toBe('');
  });
});

describe('workflows: a real YAML parse', () => {
  test('every kit workflow and installed workflow template parses as YAML', { skip: !HAS_RUBY && 'ruby with its YAML library does not run on this machine' }, () => {
    const files = WORKFLOW_DIRS.flatMap((dir) => fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))
      .map((f) => path.relative(ROOT, path.join(dir, f)).split(path.sep).join('/')));
    expect(files.length > 0, 'workflow files to parse').toBeTruthy();
    const res = run('ruby', ['-ryaml', '-e', RUBY_PARSE, ...files], { cwd: ROOT });
    expect(res.status, `ruby exit (${res.stderr.trim()})`).toBe(0);
    expect(res.stdout.trim().split(/\r?\n/).filter(Boolean).join('\n'), 'files YAML refuses').toBe('');
  });
});

describe('checks.yml: the triggers', () => {
  test('a push runs only on main; a pull request still runs', () => {
    const lines = fs.readFileSync(WORKFLOW, 'utf8').split(/\r?\n/);
    const on = block(lines, 'on', 0);
    expect(on, 'checks.yml has a top-level `on:`').toBeTruthy();
    const triggers = childIndent(on);
    expect(block(on, 'pull_request', triggers), 'pull_request is still a trigger').toBeTruthy();
    const push = block(on, 'push', triggers);
    expect(push, 'push is a trigger').toBeTruthy();
    const filters = childIndent(push);
    const branches = filters === -1 ? null : block(push, 'branches', filters);
    expect(branches, 'on.push carries `branches`').toBeTruthy();
    expect(JSON.stringify(listValue(branches)), 'on.push.branches').toBe(JSON.stringify(['main']));
  });
});

describe('checks.yml: the jobs', () => {
  test('suite and changelog need scope and run only on its run answer; test needs scope and suite', () => {
    const key = jobKey();
    for (const name of ['suite', 'changelog']) {
      expect(JSON.stringify(needsOf(key(name, 'needs'))), `jobs.${name}.needs`).toBe(JSON.stringify(['scope']));
      expect(inlineValue(key(name, 'if')), `jobs.${name}.if`).toBe("needs.scope.outputs.run == 'true'");
    }
    expect(JSON.stringify(needsOf(key('test', 'needs')).sort()), 'jobs.test.needs').toBe(JSON.stringify(['scope', 'suite']));
  });

  test('release runs on a push only, with contents and actions write, calling the kit\'s own release.yml', () => {
    const key = jobKey();
    expect(inlineValue(key('release', 'if')), 'jobs.release.if').toBe("github.event_name == 'push'");
    const permissions = key('release', 'permissions');
    const at = childIndent(permissions);
    for (const scope of ['contents', 'actions']) {
      const found = block(permissions, scope, at);
      expect(found, `jobs.release.permissions carries \`${scope}\``).toBeTruthy();
      expect(inlineValue(found), `jobs.release.permissions.${scope}`).toBe('write');
    }
    expect(inlineValue(key('release', 'uses')), 'jobs.release.uses').toBe('./.github/workflows/release.yml');
  });
});

describe("ci.yml: the release-push skip is decided before the repo's own setup", () => {
  test('the Scope step (id scope) comes before Setup (hooks.ciSetup)', () => {
    const steps = ciSteps();
    const scope = steps.findIndex((s) => s.id === 'scope');
    const setup = steps.findIndex((s) => s.name === 'Setup (hooks.ciSetup)');
    expect(scope >= 0, `a step with id scope, got: ${JSON.stringify(steps)}`).toBeTruthy();
    expect(setup >= 0, `a Setup (hooks.ciSetup) step, got: ${JSON.stringify(steps)}`).toBeTruthy();
    expect(scope < setup, `Scope (step ${scope}) before Setup (step ${setup})`).toBeTruthy();
  });

  test('Setup, Install dependencies, Post-install and Test each run only on the scope step\'s run answer', () => {
    const steps = ciSteps();
    for (const name of ['Setup (hooks.ciSetup)', 'Install dependencies', 'Post-install (hooks.ciPostInstall)', 'Test']) {
      const step = steps.find((s) => s.name === name);
      expect(step, `a ${name} step, got: ${JSON.stringify(steps)}`).toBeTruthy();
      expect(step.if, `${name}: if`).toBe("steps.scope.outputs.run == 'true'");
    }
  });

  test('ci.yml\'s scope step is checks.yml\'s whole step, its name and the release-push.js path aside', () => {
    const ci = scopeStep(CI, 'test');
    expect(ci !== '', 'ci.yml scope step has content lines').toBeTruthy();
    expect(ci, 'ci.yml scope step against checks.yml').toBe(scopeStep(WORKFLOW, 'scope'));
  });
});

describe('ci.yml: a repo\'s two hook lists', () => {
  test('the steps run setup, install, post-install, test, each hook step running ci-hooks.js with its own event', () => {
    const steps = ciSteps();
    const order = ['Setup (hooks.ciSetup)', 'Install dependencies', 'Post-install (hooks.ciPostInstall)', 'Test'];
    const at = order.map((name) => steps.findIndex((s) => s.name === name));
    expect(at.every((i) => i >= 0), `each of ${order.join(', ')}, got: ${JSON.stringify(steps.map((s) => s.name))}`).toBeTruthy();
    expect(at.every((i, n) => n === 0 || at[n - 1] < i), `in that order, got steps ${at.join(', ')}`).toBeTruthy();
    expect(hooksEvent(steps[at[0]]), `Setup runs ci-hooks.js ciSetup, got: ${steps[at[0]].run}`).toBe('ciSetup');
    expect(hooksEvent(steps[at[2]]), `Post-install runs ci-hooks.js ciPostInstall, got: ${steps[at[2]].run}`).toBe('ciPostInstall');
  });
});

describe('ci.yml and checks.yml: the kit\'s scripts on the kit\'s Node, the repo on its own', () => {
  test('in each job that starts a kit script, setup-node at lts/* comes before the first one', () => {
    const seen = [];
    for (const file of fs.readdirSync(KIT_WORKFLOWS).filter((f) => f.endsWith('.yml')).map((f) => path.join(KIT_WORKFLOWS, f))) {
      for (const { job, steps } of stepJobs(file)) {
        const first = steps.findIndex((s) => kitCalls(s).length > 0);
        if (first === -1) continue;
        const where = `${path.basename(file)} jobs.${job}`;
        seen.push(where);
        const kitNode = steps.findIndex(isKitNode);
        expect(kitNode >= 0 && kitNode < first, `${where}: the lts/* setup (step ${kitNode}) before the first kit script (step ${first})`).toBeTruthy();
      }
    }
    for (const where of ['ci.yml jobs.test', 'checks.yml jobs.scope', 'changelog.yml jobs.changelog']) {
      expect(seen.includes(where), `${where} starts a kit script, got: ${JSON.stringify(seen)}`).toBeTruthy();
    }
  });

  test('ci.yml jobs.test and checks.yml jobs.scope write WORKKIT_NODE after the lts/* setup, before the first script on it and any later setup-node', () => {
    for (const [file, job] of [[CI, 'test'], [WORKFLOW, 'scope']]) {
      const steps = parseSteps(jobKey(file)(job, 'steps'));
      const kitNode = steps.findIndex(isKitNode);
      const sets = steps.findIndex(setsKitNode);
      const first = steps.findIndex((s) => kitCalls(s).some(onKitNode));
      const nextSetup = steps.findIndex((s, i) => i > kitNode && isSetupNode(s));
      const at = `the lts/* setup ${kitNode}, the ci-env.js node step ${sets}, the first script on "$WORKKIT_NODE" ${first}, the next setup-node ${nextSetup}`;
      expect(kitNode >= 0 && sets > kitNode && first > sets && (nextSetup === -1 || nextSetup > sets),
        `${path.basename(file)} jobs.${job}: ${at}`).toBeTruthy();
    }
  });

  test('ci-env.js node starts on PATH\'s node, every kit script after it on "$WORKKIT_NODE", and ci.yml starts all six', () => {
    const wrong = [];
    for (const [file, job] of [[CI, 'test'], [WORKFLOW, 'scope']]) {
      const steps = parseSteps(jobKey(file)(job, 'steps'));
      const sets = steps.findIndex(setsKitNode);
      steps.forEach((step, at) => {
        for (const call of kitCalls(step)) {
          const writes = call.script === 'ci-env.js' && call.arg === 'node';
          const fine = writes ? call.starter === 'node' && at === sets : at > sets && onKitNode(call);
          if (!fine || !call.script.endsWith('.js')) wrong.push(`${path.basename(file)} jobs.${job} ${step.name || step.id}: ${call.starter} ${call.script}`);
        }
      });
    }
    expect(wrong.join('\n'), 'kit scripts started on the wrong Node, or not a .js file').toBe('');
    const scripts = [...new Set(ciSteps().flatMap((s) => kitCalls(s).map((c) => c.script)))].sort();
    expect(JSON.stringify(scripts), 'the kit scripts ci.yml starts')
      .toBe(JSON.stringify(['ci-env.js', 'ci-hooks.js', 'ci-install.js', 'ci-node-version.js', 'ci-test.js', 'release-push.js']));
  });

  test('checks.yml jobs.scope checks out on every event, before the scope step starts release-push.js from the workspace', () => {
    const steps = parseSteps(jobKey(WORKFLOW)('scope', 'steps'));
    const scope = steps.findIndex((s) => s.id === 'scope');
    const checkout = steps.findIndex((s) => (s.uses || '').startsWith('actions/checkout@'));
    expect(scope >= 0 && kitCalls(steps[scope]).some((c) => c.script === 'release-push.js'), `the scope step starts release-push.js, got: ${JSON.stringify(steps)}`).toBeTruthy();
    expect(checkout >= 0 && checkout < scope, `a checkout (step ${checkout}) before the scope step (step ${scope})`).toBeTruthy();
    expect(steps[checkout].if, 'the checkout\'s if: a pull request reaches the scope step too, and its script must be there').toBe(null);
  });

  test('ci.yml sets up the Node ci-node-version.js names after the kit\'s, before the repo\'s hooks and install', () => {
    const steps = ciSteps();
    const named = steps.findIndex((s) => kitCalls(s).some((c) => c.script === 'ci-node-version.js'));
    expect(named >= 0 && Boolean(steps[named].id), `a step with an id starting ci-node-version.js, got: ${JSON.stringify(steps)}`).toBeTruthy();
    const repoNode = steps.findIndex((s) => isSetupNode(s) && (s.nodeVersion || '').includes(`steps.${steps[named].id}.outputs.`));
    expect(repoNode >= 0, `a setup-node taking its version from steps.${steps[named].id}, got: ${JSON.stringify(steps)}`).toBeTruthy();
    const kitNode = steps.findIndex(isKitNode);
    const setup = steps.findIndex((s) => s.name === 'Setup (hooks.ciSetup)');
    const install = steps.findIndex((s) => s.name === 'Install dependencies');
    const order = [['the kit\'s lts/* setup', kitNode], ['the version step', named], ['the repo\'s setup-node', repoNode], ['Setup (hooks.ciSetup)', setup], ['Install dependencies', install]];
    expect(order.every(([, i], n) => i >= 0 && (n === 0 || order[n - 1][1] < i)), `in order: ${order.map(([what, i]) => `${what} ${i}`).join(', ')}`).toBeTruthy();
  });
});

describe('workflows: a hung run ends at a time limit', () => {
  test('ci.yml jobs.test and checks.yml jobs.suite each end after 60 minutes', () => {
    expect(inlineValue(jobKey(CI)('test', 'timeout-minutes')), 'ci.yml jobs.test.timeout-minutes').toBe('60');
    expect(inlineValue(jobKey(WORKFLOW)('suite', 'timeout-minutes')), 'checks.yml jobs.suite.timeout-minutes').toBe('60');
  });
});
