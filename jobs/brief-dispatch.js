#!/usr/bin/env node
/**
 * jobs/brief-dispatch.js: hands the day to the cloud, a `workflow_dispatch` of
 * brief.yml on the home repo. It prints nothing; each caller decides what a
 * refusal is worth. The morning calls it in its own process, and `workkit brief`
 * (workflow/workkit/commands.js) runs it as a program.
 * Usage: const { dispatchBrief, BRIEF_WORKFLOW } = require('./brief-dispatch');
 *        node brief-dispatch.js   (line 1 the slug, line 2 the line or the reason; 0 dispatched, 1 refused)
 */

const { onPath, spawnSync } = require('../workflow/lib/run');
const { writeOut } = require('../workflow/lib/say');
const { homeSlug } = require('../workflow/lib/settings');
const { spin } = require('../workflow/lib/spin');
const { userDir } = require('../workflow/user-dir');
const { chomp } = require('../hooks/mods/text.js');

// The workflow on the home repo that runs the morning on a runner; `workkit
// setup` seeds it as .github/workflows/brief.yml.
const BRIEF_WORKFLOW = 'brief.yml';

// The two secrets a runner needs, each with what it costs a run without it.
const SECRETS = [
  ['CLAUDE_CODE_OAUTH_TOKEN', 'a runner without it composes nothing'],
  ['WORKKIT_GITHUB_TOKEN', 'a runner without it sweeps no board'],
];

/** `gh` with <args>, stdout read, stderr dropped, spun with no wait line where no frames draw: this file prints nothing. */
const gh = (message, args) => spin(message, () => spawnSync('gh', args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
}), { line: false });

/** Whether a `gh secret list` answer names <name> at the start of a line. */
const carries = (secrets, name) => new RegExp(`^${name}(\\s|$)`, 'm').test(secrets);

/**
 * The dispatch, or the one named reason it cannot be made: nothing is composed
 * anywhere to cover for it (jobs/README.md § The morning on this machine).
 * @returns {{dispatched: boolean, slug: string, line: string, reason: string}}
 *   slug: the home repo the dispatch was made against, what a caller points a
 *   human at to watch the run, empty before one is known
 */
const dispatchBrief = () => {
  const refused = (reason, slug = '') => ({
    dispatched: false, slug, line: '', reason,
  });
  if (onPath('gh') === null) return refused('gh is not on this machine');
  const slug = homeSlug(userDir()) ?? '';
  if (!slug) return refused('no home repo is configured; `workkit setup` creates it');

  // A dispatch succeeds the moment the workflow is on the default branch, so both
  // secrets are checked first, in one listing. A failed listing and an empty one
  // are different mornings: a repo this token cannot read, and one with none.
  const listing = gh(`reading the secrets on ${slug}`, ['secret', 'list', '--repo', slug]);
  if (listing.status !== 0) return refused(`the secrets on ${slug} could not be listed`, slug);
  const secrets = chomp(listing.stdout);
  if (!secrets) return refused(`${slug} carries no secrets; \`workkit setup\` wires both`, slug);
  const missing = SECRETS.find(([name]) => !carries(secrets, name));
  if (missing) return refused(`${slug} does not carry ${missing[0]}; ${missing[1]}`, slug);

  const run = gh(`dispatching ${BRIEF_WORKFLOW} on ${slug}`, ['workflow', 'run', BRIEF_WORKFLOW, '--repo', slug]);
  if (run.status !== 0) return refused(`gh workflow run ${BRIEF_WORKFLOW} on ${slug} did not land`, slug);
  return {
    dispatched: true,
    slug,
    line: `brief: dispatched ${BRIEF_WORKFLOW} on ${slug}; the cloud runner composes and publishes today's brief`,
    reason: '',
  };
};

/**
 * The program, for `workkit brief`: the slug on line 1, the line or the
 * reason on line 2.
 * @returns {Promise<number>} 0 dispatched, 1 refused
 */
const main = async () => {
  const {
    dispatched, slug, line, reason,
  } = dispatchBrief();
  writeOut(`${slug}\n${dispatched ? line : reason}\n`);
  return dispatched ? 0 : 1;
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards output still buffered for a pipe.
  main().then((code) => { process.exitCode = code; });
}

module.exports = { main, dispatchBrief, BRIEF_WORKFLOW };
