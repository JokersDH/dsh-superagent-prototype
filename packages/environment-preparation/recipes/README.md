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

## Rebuild and local cache

- Source identities: `env-dep@1.0.0` and `env-dev-dep@1.0.0`, both generated from `sources/*`);
  the generated `package.json`, `pnpm-lock.yaml` and `vendor/*.tgz` are the rebuild inputs.
- `plain-js` has one runtime dependency and runs `node --test smoke.test.cjs`.
- `dev-deps` has runtime + dev dependencies, runs `node build.mjs` and then `node --test`; its test
  resolves both packages.
- Local cache: `build-recipes.mjs` creates an offline store with `pnpm install --offline
  --ignore-scripts --store-dir <out>/store` inside the temporary output. The preparation package then
  runs `pnpm install --offline --frozen-lockfile --ignore-scripts --store-dir <out>/store`; all bytes
  come from local tarballs/store, and no registry or network request is made.
- To inspect manually: `node packages/environment-preparation/examples/prepare-consumer.mjs
  --project <recipe> --workspace <copy> --authority <private-dir> --store <out>/store --out <ref.json>`
  then `node examples/verify-consumer.mjs --ref <ref.json> [--cleanup]`.
- Package manager: pnpm 11.7.0 via Corepack cache on Node 24.21.0; the script records the actual
  version in its JSON output. Do not commit generated tarballs/store/node_modules.
