// A folder built once per process for each shape a caller asks for, on first
// use, and copied whole into a case's own folder: a case that writes into its
// copy writes alone, and no case is handed the seed. mkTmp removes every seed
// when the process exits.

import fs from 'node:fs';
import { mkTmp } from './scratch.js';

/**
 * @param {function(string, *): void} build - fills the empty seed folder, given
 *   it and the shape it is for
 * @returns {function(string, *=): void} the copier: `(dir, shape)` copies that
 *   shape's seed into `dir`, made if missing and merged into if not
 */
export const seeded = (build) => {
  const seeds = new Map();
  return (dir, shape = null) => {
    const key = JSON.stringify(shape);
    if (!seeds.has(key)) {
      const seed = mkTmp('workkit-seed-');
      build(seed, shape);
      seeds.set(key, seed);
    }
    // A relative link in a seed copies as the link it is, the way cp -R copies it.
    fs.cpSync(seeds.get(key), dir, { recursive: true, verbatimSymlinks: true });
  };
};
