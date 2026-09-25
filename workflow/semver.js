//
// workflow/semver.js: the kit's one version comparison, in semver's order, and
// the shape check beside it.
//
// Three callers read versions and none owns the rule: the ship's
// publish plan (`publish-plan.js`, the shape of each package version), its
// release commit (`release.js`, the shape of the new version) and the
// morning brief's upstream news (`jobs/cc-news.js`, Claude Code's releases).
//
// The numbers compare first, as many as either side carries, a missing part
// reading as 0 so a two-part dotted number still compares. Then a version with
// a prerelease sorts below the same numbers without one, and two prereleases
// order by semver's rules: identifier by identifier, numbers numerically and
// below words, words in ASCII order, a longer set above its own prefix. Build
// metadata carries no order. It requires nothing, so this folder stays
// self-contained.
//
// Usage:
//   const { compareVersions, isSemver } = require('./semver');
//

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const VERSION_RE = /^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Is this a semver version: three numbers, an optional prerelease and build?
 * @param {string} version
 * @returns {boolean}
 */
const isSemver = (version) => SEMVER_RE.test(String(version));

/** The numbers and the prerelease identifiers of a version, or a loud error. */
const parse = (version) => {
  const m = VERSION_RE.exec(String(version));
  if (!m) throw new Error(`semver: ${version} is not a version.`);
  return { numbers: m[1].split('.').map(Number), pre: m[2] ? m[2].split('.') : [] };
};

/** Two prerelease identifiers in semver's order. */
const compareIdentifiers = (a, b) => {
  const numA = /^\d+$/.test(a);
  const numB = /^\d+$/.test(b);
  if (numA && numB) return Math.sign(Number(a) - Number(b));
  if (numA !== numB) return numA ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

/**
 * Compare two versions in semver order.
 * @param {string} a - a version
 * @param {string} b - a version
 * @returns {number} -1, 0 or 1
 * @throws {Error} when either side is no version at all
 */
const compareVersions = (a, b) => {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.numbers.length, pb.numbers.length); i++) {
    const diff = Math.sign((pa.numbers[i] || 0) - (pb.numbers[i] || 0));
    if (diff !== 0) return diff;
  }
  if (pa.pre.length === 0 || pb.pre.length === 0) {
    return Math.sign(pb.pre.length - pa.pre.length);
  }
  for (let i = 0; i < Math.min(pa.pre.length, pb.pre.length); i++) {
    const diff = compareIdentifiers(pa.pre[i], pb.pre[i]);
    if (diff !== 0) return diff;
  }
  return Math.sign(pa.pre.length - pb.pre.length);
};

module.exports = { compareVersions, isSemver };
