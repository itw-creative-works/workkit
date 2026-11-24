/**
 * jobs/morning/brief-publish.js: posts today's digest as a Discussion on the
 * home repo, for the morning's cloud path. It answers one line and a code, and
 * the caller decides what a failure costs (jobs/README.md § The brief is published).
 * Usage: const { publishBrief } = require('./brief-publish');
 */

const fs = require('fs');
const { sizeOf } = require('../../workflow/lib/attach');
const {
  BRIEF_CATEGORY, ready, list, create, resolveCategory,
} = require('../../workflow/lib/discussions');
const { today } = require('../../workflow/lib/day');
const { homeSlug } = require('../../workflow/lib/settings');
const { userDir } = require('../../workflow/user-dir');
const { BRIEF_TITLE_PREFIX } = require('../../tower/api/lib/history');

/**
 * The body as the post carries it: the digest and its newline, then, when the
 * mark file holds a version line, one empty line and that file verbatim.
 * @param {string} bodyFile
 * @param {string} response
 * @param {string} markFile
 */
const writeBody = (bodyFile, response, markFile) => {
  const parts = [Buffer.from(`${response}\n`)];
  if (sizeOf(markFile) > 0) parts.push(Buffer.from('\n'), fs.readFileSync(markFile));
  fs.writeFileSync(bodyFile, Buffer.concat(parts));
};

/**
 * Today's digest posted in the home repo's Brief category, or its fallback,
 * once: a brief already titled for today is not posted twice, so the
 * dispatched run and its cron backup can both fire on one morning.
 * @param {{response: string, markFile: string, bodyFile: string}} brief the
 *   digest, the file holding its version line (empty for none), the body's file
 * @returns {Promise<{code: number, line: string}>} 0 posted (the line carries
 *   the URL), 2 nothing to post, 1 not landed
 */
const publishBrief = async ({ response, markFile, bodyFile }) => {
  const slug = homeSlug(userDir()) ?? '';
  if (!slug) return { code: 2, line: 'brief: no home repo configured; nothing published' };
  if (!(await ready())) return { code: 2, line: `brief: ${slug} is the home repo, but gh is what reaches it; nothing published` };

  const date = today();
  const title = `${BRIEF_TITLE_PREFIX}${date}`;
  const posted = await list(slug, BRIEF_CATEGORY, `${date}T00:00:00Z`);
  if (posted !== null && posted.some((post) => post.title === title)) {
    return { code: 2, line: `brief: ${slug} already carries ${title}; nothing posted` };
  }

  writeBody(bodyFile, response, markFile);
  // One null covers two causes, a failed read and a repo with no categories,
  // and this caller cannot tell them apart, so the line names neither.
  const found = await resolveCategory(slug, BRIEF_CATEGORY);
  if (found === null) return { code: 1, line: `brief: could not resolve a discussion category on ${slug}; nothing posted` };
  const url = await create(slug, found.id, title, bodyFile);
  if (!url) return { code: 1, line: `brief: ${title} could not be posted to ${slug}; nothing posted` };
  return { code: 0, line: `brief: posted ${title} → ${url}` };
};

module.exports = { publishBrief };
