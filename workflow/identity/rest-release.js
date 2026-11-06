// workflow/identity/rest-release.js: the REST form of `release view`, served by
// rest.js in a cloud session; `release create` is refused there before any call,
// since the session's proxy refuses every release write.
// Usage: const RELEASE_VERBS = require('./rest-release'); (a table in rest.js's VERBS shape)

const {
  getJson, parse, repoOf, fieldsOf, pick, printJson, enc, GhFailure, UsageError,
} = require('./rest');

const NO_CREATE = 'gh: a cloud session cannot create a release (the proxy refuses release writes); the next ship on a machine cuts it';

// gh's release `--json` fields the shim serves, each from REST's release.
const RELEASE_FIELDS = {
  body: (r) => r.body || '',
  createdAt: (r) => r.created_at,
  isDraft: (r) => Boolean(r.draft),
  isPrerelease: (r) => Boolean(r.prerelease),
  name: (r) => r.name || '',
  publishedAt: (r) => r.published_at,
  tagName: (r) => r.tag_name,
  targetCommitish: (r) => r.target_commitish,
  url: (r) => r.html_url,
};

/**
 * A `--jq` value as gh prints it: a string raw, null as nothing, any other scalar as JSON.
 * @param {*} value
 * @returns {string}
 */
const jqText = (value) => {
  if (typeof value === 'string') return value;
  return value === null ? '' : JSON.stringify(value);
};

/**
 * The tag's release, the latest when no tag is named; a 404 is gh's `release not found`.
 * @returns {object} REST's release
 */
const releaseOf = (ctx, tag) => {
  try {
    return getJson(ctx, `repos/${ctx.repo}/releases/${tag === undefined ? 'latest' : `tags/${enc(tag)}`}`);
  } catch (err) {
    if (err instanceof GhFailure && /\(HTTP 404\)/.test(err.result.stderr)) throw new UsageError('release not found');
    throw err;
  }
};

/**
 * `release view [<tag>]`: its `--json` fields, one `.field` of them through `--jq`,
 * or gh's plain header lines, `--`, then the body.
 * @returns {number}
 */
const releaseView = (ctx, argv) => {
  const { flags, args } = parse(argv, [['json', null, 'value'], ['jq', 'q', 'value']]);
  repoOf(ctx);
  if (args.length > 1) throw new UsageError('gh: release view takes at most one tag');
  const fields = flags.json !== undefined ? fieldsOf(flags.json, RELEASE_FIELDS) : null;
  let jqField = null;
  if (flags.jq !== undefined) {
    if (!fields) throw new UsageError('gh: cannot use `--jq` without specifying `--json`');
    jqField = (flags.jq.match(/^\.([A-Za-z]+)$/) || [])[1];
    if (!jqField || !fields.includes(jqField)) {
      throw new UsageError(`gh: the --jq expression ${flags.jq} is not served in a cloud session; served: one .field path naming a --json field`);
    }
  }
  const r = releaseOf(ctx, args[0]);
  if (jqField) process.stdout.write(`${jqText(RELEASE_FIELDS[jqField](r))}\n`);
  else if (fields) printJson(pick(r, fields, RELEASE_FIELDS, ctx));
  else {
    process.stdout.write([`title:\t${r.name || ''}`, `tag:\t${r.tag_name}`, `draft:\t${Boolean(r.draft)}`,
      `prerelease:\t${Boolean(r.prerelease)}`, `published:\t${r.published_at || ''}`, `url:\t${r.html_url}`,
      '--', `${r.body || ''}\n`].join('\n'));
  }
  return 0;
};

/**
 * `release create`: refused before any call, whatever its flags.
 * @returns {number}
 */
const releaseCreate = () => {
  throw new UsageError(NO_CREATE);
};

module.exports = {
  'release view': releaseView,
  'release create': releaseCreate,
};
