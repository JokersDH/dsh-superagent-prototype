# G0 Bootstrap Templates

These templates prepare the repository for Scheme B without changing the original DSH plugin's runtime or root dependency graph.

```sh
node tools/bootstrap/validate.mjs
```

The validator merges the script proposal in memory, verifies original plugin metadata/peers/scripts are preserved, and asks the pinned pnpm to discover three disposable fixture packages in a temporary workspace. It does not install packages, change this repository, or prove product runtime compatibility.

Root workspace is now active for `packages/*`, nested `packages/drivers/*`, and `apps/*`, with a shared root lock maintained by the main agent. G0 experiments are excluded. Product sibling dependencies use `workspace:*`; build/check contracts before core with `pnpm check:g1-core`. The contracts package's old local lock remains G0 standalone evidence, not the live G1 lock. Reproduce isolated G0 packages using explicit `--ignore-workspace` where needed so pnpm does not select the ancestor workspace.

`root-scripts.json` is an additive proposal; do not replace the original root package.json or remove the DSH metadata/peers. `tsconfig.package.json` supplies strict settings for new modules. Each module chooses its actual emit/output configuration.

`release-candidate.json` contains proposed versions and NOT_TESTED platform statuses. Agent B's measured identity and native-load/SQLite evidence, Agent A's isolated extraction, and the contracts gate report must be reviewed before any release admission. macOS x64 remains NOT_TESTED unless it is actually run.

The workspace proposal includes the explicit prebuilt-only build policy for better-sqlite3 13.0.3. Revalidate it on every binding upgrade. The final G0 decision is separate from the deliberately unapproved release template; passing G0 allows G1 development, not a product release.

Independent reviewers use `review-core.mjs <checkout-root>` after installing/running the extraction, and `review-platform.mjs <checkout-root>` after running the platform probes. Add `--record` to capture digests in this directory's `reports/`. These inspect existing evidence; they do not run native model jobs or substitute for the commands listed in the acceptance reports.

`templates/core-contracts.workflow.yml` is a prepared GitHub Actions template, not an active workflow. GitHub rejected activation because the current OAuth credential has no workflow scope. Local verification remains usable through `pnpm check:g1-core`; no account scope or repository setting was changed.
