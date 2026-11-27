/**
 * workflow/workkit/help.js: the command's map, printed by `help`, `-h`,
 * `--help` and no word on stdout, and after an unknown word on stderr.
 * Usage: const { HELP, usage } = require('./help');
 */

const HELP = `workkit: the issue workflow, one command.

usage: workkit <command> [args]

  help                 this map
  setup                from zero on this machine: the plugin, gh, the 9am
                       schedule, the home repo and whether it publishes its
                       dashboard, the cloud brief's secrets, the bot identity's
                       sign-in, the tower pointer, this repo's opt-in and the
                       App's install page for it, the workkit and gh
                       symlinks, and npm's script-shell. Safe to re-run
  setup --token        that wizard's Claude-token step alone, forced: mint a
                       new CLAUDE_CODE_OAUTH_TOKEN and push it to the home
                       repo, however young the one there is
  setup --login        that wizard's sign-in step alone, forced: sign in to
                       GitHub (the device flow) so the agent's issue
                       bookkeeping posts as workkit-agent[bot], replacing any
                       sign-in already here, with or without a terminal
  setup --bot          that wizard's App install step alone, forced: offer
                       workkit-agent[bot]'s install page, pre-selected on this
                       repo's owner, and wait until the install lands; sign
                       in first with setup --login
  setup --home         that wizard's home repo step alone, forced: create the
                       private <login>/workkit and make ~/.workkit/tower its
                       clone, asking nothing, with or without a terminal
  setup --cloud        that wizard for a cloud session: the workkit and gh
                       symlinks, npm's script-shell and the gh login check;
                       every other step is a not-applicable line, asking
                       nothing
  update [--auto]      re-run the machine-side installs: the engine address,
                       the workkit and gh symlinks, npm's script-shell, and
                       the schedule (only where one is already installed).
                       --auto is the quiet variant the standards hook runs
                       once a day
  doctor               report what is set up, what has drifted, and the command
                       that fixes anything out of reach
  publish              build the dashboard and publish it from the home repo
                       (the daily job does this after the morning brief)
  brief [--local]      ask for today's brief now: the same cloud run the 9am
                       schedule dispatches. --local runs the local morning
                       instead, composed and sent from this machine, the
                       brief never posted to the home repo
  log [-n N] [--follow]
                       the hooks log: one line per hook fire, its last 40
                       lines, or N; --follow keeps printing new ones
  tower [--verbose]    run the tower here: the JSON API and the dashboard
                       together, until one interrupt ends both
  enable [repo]        write the repo's committed opt-in, then heal it
  decline [repo]       record this developer's no for the repo, personally
  heal [repo]          re-run the standards heal on the repo now, the same
                       pass a session makes once a day, without the wait
  state [repo]         print the repo's participation: enabled, disabled,
                       declined, undecided, home or nogit
  note <text...>       append one bullet to the nearest capture file, or file it
                       as an issue on the home repo outside every project
  test [paths] [--filter=<text>]
                       hand the paths and the flag to this repo's npm test, run
                       at its root, so the script shell records the run
  tools                print each command this repo's suites name through
                       needs(), one per line, sorted, for a setup to install
  convert [paths...]   rewrite this repo's old-shape suites in place onto
                       Node's test functions, one line per file, from its root
  prove                run the root suite on exactly the staged tree, in a copy
                       outside the repo, and record it on green, so a commit
                       of it passes the gate while other work stays unstaged
  supervise -- <command> [args...]
                       run the command detached under the supervisor, as the
                       root suite runs, its output tailed here and in the run
                       log; exit its code, 124 frozen and ended, 125 a look
  watch [--end] [suite|run|<pid>]
                       follow the live run again: the suite's, else the
                       supervised one, else the one live narrowed run, or the
                       one named (a narrowed run by its pid); --end ends the
                       named run, or the one live run
  public intake        take each new issue on the paired public repo into this
                       repo's inbox, linked, with the intake comment on it
  public mirror <N>... | --all
                       copy each linked issue's status label onto its public
                       issue, posting nothing
  public close <version> <N>...
                       close each linked public issue with the version and its
                       CHANGELOG entry
  ship items           list the open issues at qa then complete, each with
                       whether it carries its Proof: line
  ship release <x.y.z> [--keep N,M]
                       the release: the bump, the [Unreleased] move and the
                       entry backfill, every check before any write
  ship watch <sha>     watch every CI run for a pushed sha and answer green or
                       red by exit code
  ship cut <x.y.z>     wait for the GitHub release CI's release job makes (any
                       earlier unreleased ones first), then run the repo's
                       afterRelease hooks; a caller with no release job, or no
                       release within the wait, is one line and exit 1
  ship plan            print which packages publish to npm, in which order,
                       and which are skipped and why; publishes nothing
  ship publish         publish that plan in order, asking npm first, stopping
                       at the first failure, then the repo's afterPublish hooks
  ship deploy          run the deploy script (else the release script), then
                       the repo's afterDeploy hooks; never asks
  review covers        whether the full-panel review marker covers the
                       working diff: exit 0 covered, 1 stale
  review mark [full]   record that the review ran on this repo; full records
                       the full panel too
  triage mark          record that a triage drain is under way, so the capture
                       guard lets it read the capture file
  checkpoint safe      record that a checkpoint put every item on the board,
                       keyed by this session, for a harness to read
  proof red [--live] <path>... -- <command>...
                       run the command against the paths as the claim found
                       them, so the tests must fail: exit 0 red, 1 green
  changelog lint <file> [--added-only [--base=<ref>]] [--staged] [--unreleased-only]
                       check the CHANGELOG entries against the entry format

The engine it drives lives beside this script; the spec both implement is
docs/project-state.md in the kit.
`;

/**
 * The map on <stream>, whole.
 * @param {{write: (text: string) => *}} [stream] process.stdout by default
 */
const usage = (stream = process.stdout) => { stream.write(HELP); };

module.exports = { HELP, usage };
