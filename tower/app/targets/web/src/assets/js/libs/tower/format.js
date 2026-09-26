//
// The vocabulary every tower page shares: escaping, the status pipeline, and
// the handful of markup shapes that repeat. Not a page - nothing here fetches
// or draws on its own, so escaping and filtering are written once and mean the
// same thing on every surface.
//
// The SECTIONS live beside this file in format/, one module each: the values,
// the status pipeline and its priorities, the glyphs and chips, the model and
// crew badges, and the shapes that repeat. This file keeps the one door and
// re-exports every piece's public names, so a caller imports the whole
// vocabulary from here.
//

export * from './format/values.js';
export * from './format/status.js';
export * from './format/chips.js';
export * from './format/badges.js';
export * from './format/shapes.js';
