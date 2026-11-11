@node_modules/@omega.js/AGENTS.md

# Tower - brand notes

- The brand has ONE authored source: `assets/logo/brandmark.svg`.
  - It is the wireframe W: five nodes joined by struts, one brand fill, square, no text.
- The assets service mints every variant from it into the gitignored `.omega/assets`.
  - The variants: PNG ladders, favicons, the black derivation, the social PNG.
  - The web build bridges them to `/assets/images/brand/`.
- The config keys live in `config/omega.json5`.
  - `brand.color` is the one hex the theme ramps compose from.
  - `brand.images.brandmark`/`.social` point at the bridged paths.
- The svg's fill and `brand.color` are two copies of one hex: change both together.
