# Wave-24 Agent A handoff

Branch `codex/g2-workspaces-verification`; source checkpoint `921e290`, final status this commit.
Merged main `4b42a90`. Schema remains 18; no migration added.

## Complete original subject

`DataSubjectExpectation` is supplied independently by the trusted producer: source SHA/format/data
root, ticket/assignment/attempt/contract/epoch, question/answer, required command/dispatch/delivery
and observation sets, plus explicit limits.

`buildDataManifest` reads related indexes in one synchronous `uow.atomic`, then verifies:

- binding identity equals the expected attempt/ticket/assignment/contract/epoch;
- question targets belong to that attempt/ticket/assignment/contract/epoch;
- answer belongs to the question and is not newer than its version;
- required deliveries are real question targets and present;
- required commands/dispatch/observations exist, with no duplicates; observations belong to attempt;
- source is logically complete.

Two real Works in one Store are exercised: borrowing Work B's question/answer or ticket/assignment
into Work A is rejected. Deleting all commands, deleting one requirement, emptying dispatch, adding a
foreign command, adding a duplicate entry, changing payload digest, answer ID, data root, source SHA,
format or source fingerprint is rejected even with a recomputed manifest digest.

## UoW and bounded payload guard

Payload bytes are read outside the transaction. Before returning, the same binding/current/contract/
epoch/resources, question version/validity/targets, answer/delivery, command/dispatch, observation
IDs/payload digests and source fingerprint are rechecked. An injected Work insertion during payload
read rejects the manifest. No SQL transaction spans an await. Limits default to 64 commands, 64
dispatch, 256 observations, 128 unique payloads, 1 MiB/payload, 4 MiB total; each excess is rejected.

## Reader and two formats

A different Node PID reader consumes the manifest with the independent expectation and reads the same
attempt/ticket/assignment/contract/epoch/question/answer/delivery/observation/dispatch identities.
Repeated reads add no delivery/observation/queue rows. The same real Store data still creates and
restores default v1 and explicit v2 snapshots separately to fresh roots; personal readonly reads
Work/Q&A/native_applied/candidate/history/frozen body; business 422, held queue and provider unchanged.

## Evidence

| Check | Result |
| --- | --- |
| storage | 87/87 |
| workflows | 117/117 |
| application | 20/20 |
| verification | 23/23 |
| restored personal | 12/12 |
| recovery combination | 106/106 |
| main product/history/reply | 91/91 |
| main target | 50/50 |
| candidate consumers | 31/31 |
| product execution | 20/20 |
| genuine v1 producer | 2/2 |
| typecheck/build, coordinator strict | PASS |
| packet static check | PASS |
| model/native | 0 |

## Dependencies

- C owns the sole consumer driver; no admitted C driver run consumed A output in this checkout, so
  A6 is NOT_REACHED. A did not create a second driver.
- B has no admitted same-Runner business attach; A7 recovered-result landing is NOT_REACHED.
- D/E must bind exact package consumer bytes/hash/tar. Source tests do not certify installed packages.
- Private permission, physical writer proof and target activation remain main-owned. Twelve services,
  old state/tar/profile/ledger and shared reports were untouched.
