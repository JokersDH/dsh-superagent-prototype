# Deterministic Product Application

`createProductApplication` composes the existing personal core and ProductStore product repositories behind `ApplicationService`. It does not run a model or create a second Work lifecycle. Public package imports are the supported interface; do not mix compiled and source copies of exception classes.

Supported commands: discussion/anchored supplement, create/revise/stop/continue work, pause/resume future dispatch, retry assignment, structured question answer and current-candidate acceptance. Knowledge/learning commands remain explicitly unsupported in this first slice. Creation currently requires a configured profile and at least one registered required machine check.

The host supplies a configured local principal, allowed projects/scopes/profile/check IDs, a persistent 32-byte action secret, current native-binding fence and optional trusted completion review port. HTTP authenticates the principal; request bodies never contain an actor. The returned `core` and `questions` are trusted coordinator assembly ports, not browser/Reasoner tools. Runtime callers should receive the existing `core.personalExecutor()` role facade only.

Every dispatch owns its outer commit. It validates the immutable command+actor digest, performs domain/product work in a nested rollback scope, then commits one accepted/rejected command receipt. The last receipt failing rolls core, indexes, messages, events and queue back together. Exact command replay returns its original sequence even after SQLite reopen.

Core Executor callbacks enqueue `application.execute` or existing `runtime.reconcile` work; they never await native I/O inside a transaction. New contracts retire prior tickets and revoke their grant; the actual execution worker must enforce the previous physical writer barrier and prepared policy before launch. Pending intents are not native execution proof.

Snapshots derive phase/actions from core and runtime registrations, with cursor in the same SQLite read view. Missing writer registration after an assignment ran is indeterminate. Retry tokens bind assignment/contract/generation/dispatch-hold revision. The trusted completion port must persist acceptance on this same UnitOfWork; machine failure or unavailable verification is never bypassed. Root core completion still validates its authoritative verifier.

`changes(after)` streams only `application.*` invalidations/delivery notifications, excludes private core/runtime/command data, detects history gaps and supports iterator cancellation while idle. Browser SSE is a notification channel: fetch a new snapshot to recover full state.

Build/test: `pnpm --filter @personal-agent/application build` and `pnpm --filter @personal-agent/application test`. Tests use real core/SQLite and controlled host adapters; they do not certify actual Runner/vendor compatibility or a complete product E2E.
