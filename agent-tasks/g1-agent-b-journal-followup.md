# Agent B: Complete-File Journal Integrity Admission

Current assignment: [Wave-02 complete package](wave-02/agent-b.zh-CN.md). This file is its B1 regression checklist. After these fixes, continue actual Runner service, Catalog/policy preparation and first Driver; do not stop at the old request to propose later work.

Date: 2026-11-08. Continue `codex/g1-runtime`. Latest reviewed candidate: **`74a3068`**. Independent Node 24.22.2 results: **148/148**, strict runtime typecheck, original four plus follow-up three admission probes all pass. I/O poisoning, replay ACK and sequence fixes are verified. Main integrates only your byte-identical ProcessHost observation file. Journal remains unmerged because three previously requested step-3 boundaries still fail.

Keep original Runner/DriverKit/execution/testing/docs ownership. Main owns coordinator composition and the new local recovery helper; A owns storage schemas. Fetch the updated `origin/main` after this packet lands. Do not change contracts, root dependencies/lock or weaken review probes.

## Reproduce

```sh
node tools/bootstrap/review-journal.mjs --runtime /absolute/clean/checkout
node tools/bootstrap/review-journal-followup.mjs --runtime /absolute/clean/checkout
node tools/bootstrap/review-journal-integrity.mjs --runtime /absolute/clean/checkout
```

The first two pass 4 + 3 cases on `74a3068`. The third fails all three cases; evidence is `reports/releases/g1-journal-integrity.json`.

## Current Remaining Work

1. **Record terminator.** Changing the required final newline to `x` still accepts the record with `corruptAt=null/readOnly=false`. A full wrong terminator is corruption, not a torn tail; preserve damaged evidence and refuse append/replay.
2. **Strict envelope/schema validation.** A valid checksum around `{ seq:1, fact:{}, payload:... }` is accepted. Validate the entry/timestamp, frozen CriticalFact, strict kind/value payload and matching identity before accessing IDs. Invalid envelopes must yield bounded corruption, not admission or an uncontrolled TypeError. Preserve record/file bounds and exact duplicate semantics; correct loose fixtures rather than relaxing contracts.
3. **Whole-file integrity before replay.** One intact frame followed by a corrupt frame opens read-only correctly, but `entries()` hides that and `replayJournal` applies fact-1 and reports success. Refuse before the first sink call unless the entire bounded snapshot is verified. Audit-only prefix salvage must be explicit and cannot enter ordinary replay. Recheck externally changed files and poisoned handles; stale flags are insufficient. Preserve strict ACKs, original IDs/refs and stop-on-persistence-failure. No native business commands in recovery.

Read `docs/adr/core/g1-registered-recovery-handoff.md`: main now has persisted registration, pre-wire cancel intent, physical recovery and the existing durable queue adapter (56 tests, six SIGKILL windows). Actual AttemptRunner backend/daemon remains a later owner integration task. Keep all 148 tests plus seven prior probes, add the three integrity regressions and related poisoned/external-corruption cases, and make all three review scripts pass. Continue the same ownership/branch; no root lock or private schema changes.

## Previous Fixes (Verified)

1. **Poison writer after uncertain I/O.** The probe writes 20 bytes then injects EIO. append throws, but the next append reports success; reopening recovers none of the second fact (`corruptAt=0`). On any append write/fsync failure, permanently refuse further append for this handle until explicit reopen/recovery establishes a valid prefix. Do not silently truncate a possibly persisted record, reset counters, retry native effects, or overwrite evidence. Also test fsync failure after a full write and capacity/sequence accounting after reopen.
2. **Validate replay ACKs.** `AttemptRunner.record` now validates DurableReceipt, but `replayJournal` discards the sink's return and increments `replayed` for `persisted:false`. Apply the same frozen schema/same-fact validation on every recovery ACK. Invalid/refused receipts must never count as replayed; unexpected persistence failure must stop advancing the batch. Keep original IDs/payload refs, and do not issue begin/deliver/answer. Authoritative stale-business refusal and old physical retention stay ingress-owned.
3. **Validate sequence/record structure.** The decoder accepts frames with sequences `[1,3]` as intact/read-write. Require the journal's contiguous monotonic sequence (and define exact duplicate semantics), actual terminators and valid record envelopes before claiming integrity. Reject gaps/backward/duplicate sequence conflicts and malformed fact/payload without uncontrolled allocation or accidental promotion to repairable tail. `entries()/replayJournal` must not hide integrity failures by returning a successful prefix. Give the coordinator decoder an explicit integrity result; never label an unchecked/gapped prefix a verified recovery snapshot.

The additional ProcessHost observation review is fixed in `74a3068` and its byte-identical file is integrated by main. Preserve the new fail-closed inventory behavior and unsupported descendant/platform limits.

## Next Integration Boundary

Main added `RecoveryRunnerPort` and local query/cancel transport in `apps/coordinator/runner-link.ts`, tested against an independent fixture service plus actual ProcessHost. Read `docs/adr/core/g1-runner-link-handoff.md`. This does not duplicate a production daemon in your owned Runner directory.

After Journal fixes pass, propose the actual AttemptRunner backend: one private endpoint per attempt, no business routes on recovery, irreversible closed admission, complete owned-resource inventory, and fresh physical evidence. Durable launcher/endpoint registration is an A/main storage RFC; do not introduce private tables or launch on reconnect.

## Handoff

- Preserve existing 136 tests and all old admission cases, add the new I/O/replay/sequence/observability regressions, run strict runtime typecheck.
- Commit/push only owned paths to user `origin/codex/g1-runtime`.
- Supply exact commit/base, commands/results/evidence and remaining limits. No power-loss, vendor, full G1 or product-ready claim.
