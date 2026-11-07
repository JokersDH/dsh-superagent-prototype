# ADR 0001: Shared Contracts And G0 Workspace

Status: accepted. The combined G0 scope and independently reviewed A/B evidence are recorded in `g0-status.json` and `g0-main-report.md`; this ADR does not approve a product release.

## Context

Different agents will implement core, storage, DriverKit, Drivers and UI. The former product-spec TypeScript file expressed fields but did not validate runtime data. Private copies would let request identities, questions and completion references drift.

The original root package remains a DSH plugin with many peer dependencies. Its build and lockfile cannot be replaced just to check a small shared package.

## Decision

Use Zod 4.4.3 field definitions in `packages/contracts/src/schemas.ts`, inferred/generated aliases, and separate type-only local ports. Generate JSON Schema, exact version/hash and declarations through a pinned deterministic toolchain. The former product-spec type file becomes a compatibility re-export.

The initial package is independently installable using its own lock. Root scripts only add contract/bootstrap/spec entry points; they preserve original scripts, metadata, peers and dependency lock. The main-agent bootstrap templates show the eventual workspace layout, and a disposable pnpm fixture validates discovery. Root workspace activation/lock consolidation occurs at G1 integration, not silently during concurrent G0 experiments.

## Contract Decisions

Use strict objects without coercion/default approvals, safe bounded integer epochs, SHA-256 digests and UTC timestamps. Reject vacuous required criteria and unknown registered machine checks. Keep native string/integer request identities lossless and distinct.

Native question presentation and answers are normalized, but native approval/authentication/review cannot share multiple targets. Contextual answers reject expiry/unknown options/invalid forms. QuestionBroker still owns atomic binding checks, generation invalidation and delivery.

Critical payload references resolve to a versioned `{ kind, value }` union covering every RuntimeFactKind. Cancellation ACK, native turn end, process exit and writer quiescence remain distinct. Stateless validation is not the transaction fence or proof of external execution.

JSON Schema 2020-12 is generated and independently validated with AJV. Runtime-only rules are disclosed; JSON Schema is not a substitute for Zod/contextual ingress. Identity hashes include semantic validator/port source, so changing those checks cannot hide behind the same structural schema digest.

## Alternatives

Handwritten TS plus separate JSON Schema duplicates definitions. A custom validation DSL creates unnecessary tooling. Replacing the original root package with a monorepo immediately would couple G0 to the old DSH dependency graph and other agents' experiments. These are not selected.

## Acceptance And Limits

DATA-01: schemas/commands have positive and negative fixtures, strict typechecks, generated JSON/TS identity checks, a narrow frozen consumer and a clean standalone package installation. Bootstrap validation uses pinned pnpm and leaves the original plugin intact.

CORE-01 and OPS-01 require Agent A/B reports and main-agent reruns. G0 contract tests do not prove native compatibility, transactional durability, completion gating or product recovery. A candidate release file stays proposed/NOT_TESTED until measured evidence is reviewed.
