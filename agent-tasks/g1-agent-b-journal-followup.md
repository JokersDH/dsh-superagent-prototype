# Agent B: Journal I/O, Replay And Sequence Admission

Date: 2026-11-08. Continue `codex/g1-runtime`. Reviewed candidate: `32540a3`. Existing runtime suites **136/136** and strict runtime typecheck pass in a clean checkout on Node 24.21.0. The original four admission failures are fixed. Journal is still **not admitted/merged** because the three new cases below fail.

Keep original Runner/DriverKit/execution/testing/docs ownership. Main owns coordinator composition and the new local recovery helper; A owns storage schemas. Fetch the updated `origin/main` after this packet lands. Do not change contracts, root dependencies/lock or weaken review probes.

## Reproduce

```sh
node tools/bootstrap/review-journal.mjs --runtime /absolute/clean/checkout
node tools/bootstrap/review-journal-followup.mjs --runtime /absolute/clean/checkout
```

The first passes 4/4 against `32540a3`. The follow-up fails 3/3; evidence is `reports/releases/g1-journal-followup.json`.

## Required Fixes

1. **Poison writer after uncertain I/O.** The probe writes 20 bytes then injects EIO. append throws, but the next append reports success; reopening recovers none of the second fact (`corruptAt=0`). On any append write/fsync failure, permanently refuse further append for this handle until explicit reopen/recovery establishes a valid prefix. Do not silently truncate a possibly persisted record, reset counters, retry native effects, or overwrite evidence. Also test fsync failure after a full write and capacity/sequence accounting after reopen.
2. **Validate replay ACKs.** `AttemptRunner.record` now validates DurableReceipt, but `replayJournal` discards the sink's return and increments `replayed` for `persisted:false`. Apply the same frozen schema/same-fact validation on every recovery ACK. Invalid/refused receipts must never count as replayed; unexpected persistence failure must stop advancing the batch. Keep original IDs/payload refs, and do not issue begin/deliver/answer. Authoritative stale-business refusal and old physical retention stay ingress-owned.
3. **Validate sequence/record structure.** The decoder accepts frames with sequences `[1,3]` as intact/read-write. Require the journal's contiguous monotonic sequence (and define exact duplicate semantics), actual terminators and valid record envelopes before claiming integrity. Reject gaps/backward/duplicate sequence conflicts and malformed fact/payload without uncontrolled allocation or accidental promotion to repairable tail. `entries()/replayJournal` must not hide integrity failures by returning a successful prefix. Give the coordinator decoder an explicit integrity result; never label an unchecked/gapped prefix a verified recovery snapshot.

Additional runtime review before full resource-barrier admission: `ProcessHost.#observeGroup` currently treats `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` as an empty group. Output overflow/parse/observation failures must be indeterminate; only positively observed absence can prove quiescence. Preserve refusal to signal unproven/reused identities. Record targeted evidence and unsupported descendant/platform limits.

## Next Integration Boundary

Main added `RecoveryRunnerPort` and local query/cancel transport in `apps/coordinator/runner-link.ts`, tested against an independent fixture service plus actual ProcessHost. Read `docs/adr/core/g1-runner-link-handoff.md`. This does not duplicate a production daemon in your owned Runner directory.

After Journal fixes pass, propose the actual AttemptRunner backend: one private endpoint per attempt, no business routes on recovery, irreversible closed admission, complete owned-resource inventory, and fresh physical evidence. Durable launcher/endpoint registration is an A/main storage RFC; do not introduce private tables or launch on reconnect.

## Handoff

- Preserve existing 136 tests and all old admission cases, add the new I/O/replay/sequence/observability regressions, run strict runtime typecheck.
- Commit/push only owned paths to user `origin/codex/g1-runtime`.
- Supply exact commit/base, commands/results/evidence and remaining limits. No power-loss, vendor, full G1 or product-ready claim.
