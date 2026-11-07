# G0 Bootstrap Templates

These templates prepare the repository for Scheme B without changing the original DSH plugin's runtime or root dependency graph.

```sh
node tools/bootstrap/validate.mjs
```

The validator merges the script proposal in memory, verifies original plugin metadata/peers/scripts are preserved, and asks the pinned pnpm to discover three disposable fixture packages in a temporary workspace. It does not install packages, change this repository, or prove product runtime compatibility.

`templates/pnpm-workspace.yaml` activates root `packages/*`, nested `packages/drivers/*`, and `apps/*`. G0 experiments are deliberately excluded. The main agent adopts this file only when integrating the G1 workspace and deciding how standalone experiment/package locks transition into the root lock. For now, the contracts package has its own lock and works with `pnpm install --ignore-workspace` inside `packages/contracts`.

`root-scripts.json` is an additive proposal; do not replace the original root package.json or remove the DSH metadata/peers. `tsconfig.package.json` supplies strict settings for new modules. Each module chooses its actual emit/output configuration.

`release-candidate.json` contains proposed versions and NOT_TESTED platform statuses. Agent B's measured identity and native-load/SQLite evidence, Agent A's isolated extraction, and the contracts gate report must be reviewed before any release admission. macOS x64 remains NOT_TESTED unless it is actually run.

The workspace proposal includes the explicit prebuilt-only build policy for better-sqlite3 13.0.3. Revalidate it on every binding upgrade. The final G0 decision is separate from the deliberately unapproved release template; passing G0 allows G1 development, not a product release.

Independent reviewers use `review-core.mjs <checkout-root>` after installing/running the extraction, and `review-platform.mjs <checkout-root>` after running the platform probes. Add `--record` to capture digests in this directory's `reports/`. These inspect existing evidence; they do not run native model jobs or substitute for the commands listed in the acceptance reports.
