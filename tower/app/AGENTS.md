@node_modules/@omega.js/AGENTS.md

# Tower - brand notes

The brand has ONE authored source: `assets/logo/brandmark.svg` (the wireframe W: five nodes joined by struts, one brand fill, square, no text).

- The assets service mints every variant from it (PNG ladders, favicons, the black derivation, the social PNG) into the gitignored `.omega/assets`, and the web build bridges them to `/assets/images/brand/`.
- The config keys live in `config/omega.json5`: `brand.color` is the one hex the theme ramps compose from, `brand.images.brandmark`/`.social` point at the bridged paths.
- The svg's fill and `brand.color` are two copies of one hex: change both together.
