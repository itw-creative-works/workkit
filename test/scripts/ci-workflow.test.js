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
  group, test, testUnless, assert, assertEq, run, SPAWN_DEADLINE, selfRun, summary,
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
  assert(jobs, `${path.basename(file)} has a top-level \`jobs:\``);
  const at = childIndent(jobs);
  return (name, k) => {
    const job = block(jobs, name, at);
    assert(job, `jobs.${name} exists`);
    const found = block(job, k, childIndent(job));
    assert(found, `jobs.${name} carries \`${k}\``);
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
  assert(step, `${path.basename(file)} jobs.${job} has a step with id scope`);
  const name = new RegExp(`^ {${indentOf(step[0])}}name:`);
  return step.filter((line) => isContent(line) && !name.test(line))
    .map((line) => line.trim().replace(/"[^"\s]*release-push\.sh"|\S*release-push\.sh/, 'RELEASE_PUSH')).join('\n');
};

const cases = async () => {
  group('workflows: a plain value holding a colon');

  await test('names a run line whose plain value holds `: `, and only that line', () => {
    const text = 'jobs:\n  a:\n    steps:\n      - name: x\n        run: echo "a release push: no suite"\n';
    assertEq(JSON.stringify(plainColonLines(text)), '[5]', 'lines named');
  });

  await test('every kit workflow and installed workflow template is free of such a line', () => {
    const named = [];
    for (const dir of WORKFLOW_DIRS) {
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.yml'))) {
        const text = fs.readFileSync(path.join(dir, file), 'utf8');
        const lines = text.split(/\r?\n/);
        for (const n of plainColonLines(text)) named.push(`${path.relative(ROOT, dir)}/${file}:${n}: ${lines[n - 1].trim()}`);
      }
    }
    assertEq(named.join('\n'), '', 'lines YAML refuses');
  });

  group('workflows: a real YAML parse');

  await testUnless(!HAS_RUBY, 'ruby with its YAML library does not run on this machine')('every kit workflow and installed workflow template parses as YAML', () => {
    const files = WORKFLOW_DIRS.flatMap((dir) => fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))
      .map((f) => path.relative(ROOT, path.join(dir, f)).split(path.sep).join('/')));
    assert(files.length > 0, 'workflow files to parse');
    const res = run('ruby', ['-ryaml', '-e', RUBY_PARSE, ...files], { cwd: ROOT });
    assertEq(res.status, 0, `ruby exit (${res.stderr.trim()})`);
    assertEq(res.stdout.trim().split(/\r?\n/).filter(Boolean).join('\n'), '', 'files YAML refuses');
  });

  group('checks.yml: the triggers');

  await test('a push runs only on main; a pull request still runs', () => {
    const lines = fs.readFileSync(WORKFLOW, 'utf8').split(/\r?\n/);
    const on = block(lines, 'on', 0);
    assert(on, 'checks.yml has a top-level `on:`');
    const triggers = childIndent(on);
    assert(block(on, 'pull_request', triggers), 'pull_request is still a trigger');
    const push = block(on, 'push', triggers);
    assert(push, 'push is a trigger');
    const filters = childIndent(push);
    const branches = filters === -1 ? null : block(push, 'branches', filters);
    assert(branches, 'on.push carries `branches`');
    assertEq(JSON.stringify(listValue(branches)), JSON.stringify(['main']), 'on.push.branches');
  });

  group('checks.yml: the jobs');

  await test('suite and changelog need scope and run only on its run answer; test needs scope and suite', () => {
    const key = jobKey();
    for (const name of ['suite', 'changelog']) {
      assertEq(JSON.stringify(needsOf(key(name, 'needs'))), JSON.stringify(['scope']), `jobs.${name}.needs`);
      assertEq(inlineValue(key(name, 'if')), "needs.scope.outputs.run == 'true'", `jobs.${name}.if`);
    }
    assertEq(JSON.stringify(needsOf(key('test', 'needs')).sort()), JSON.stringify(['scope', 'suite']), 'jobs.test.needs');
  });

  await test('release runs on a push only, with contents and actions write, calling the kit\'s own release.yml', () => {
    const key = jobKey();
    assertEq(inlineValue(key('release', 'if')), "github.event_name == 'push'", 'jobs.release.if');
    const permissions = key('release', 'permissions');
    const at = childIndent(permissions);
    for (const scope of ['contents', 'actions']) {
      const found = block(permissions, scope, at);
      assert(found, `jobs.release.permissions carries \`${scope}\``);
      assertEq(inlineValue(found), 'write', `jobs.release.permissions.${scope}`);
    }
    assertEq(inlineValue(key('release', 'uses')), './.github/workflows/release.yml', 'jobs.release.uses');
  });

  group('ci.yml: the release-push skip is decided before setup');

  await test('the Scope step (id scope) comes before Setup (hooks.ciSetup)', () => {
    const steps = ciSteps();
    const scope = steps.findIndex((s) => s.id === 'scope');
    const setup = steps.findIndex((s) => s.name === 'Setup (hooks.ciSetup)');
    assert(scope >= 0, `a step with id scope, got: ${JSON.stringify(steps)}`);
    assert(setup >= 0, `a Setup (hooks.ciSetup) step, got: ${JSON.stringify(steps)}`);
    assert(scope < setup, `Scope (step ${scope}) before Setup (step ${setup})`);
  });

  await test('Setup, Install dependencies and Test each run only on the scope step\'s run answer', () => {
    const steps = ciSteps();
    for (const name of ['Setup (hooks.ciSetup)', 'Install dependencies', 'Test']) {
      const step = steps.find((s) => s.name === name);
      assert(step, `a ${name} step, got: ${JSON.stringify(steps)}`);
      assertEq(step.if, "steps.scope.outputs.run == 'true'", `${name}: if`);
    }
  });

  await test('ci.yml\'s scope step is checks.yml\'s whole step, its name and the release-push.sh path aside', () => {
    const ci = scopeStep(CI, 'test');
    assert(ci !== '', 'ci.yml scope step has content lines');
    assertEq(ci, scopeStep(WORKFLOW, 'scope'), 'ci.yml scope step against checks.yml');
  });

  group('workflows: a hung run ends at a time limit');

  await test('ci.yml jobs.test and checks.yml jobs.suite each end after 60 minutes', () => {
    assertEq(inlineValue(jobKey(CI)('test', 'timeout-minutes')), '60', 'ci.yml jobs.test.timeout-minutes');
    assertEq(inlineValue(jobKey(WORKFLOW)('suite', 'timeout-minutes')), '60', 'checks.yml jobs.suite.timeout-minutes');
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
