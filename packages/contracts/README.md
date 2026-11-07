# Personal Agent Contracts

Version `1.0.0`, API major `1`. This package implements the G0 shared contract surface; it does not implement the coordinator, core completion gate, persistence or native Drivers.

## Install And Check

From this directory, independently of the original DSH application:

```sh
pnpm install --ignore-workspace --frozen-lockfile
pnpm run check
```

Node `24.21.0` and pnpm `11.7.0` were used for the initial checks. The product's proposed Node/binding release combination is separately evaluated by Agent B. The package is deliberately not coupled to a native SQLite binding or any DSH peer.

`check` verifies generated artifacts, strictly typechecks source/tests/consumer, runs Node test cases, and builds ESM JavaScript plus `.d.ts` declarations in ignored `dist/`. Node tests use `.case.ts` so the original application's Vitest does not accidentally collect a different test runner.

## Single Source

- `src/schemas.ts`: the only data-field definitions, bounds, strict object schemas and cross-field rules. Zod `4.4.3` is the only runtime dependency.
- `src/validation.ts`: contextual question-answer and runtime fact checks; trusted registered check validation.
- `src/ports.ts`: local TypeScript Driver/Application/host interfaces. Functions, streams and process handles are not JSON wire data.
- `src/types.ts`: generated `z.infer` aliases. There is no independently edited product type model.
- `generated/contracts.schema.json`: JSON Schema 2020-12, checked with AJV for every exported schema.
- `generated/manifest.json` and `src/identity.ts`: version, API major, schema hash, validator/port source hashes, and JSON digest.

Regenerate with `pnpm run generate`. CI/downstream checks use `pnpm run check:generated` and fail if artifacts are stale. Do not edit generated files.

The schema hash covers the canonical JSON Schema plus the exact schema, contextual validator and port source hashes. A validator-only change therefore invalidates the identity even if the structural JSON fields did not change. Source formatting/comments can conservatively invalidate it too. Compare versions/hashes before using a frozen Driver/Profile snapshot.

## Consumer Example

After building, workspace consumers import the package name:

```ts
import { UserCommandSchema, CONTRACT_IDENTITY } from '@personal-agent/contracts';
import type { UserCommand, AgentDriverV1 } from '@personal-agent/contracts';

const command: UserCommand = UserCommandSchema.parse(untrustedJson);
```

`TrustedActor` is separate from `UserCommand`; strict user-command schemas reject an injected actor/authority/token field. Authentication and authorization still belong to the trusted application entry point.

Use `parseContractRevision(input, registeredChecks)` when creating contracts. Structural parsing alone cannot check the trusted project's registered commands. Every contract needs at least one meaningful required criterion; required machine criteria name a registered check, and human criteria have an explicit user acceptance route implemented later.

Use `parseQuestionAnswer(question, answer, now)` before persisting a response. It preserves native option IDs, validates finite forms, refuses expired/cancelled questions, and never treats URL opening as authenticated completion. The Broker must still atomically check version/current binding and invalidate a candidate before an answer resumes implementation.

Use `parseRuntimeFactPayload(fact, payload)` after resolving a payload reference. The stored payload is `{ kind, value }`; it must match the fact kind. Prepared policy and question targets must match the reporting attempt. The ingress transaction must still validate current Assignment/epoch/contract and keep physical stop facts after business authorization ends.

## Important Semantics

- WorkRecord has no execution state. WorkView/action context is a read projection.
- All critical facts and Runner commands require full attempt identity. Native turn ending does not finish a Ticket.
- `WireRequestId` preserves strings versus canonical decimal int64 values, including values beyond JS safe integers. A Driver must use lossless parsing or reject unsupported numeric precision before conversion; this package cannot recover precision already lost by JSON.parse.
- Native approvals/authentication/review have one target and retain options/native flow. Business answer reuse is a Broker scope decision, not semantic string matching.
- Unknown sends cannot select same-key-safe replay in v1. Reconcile first; local IDs are not proof of native idempotency.
- Unknown usage has no zero defaults. Native cancellation ACK, process exit, observed resource quiescence and product completion are separate payloads.
- Parse successes are not proof of native enforcement, writer termination, artifact freshness, trusted evidence or authorized side effects.

## JSON Schema Is Structural

Use the exported Zod parsers at trusted application/Runner ingress. JSON Schema describes wire structure and representable constraints; contextual/cross-field rules remain runtime checks and carry `x-runtime-rules`/manifest annotations. Tests deliberately show that a structurally valid question can still be rejected by the authoritative runtime validator.

The first `fixtures/v1-client.json` and narrow consumer are a frozen v1 regression baseline, not a claim of compatibility with an earlier released product. Keep old fixtures when changing contracts, add new ones, and review semantic/enum/removal changes for a major version. Optional additions still require old-consumer checks. No schema version silently expands authorization.
