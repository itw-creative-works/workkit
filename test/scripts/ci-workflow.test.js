/* eslint-disable no-console */
// The kit's workflows: every kit workflow and installed template parses under Ruby's YAML
// and holds no plain value with a colon; checks.yml runs a push on main only, its scope answer
// gates suite and changelog, and release runs on a push only; ci.yml's Scope step
// decides before setup and gates the rest, and is checks.yml's but name and path;
// ci.yml's test job and checks.yml's suite job each carry a 60 minute limit.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('../lib/platform');
const {
  describe, test, expect, run, SPAWN_DEADLINE,
} = require('../lib/harness');
const {
  indentOf, isContent, block, inlineValue, listValue, listItems, unquote, plainColonLines,
} = require('../lib/workflow-yaml');

const ROOT = path.join(__dirname, '..', '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'checks.yml');
const CI = path.join(ROOT, '.github', 'workflows', 'ci.yml');
// The kit's own workflows and the workflow templates it installs into a repo.
const WORKFLOW_DIRS = [path.join(ROOT, '.github', 'workflows'), path.join(ROOT, 'workflow', 'templates', 'github-workflows')];

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

// ci.yml's `jobs.test.steps`, each step as `{ name, id, if }` (absent keys null).
const ciSteps = () => listItems(jobKey(CI)('test', 'steps')).map((item) => {
  const value = (k) => {
    const found = block(item, k, indentOf(item[0]));
    return found ? unquote(inlineValue(found)) : null;
  };
  return { name: value('name'), id: value('id'), if: value('if') };
});

// Every content line of the step with id scope in `jobs.<job>.steps` of `file`,
// trimmed, its `name:` left out and the release-push.sh argument as one fixed
// word: the two parts the two copies spell apart.
const scopeStep = (file, job) => {
  const step = listItems(jobKey(file)(job, 'steps')).find((item) => {
    const id = block(item, 'id', indentOf(item[0]));
    return id && unquote(inlineValue(id)) === 'scope';
  });
  expect(step, `${path.basename(file)} jobs.${job} has a step with id scope`).toBeTruthy();
  const name = new RegExp(`^ {${indentOf(step[0])}}name:`);
  return step.filter((line) => isContent(line) && !name.test(line))
    .map((line) => line.trim().replace(/"[^"\s]*release-push\.sh"|\S*release-push\.sh/, 'RELEASE_PUSH')).join('\n');
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

describe('ci.yml: the release-push skip is decided before setup', () => {
  test('the Scope step (id scope) comes before Setup (hooks.ciSetup)', () => {
    const steps = ciSteps();
    const scope = steps.findIndex((s) => s.id === 'scope');
    const setup = steps.findIndex((s) => s.name === 'Setup (hooks.ciSetup)');
    expect(scope >= 0, `a step with id scope, got: ${JSON.stringify(steps)}`).toBeTruthy();
    expect(setup >= 0, `a Setup (hooks.ciSetup) step, got: ${JSON.stringify(steps)}`).toBeTruthy();
    expect(scope < setup, `Scope (step ${scope}) before Setup (step ${setup})`).toBeTruthy();
  });

  test('Setup, Install dependencies and Test each run only on the scope step\'s run answer', () => {
    const steps = ciSteps();
    for (const name of ['Setup (hooks.ciSetup)', 'Install dependencies', 'Test']) {
      const step = steps.find((s) => s.name === name);
      expect(step, `a ${name} step, got: ${JSON.stringify(steps)}`).toBeTruthy();
      expect(step.if, `${name}: if`).toBe("steps.scope.outputs.run == 'true'");
    }
  });

  test('ci.yml\'s scope step is checks.yml\'s whole step, its name and the release-push.sh path aside', () => {
    const ci = scopeStep(CI, 'test');
    expect(ci !== '', 'ci.yml scope step has content lines').toBeTruthy();
    expect(ci, 'ci.yml scope step against checks.yml').toBe(scopeStep(WORKFLOW, 'scope'));
  });
});

describe('workflows: a hung run ends at a time limit', () => {
  test('ci.yml jobs.test and checks.yml jobs.suite each end after 60 minutes', () => {
    expect(inlineValue(jobKey(CI)('test', 'timeout-minutes')), 'ci.yml jobs.test.timeout-minutes').toBe('60');
    expect(inlineValue(jobKey(WORKFLOW)('suite', 'timeout-minutes')), 'checks.yml jobs.suite.timeout-minutes').toBe('60');
  });
});
