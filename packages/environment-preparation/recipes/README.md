# Offline recipes

Two single-package pnpm recipes rebuilt entirely from local tarballs and an offline store (no
registry/network access):

- `plain-js`: one runtime dependency and a real `node --test`.
- `dev-deps`: runtime + dev dependency, a `build` script and tests using both.

```sh
node packages/environment-preparation/recipes/build-recipes.mjs --out /tmp/pa-env-recipes
```

The script writes `sources/`, two recipe roots, a shared `store/` and removes each
`node_modules`; the preparation module performs the frozen/offline/ignore-scripts install. The
script needs pnpm already available (Corepack cache allowed, network disabled). `store/` and
`node_modules` are intentionally not committed.
