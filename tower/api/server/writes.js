// tower/api/server/writes.js: the two write paths, filing an issue and moving
// one along the pipeline, each judged before `gh` and gated where the spec
// gates it. server.js requires it; no piece requires server.js.

const { sendJson, readPayload, urlFrom } = require('./http');
const {
  validateIntake, validateMove, PROOF_LINE, PROOF_GATED,
} = require('./validate');

/**
 * The two writes one server answers.
 * @param {object} deps
 * @param {Function} deps.exec the git/gh/ps seam
 * @param {Function} deps.slugsNow the roster's slugs, from the feeds
 * @returns {{intake: Function, moveStatus: Function}}
 */
const createWrites = ({ exec, slugsNow }) => {
  const intake = async (req, res) => {
    const read = await readPayload(req, res);
    if (!read.ok) return;

    const slugs = slugsNow();
    const checked = validateIntake(read.payload, slugs);
    if (!checked.ok) {
      sendJson(res, 400, checked);
      return;
    }

    let stdout;
    try {
      stdout = exec('gh', [
        'issue', 'create',
        '--repo', checked.repo,
        '--title', checked.title,
        '--body', checked.body,
        '--label', 'status:inbox',
        '--label', 'type:idea',
      ]);
    } catch (err) {
      // gh being absent, unauthenticated, or offline is an expected condition
      // for a tower on a phone: the page renders the reason, not an error page.
      const detail = String(err.stderr || err.message || '').trim().split('\n').pop();
      sendJson(res, 200, { ok: false, reason: `gh issue create failed: ${detail}` });
      return;
    }

    const url = urlFrom(stdout);
    if (!url) {
      sendJson(res, 200, { ok: false, reason: 'gh issue create printed no issue URL' });
      return;
    }
    sendJson(res, 200, { ok: true, url });
  };

  // The board's drag, arriving as a write. One `gh issue edit` carries both
  // halves of the move, so the issue is never momentarily unlabelled or
  // momentarily carrying two statuses.
  const moveStatus = async (req, res) => {
    const read = await readPayload(req, res);
    if (!read.ok) return;

    const checked = validateMove(read.payload, slugsNow());
    if (!checked.ok) {
      sendJson(res, 400, checked);
      return;
    }

    // The proof gate (docs/project-state.md, "The proof"), which the board is
    // the second door into: safety/proof-guard holds the shell's `gh issue
    // edit`, and this holds the drag. It sits here rather than in validateMove
    // because it is a READ - that function is pure and never reaches `gh` - and
    // only a move to complete pays for it.
    if (checked.to === PROOF_GATED) {
      let comments;
      try {
        const view = exec('gh', [
          'issue', 'view', String(checked.number),
          '--repo', checked.repo,
          '--json', 'comments',
        ]);
        comments = JSON.parse(view).comments;
      } catch (err) {
        // Unreadable is a REFUSAL, never a pass: a gate that cannot ask the
        // question must not answer it yes. Soft-failed like the write below, so
        // the page reverts the card and shows the sentence.
        const detail = String(err.stderr || err.message || '').trim().split('\n').pop();
        sendJson(res, 200, {
          ok: false,
          reason: `the proof on issue #${checked.number} could not be read (${detail}), so the move to status:complete was refused. Nothing was changed.`,
        });
        return;
      }
      const proved = Array.isArray(comments)
        && comments.some((comment) => PROOF_LINE.test(String((comment && comment.body) || '')));
      if (!proved) {
        sendJson(res, 200, {
          ok: false,
          reason: `issue #${checked.number} carries no comment whose line starts with "Proof:", so it cannot move to status:complete. Park it with a Proof: comment first, one entry per layer, then move the card.`,
        });
        return;
      }
    }

    try {
      exec('gh', [
        'issue', 'edit', String(checked.number),
        '--repo', checked.repo,
        '--remove-label', `status:${checked.from}`,
        '--add-label', `status:${checked.to}`,
      ]);
    } catch (err) {
      // Soft, like intake's: the page reverts the card and shows this sentence.
      const detail = String(err.stderr || err.message || '').trim().split('\n').pop();
      sendJson(res, 200, { ok: false, reason: `gh issue edit failed: ${detail}` });
      return;
    }

    sendJson(res, 200, {
      ok: true, repo: checked.repo, number: checked.number, status: checked.to,
    });
  };

  return { intake, moveStatus };
};

module.exports = { createWrites };
