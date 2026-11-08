# Controlled Product Integration Checkpoint

Date: 2026-11-08. Owner: main agent. Base: `cd09395`. Branch: `codex/g2-execution-integration`.

## Admitted Backend

Agent A's committed `packages/workspaces/`, `packages/verification/` and WP-04 RFCs from `8f1e60a10b259b3b6b95ec681161ed335e863f42` were imported byte-for-byte in integration commit `7fa2bb0`. Independent target-Node validation passed 8 workspace cases, 22 verification cases, six prior WP-04 probes and the two current-runtime/provenance probes. The v7 migration assertion fix from `473d0ba` is present. Agent A's active checkout was not edited.

Console fixture tests also passed in the detached review snapshot, but the console is not included in this backend import. Its HTTP defaults still require the controlled profile/check configuration described below. Agent B's independent Runner, Journal, Catalog/policy and Codex protocol candidates remain separately reviewed work; the controlled product lane uses the already admitted ControlledRunnerHost and ProcessHost.

## Main Integration

Implementation and launch instructions: [Controlled Product API](../../../apps/coordinator/product/README.md).

The real path is now:

```text
authenticated UserCommand
  -> ApplicationService/core -> committed application.execute intent
  -> fixed policy + detached scratch workspace + stable start checkpoint
  -> per-attempt ControlledRunnerHost -> real scratch subprocess
  -> authoritative fact/receipt transaction -> QuestionBroker/core input ACKs
  -> original structured answer -> physical-write fact -> native consumption fact
  -> closed complete owned-resource inventory -> trusted barrier
  -> core ready candidate -> committed verification intent
  -> WP-04 freeze + registered check + immutable output/evidence bytes
  -> current-candidate acceptance -> core confirmCompletion -> delivered
```

The optional stored-ingress business reducer runs inside the authoritative fact transaction, before receipt commit. Existing composition behavior is unchanged when no reducer is supplied. All native/file I/O occurs outside command transactions. The Application completion port now permits an optional asynchronous artifact preflight, followed by a synchronous freshness guard inside its transaction. Existing module fixtures need no preflight implementation.

No business wire schema, migration, Work lifecycle or vendor-specific core branch was introduced. The durable queue and existing command receipts index launch, command and review projections. Verification/quiescence/acceptance authority remains WP-04 evidence plus the core gate.

## A/B Consumption

- **A:** Continue the assigned browser/product integration package. Use `/v1` at the controlled entry, `project-atlas`, the four explicit `profile-fixture-*` profiles, exact `src/` scratch scope, and `check-fixture-output`. Keep fixture tests separate from actual HTTP/browser evidence. The generic WP-04 patch currently omits untracked contents; fix that in the owned workspace package before claiming general patch delivery. The controlled composition already publishes its fixed output bytes and does not depend on that generalization.
- **B:** Continue the assigned independent Runner/recovery and native package. Preserve this command/producer/ACK contract when replacing the controlled host; do not treat queued feed as a write receipt or stdio service separation as authenticated reconnect. The durable start checkpoint, original binding, business admission checks and host-derived complete resource barrier are mandatory. Installed Codex/ZCode/DeepSeek Harness need independent compatibility evidence.
- **Main:** Consume their accepted committed packages and keep one application/fact/effect path. Full browser and independent-Runner product gates remain open. No user redispatch is required for the already assigned packages.

## Acceptance

`pnpm check:g2-product` is the reproducible main check. It builds dependencies and validates the prior 90 cases, WP-04 30 cases and 14 new product integration cases. `node tools/bootstrap/smoke-product-api.mjs` drives a separately running server over actual authenticated loopback HTTP.

The controlled SIGKILL test keeps an old unproven writer held and proves no second begin. A committed verification intent can recover after a failed evidence commit when its original writer already has a trusted barrier. These are distinct from independent Runner survival/reconnect, which remains unclaimed.
