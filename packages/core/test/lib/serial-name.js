// The name of a suite that runs alone, read by the runner (lib/pick.js) and
// safety:test-bar (hooks/mods/test-bar.js). It stands alone, importing nothing,
// since a hooks module file may import no Node built-in. The door does not
// re-export it.

// A suite that runs alone, after the parallel wave.
export const SERIAL_NAME = /\.serial\.test\.[cm]?js$/;
