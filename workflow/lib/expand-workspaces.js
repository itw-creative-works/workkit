/**
 * workflow/lib/expand-workspaces.js: the expansion of a root package.json's
 * `workspaces` that the publish plan (ship/plan.js), the members a record leaves
 * out (lib/workspaces.js) and workkit-core's runner share, its prepack copying
 * it in as `expand-workspaces.cjs`; `patternShape`, what a pattern means, is
 * also safety:release-taken's (hooks/mods/release-taken.js). CJS, requiring
 * nothing beyond Node.
 */

const fs = require('fs');
const path = require('path');

const GLOB_RE = /[*?[]/;

/** A refusal: the plan cannot be made, and the message says why. */
class PlanError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlanError';
  }
}

/**
 * The patterns a root package.json's `workspaces` field declares.
 * @param {*} workspaces the field's value
 * @returns {string[]} the array, or `{ packages }`'s array; [] for any other shape
 */
const workspacePatterns = (workspaces) => {
  if (Array.isArray(workspaces)) return workspaces;
  if (workspaces && Array.isArray(workspaces.packages)) return workspaces.packages;
  return [];
};

/**
 * What one workspace pattern means: the children of a folder (`dir/*`, its
 * `dir` holding no glob character), one folder (no glob character at all), or
 * any other shape, which no reader expands.
 * @param {string} pattern one pattern as declared
 * @returns {{shape: 'children', dir: string} | {shape: 'folder', dir: string} | {shape: 'other'}}
 */
const patternShape = (pattern) => {
  if (pattern.endsWith('/*') && !GLOB_RE.test(pattern.slice(0, -2))) return { shape: 'children', dir: pattern.slice(0, -2) };
  if (!GLOB_RE.test(pattern)) return { shape: 'folder', dir: pattern };
  return { shape: 'other' };
};

/**
 * The workspace member directories a root declares, expanded by patternShape:
 * a literal directory and `dir/*`, refusing every other shape and a literal
 * member with no package.json. A `dir/*` that matches nothing is a note, never
 * a silence: the same line the `safety:release-taken` hook prints.
 * @param {string} root the repo root
 * @param {*} workspaces the root package.json's `workspaces` value
 * @param {string[]} notes the list each note is pushed onto
 * @returns {string[]} absolute member directories, in pattern then folder order
 * @throws {PlanError} a pattern this reader does not expand, or a literal member with no package.json
 */
const expandWorkspaces = (root, workspaces, notes) => {
  const dirs = new Set();
  for (const pattern of workspacePatterns(workspaces)) {
    const { shape, dir: named } = patternShape(pattern);
    if (shape === 'children') {
      const parent = path.join(root, named);
      const entries = fs.existsSync(parent) ? fs.readdirSync(parent, { withFileTypes: true }) : [];
      let matched = 0;
      for (const entry of entries) {
        const dir = path.join(parent, entry.name);
        if (entry.isDirectory() && fs.existsSync(path.join(dir, 'package.json'))) {
          dirs.add(dir);
          matched += 1;
        }
      }
      if (matched === 0) notes.push(`publish-plan: the workspace pattern ${pattern} matched no package, so nothing under it was planned.`);
    } else if (shape === 'other') {
      throw new PlanError(`publish-plan: the workspace pattern ${pattern} is not one this plan expands (a directory, or dir/*), so no plan was made.`);
    } else {
      const dir = path.join(root, named);
      if (!fs.existsSync(path.join(dir, 'package.json'))) {
        throw new PlanError(`publish-plan: the workspace member ${pattern} holds no package.json, so no plan was made.`);
      }
      dirs.add(dir);
    }
  }
  return [...dirs];
};

module.exports = {
  expandWorkspaces, PlanError, patternShape, workspacePatterns,
};
