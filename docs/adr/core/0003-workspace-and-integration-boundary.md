# ADR 0003: G1 Workspace And Integration Boundary

Root workspace now contains the known contracts and core packages and reserves globs for later packages, nested Drivers and apps. The root remains the original DSH prototype package; its scripts/dependencies/peers are preserved. `tools/reuse-spike/` is not a workspace member.

The main agent owns workspace configuration and the shared root lock. Product sibling dependencies use `workspace:*` and public package exports. A/B can add manifests in their owned modules and request lock integration; they must not rewrite the root lock or add replacement type models. Build contracts before its consumers. Historical G0 local locks remain evidence; isolated reproduction uses `--ignore-workspace` to avoid ancestor discovery.

While a feature introduces an owned package that is not yet in main's lock, a local `pnpm install --no-frozen-lockfile` may generate a temporary root lock diff. Leave it out of the feature commit and report the manifest/version request. The main agent regenerates the authoritative root lock during integration. Never hand-edit it or revert unrelated user changes. This is a narrow generated-output exception to path ownership, not shared commit ownership.

`pnpm check:g1-core` checks only contracts/core and writes `reports/releases/g1-core.json`. It must never mark overall G1 passed. Real G1 acceptance additionally needs storage effects/receipts in one connection, Supervisor's atomic attempt/epoch fence, real subprocess behavior, stop/retry barriers and crash recovery. Those tests will use accepted WP-02/WP-03 module interfaces when their commits arrive.

The CI template installs only contracts/core and runs their checks plus static spec verification. It is not activated: GitHub rejected the workflow push because the current OAuth credential lacks workflow scope. The template remains at `tools/bootstrap/templates/core-contracts.workflow.yml`; no credential/scope was changed. It is not a native agent job or platform binding certification. The separate original root `pnpm check` still covers the upstream plugin and is run after workspace adoption to detect regressions.
