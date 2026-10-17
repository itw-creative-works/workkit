// The claim is the agent:claimed label and the assignee is a person: the docs
// that tell an agent how to claim say so, and none of them still assigns. The
// feature skill's claim comment names the bot that posts it.
const path = require('path');
const fs = require('fs');
const { group, test, assert, summary, selfRun } = require('../../lib/harness');

const REPO = path.join(__dirname, '..', '..', '..');
const SKILL = path.join(REPO, 'skills', 'feature', 'SKILL.md');
const PROMPT = path.join(REPO, 'hooks', 'docs', 'change-tracker', 'resources', 'prompt.md');
const SPEC = path.join(REPO, 'docs', 'project-state.md');

const read = (file) => fs.readFileSync(file, 'utf8');
const rel = (file) => path.relative(REPO, file);

// One `## ` section of a markdown file, up to the next heading of that level,
// so a phrase elsewhere in the file cannot stand in for the section's rule.
const section = (file, heading) => {
  const text = read(file);
  const start = text.indexOf(`\n${heading}\n`);
  assert(start >= 0, `${rel(file)} has no "${heading}" heading`);
  const rest = text.slice(start + heading.length + 2);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
};

const run = async () => {
  group('identity: the claim is the label, in the docs that teach it');

  await test('no claim instruction assigns anyone', () => {
    for (const file of [SKILL, PROMPT, SPEC]) {
      assert(!read(file).includes('--add-assignee'), `${rel(file)} still tells an agent to --add-assignee`);
    }
    assert(!/assign yourself/i.test(read(SKILL)), 'the feature skill still says to assign yourself');
    assert(!/assignment IS the claim/i.test(read(PROMPT)), 'the change-tracker prompt still calls the assignment the claim');
  });

  await test('the feature skill\'s claim comment names workkit-agent[bot] and the owner\'s session', () => {
    assert(read(SKILL).includes('Claimed by workkit-agent[bot] for @<login>\'s session.'),
      'the skill carries the claim comment text: Claimed by workkit-agent[bot] for @<login>\'s session.');
  });

  await test('the change-tracker prompt names the label as the claim', () => {
    assert(read(PROMPT).includes('`agent:claimed` is the claim'), 'the Stop prompt says `agent:claimed` is the claim');
  });

  await test('§ Queue semantics says the label is the claim and the assignee a person', () => {
    const queue = section(SPEC, '## Queue semantics');
    assert(queue.includes('`agent:claimed` is the claim'), '§ Queue semantics says `agent:claimed` is the claim');
    assert(/the assignee is a person/i.test(queue), '§ Queue semantics says the assignee is a person');
    assert(!/the assignee is the claim/i.test(queue), '§ Queue semantics still calls the assignee the claim');
    assert(!/loses the label and its assignee/i.test(queue), '§ Queue semantics still has the stale sweep remove the assignee');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
