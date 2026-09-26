// libs/tower/github/summaries.js: the summaries published as Discussions on the
// home repo. It exports its brief prefix for history.js, so github.js
// re-exports it by name; no piece imports github.js.

// ── The summaries ──────────────────────────────────────────────────────────

import { graphql } from './wire.js';

// The card is SUMMARIES, and the board is shared: the 9am job publishes its
// digest there too, as a Discussion titled `brief: <date>` (the prefix
// `jobs/cc-news.js` reads its cursor back by), roughly one a day beside each
// summary. GraphQL has no title filter, so the read asks for a wider window and
// the prefix is dropped here - a card of five summaries, not five posts.
export const BRIEF_TITLE_PREFIX = 'brief: ';
const SUMMARY_WINDOW = 20;
const SUMMARY_LIMIT = 5;

/** The latest Discussions on the home repo - where the daily summaries are published. */
export const buildDiscussionsQuery = (slug, first = SUMMARY_LIMIT) => {
  const [owner, name] = slug.split('/');
  return `query {
  repository(owner: "${owner}", name: "${name}") {
    discussions(first: ${first}, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes { title url createdAt category { name } }
    }
  }
}
`;
};

/** The discussion nodes, flattened to what a list draws. */
export const normalizeDiscussions = (data) => ((((data || {}).repository || {}).discussions || {}).nodes || [])
  .filter(Boolean)
  .map((node) => ({
    title: node.title || '',
    url: node.url || '',
    createdAt: node.createdAt || null,
    category: (node.category && node.category.name) || null,
  }));

/**
 * The published summaries, or an empty list with the reason it is empty.
 *
 * A site whose home repo is not in the slug list has nowhere to read them from,
 * which is a fact about the publish rather than a failure of this read.
 *
 * The morning briefs sharing the board are not summaries and do not appear.
 *
 * @param {string} home - the home repo slug, or ''
 * @param {object} ctx
 * @returns {Promise<{ok: boolean, reason: string|null, items: object[]}>}
 */
export const fetchSummaries = async (home, ctx = {}) => {
  if (!home) return { ok: false, reason: 'this site was published without a home repo, so it has no summaries to read', items: [] };
  const answer = await graphql(buildDiscussionsQuery(home, SUMMARY_WINDOW), ctx);
  if (!answer.ok) return { ok: false, reason: answer.reason, items: [] };
  const items = normalizeDiscussions(answer.data)
    .filter((item) => !item.title.startsWith(BRIEF_TITLE_PREFIX))
    .slice(0, SUMMARY_LIMIT);
  return { ok: true, reason: null, items };
};
