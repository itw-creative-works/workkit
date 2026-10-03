// The Board's card motion, as arithmetic: given where every card sat before a
// repaint and where it sits after, which cards slide and by how much, which
// fade in and which fade out. Pure Map work; the page measures and plays.

/**
 * The motion one repaint asks for.
 *
 * A card in both maps at a different spot slides, starting `dx`/`dy` away
 * (old minus new) and easing to zero; one at the same spot stays still.
 *
 * @param {Map<string, {x: number, y: number}>} before - `data-issue` to its spot before the repaint
 * @param {Map<string, {x: number, y: number}>} after - `data-issue` to its spot after it
 * @returns {{moved: {key: string, dx: number, dy: number}[], entered: string[], left: string[]}}
 */
export const motionPlan = (before, after) => {
  const moved = [];
  const entered = [];
  for (const [key, spot] of after) {
    const old = before.get(key);
    if (!old) {
      entered.push(key);
      continue;
    }
    const dx = old.x - spot.x;
    const dy = old.y - spot.y;
    if (dx || dy) moved.push({ key, dx, dy });
  }
  const left = [...before.keys()].filter((key) => !after.has(key));
  return { moved, entered, left };
};
