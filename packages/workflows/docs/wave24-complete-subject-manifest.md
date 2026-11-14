# Wave-24 A: complete original subject and independent expectations

A owns storage/workflows. The manifest is data integrity evidence only: no send, recovery grant,
ledger or physical-writer proof.

## Independent expected subject

`DataSubjectExpectation` is supplied by the trusted producer/caller, never inferred from the manifest:

- source SHA and workflow format 1|2; optional expected data root;
- ticket, assignment, attempt, fence epoch and exact contract revision/digest;
- question, answer, required command IDs, required dispatch `(commandId,target)` pairs and required
  delivery targets; optional required observation fact IDs;
- explicit limits: commands, dispatch, observations, unique payloads, per-payload bytes, total bytes.

`buildDataManifest(store, expectation)` first reads all related indexes in one synchronous
`uow.atomic` and verifies the complete relation chain: binding identity equals expectation; question
targets belong to that attempt/ticket/assignment/contract/epoch; answer belongs to the question;
required delivery targets are real question targets and present; commands/dispatch/observations
required sets are present with no duplicate IDs; observations belong to the attempt; logical source is
complete. A second Work's question/answer, ticket/assignment or delivery target is rejected.

Required sets cannot be emptied or derived from the manifest at verify time. Deleting commands,
emptying dispatch, adding a foreign command or duplicating an entry is rejected even when the manifest
digest is recomputed. Partial/subset manifests are not emitted as a successful full subject.

## UoW and async payload guard

Related indexes are read synchronously in one UoW. Payload bytes are read outside the transaction;
before returning, the same subject/source is re-read and any binding contract/epoch/resources,
current pointer, question version/validity/targets, answer/deliveries, commands/dispatch, observation
IDs/payload digests or logical source fingerprint change rejects the manifest. Transactions never
span an await. Payload bytes and counts are bounded and recorded. No transaction/await mix.

## Reader and two independent formats

`wave23-reader.mjs <db> <manifest> <expectation>` opens the state under a new Node PID and verifies the
manifest against the independent expectation, reading attempt/ticket/assignment/contract/epoch/
session, current, question/answer/delivery, observations and dispatch. The parent test proves a
different PID and unchanged delivery/observation/queue counts.

The same real controlled Work/Broker/SDK/context data still creates default-v1 and explicit-v2
snapshots, verifies each, restores each to a fresh root and opens personal readonly
(`wave20-personal-business`, `wave21-personal-v2`). Both formats are separate subjects; byte equality
or one bundle restore does not replace two consumers. `?scopeReview=1` stays explanation-only.

## B and C/D/E

B's admitted same-Runner business attach is still absent: idempotent recovered-result landing into the
original Store remains NOT_REACHED. inspect/cancel is not business resume.

C owns the single consumer driver. A supplies producer, child reader, expectation and manifest; C
consumes those actual outputs with the original IDs/coverage. D/E bind the exact package entry,
source SHA, data root, format, ports and review file; source-only tests do not certify installed
consumer bytes. Private permission/target activation remain main-owned.
