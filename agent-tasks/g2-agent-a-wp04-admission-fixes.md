# Agent A: Current Runtime Authority And Host Proof Provenance

Current assignment: [Wave-02 complete package](wave-02/agent-a.zh-CN.md). This file is its A1 regression checklist. After these fixes, continue product repositories and console; do not stop for another small-task dispatch.

Date: 2026-11-08. Continue `codex/g2-workspaces-verification`, latest reviewed candidate **`fcf3273`**. Fetch/merge updated `origin/main` after this packet lands. Keep workspace/verification/storage ownership; do not change root contracts/lock/coordinator or weaken probes.

The prior six fixes now independently pass on Node 24.22.2. Clean suites: workspaces **8/8**, verification **19/19**, storage **66/66**. The main probe was adapted only to await the intentional async verifier and provide the required guard. **WP-04 is not admitted:** two production-core boundary probes still complete a Ticket incorrectly.

## Current Remaining Work

Run `node tools/bootstrap/review-completion-runtime.mjs --runtime /absolute/clean/checkout`. The report is `reports/releases/g2-completion-runtime-review.json`. It uses a genuine main-host barrier, actual ProductStore and personal core; it does not use the package's hand-built barrier helper.

1. **Current runtime pointer/epoch.** A valid barrier for attempt-1 remains accepted after attempt-2 in the same assignment/contract becomes current/active at epoch 2. `resolve` still succeeds and core ends the Ticket as completed. Both recording and resolution must check the current binding's full attempt/assignment/contract/epoch identity and ended state against the proved attempt. A historical ended binding or missing pointer is insufficient. Update fixtures to include actual pointer semantics; preserve candidate/artifact/criteria/human checks and old cleanup history.
2. **Committed host provenance.** `eventAt` discards topic, so a matching payload under an unrelated event authorizes completion. Require `runtime.barrier.confirmed`, full producer identity, scope, manifest, and the exact host writer fact named by that event. Main v2 events now include `barrierCommandId`, full `attempt`, `source`, and `writerFactId` (null for no resources). Read the matching committed command receipt and compare its result with the supplied barrier. Keep resolution synchronous/read-only; do not import coordinator source or duplicate its private ID algorithm. Older unreleased events need an explicit compatibility policy, not missing-field trust.

Read `docs/adr/core/g1-registered-recovery-handoff.md`. The returned barrier shape is unchanged; fresh repeated terminal proofs reuse the first receipt. Preserve all six fixes below, add current-epoch/event-provenance regressions, and run both independent probes. Also keep process cleanup claims precise: sending SIGKILL does not by itself prove a group absent. Push your same owned branch; main reviews/integrates.

## Reproduce

After building your dependencies and owned packages in a disposable clean checkout:

```sh
node tools/bootstrap/review-wp04.mjs --runtime /absolute/clean/checkout --commit YOUR_COMMIT
```

The deadline probe uses a disposable isolated process group and an external watchdog. Never try the hanging case directly in the production coordinator process.

## Previous Fixes (Verified)

1. **Deletion-aware freeze.** A tracked file deleted in an attempt is a legitimate deliverable. Current `ls-files` includes it and `lstat` throws ENOENT. Encode deleted state in the manifest and verify a real deletion patch without modifying the user's tree.
2. **Symlink and executable identity.** Hash symlink link text with `readlink`, not the target's contents; do not follow dangling/outside symlinks. The repro switches between two dirty, same-length, equal-content targets, so porcelain status is identical and cannot mask the bug. Include executable mode changes. Keep freeze manifests immutable/content-addressed; `digest()` must not overwrite the original audit manifest.
3. **Mandatory frozen-artifact guard.** The published main wiring recipe returns `manager.digest(...) === expected`, while `checkFrozen` ignores a false result and the hook is optional. Define one unambiguous fail-closed API: require the guard, accept explicit true only (or use a required throwing assertion with a corrected recipe). Validate before and after checks. Extend the main probe if the reviewed signature changes intentionally. Do not accept an omitted/false guard as a verified frozen artifact.
4. **Bounded isolated check execution.** `spawnSync` with timeout sends SIGTERM and waits indefinitely if the child ignores it. A 150ms check required our 1500ms external SIGKILL. Move checks out of the coordinator event loop; enforce TERM/KILL/group cleanup and a bounded indeterminate outcome if cleanup cannot be proved. Descendants/inherited pipes must not hold the coordinator indefinitely. Reuse the runtime process ownership port where feasible; do not create a competing general ProcessHost.
5. **Trusted complete resource evidence.** `recordQuiescence` currently accepts a caller-selected subset while another registered resource is active. It must match the exact registered manifest/full attempt+contract identity and consume authenticated terminal/closed complete-inventory barrier evidence. Ordinary writer observations are read models, not proof of irreversible business closure. Read `apps/coordinator/resource-barrier.ts` and `docs/adr/core/g1-runner-link-handoff.md`; request a storage/RFC interface for the host receipt, keeping core CandidateRef/artifact binding. Do not import coordinator implementation into a shared package or treat text evidence as trusted. A late resource/epoch/config change must invalidate prior completion evidence. `summary.resources[].last` can name an exit rather than the writer fact: preserve the actual proving fact references.
6. **Full-body record immutability.** Same acceptance ID currently compares only criterionIds; a different candidate/artifact/actor returns success. Compare the full canonical body for acceptance and quiescence, and strictly validate Verification on intake. Same-ID/same-body is idempotent, any body change conflicts. Resolve must check the complete contract identity for every returned record.

## Acceptance / Handoff

- Preserve existing tests and v1-v5 migration checksums. Add focused regression cases for these failures, stale contract/manifest proof, check group cleanup, and baseline-manifest preservation.
- Existing suite + updated independent probes must pass. Show a candidate cannot complete while any registered writer remains active or while the artifact changes.
- Report exact branch/commit/base, commands/results, source scopes, RFC/API changes and limitations. Do not claim full G1 or native compatibility.
- Commit only owned paths; push your branch to user `origin`. Root lock may have a temporary install diff but must not be committed. Main reviews/integrates.
