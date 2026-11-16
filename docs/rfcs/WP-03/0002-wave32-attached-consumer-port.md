# RFC: minimal attached-consumer port on the original RunningAttempt

**Status:** candidate (B-owned source; needs main wiring)
**Owners:** B (execution/Runner caller), main (ProductExecution/NativeProductAttempt composition)

## Problem

The Runner already publishes an authenticated recovery endpoint (`socketPath`, credential file, pinned
dev/ino) and a registration record is stored on the original attempt. An external coordinator can serve
the Runner's fact/payload/native-write callbacks through that endpoint, but the product host never
exposes the registration it already owns, so no consumer can attach to the ORIGINAL Work without
inventing a Work, attempt or credential.

## Minimal interface

B publishes `AttachedAttemptPort` in `packages/execution/src/contracts.ts`:

```ts
type AttachedAttemptPort = {
  registration: { socketPath: string; credentialPath: string; socketIdentity: { dev: number; ino: number } }
  producer: { attempt: AttemptRef; runnerIdentityRef: string; source: string }
}
```

`RunningAttempt.attachPort` is optional. A host that has registered the Runner sets it after the
existing `register()` step; a host that does not never sets it.

## What main wires (smallest diff)

In `apps/coordinator/product/native-attempt.ts`, after the existing `register()` succeeds:

```ts
this.handle.attachPort = {
  registration: this.endpoint,              // the same endpoint already used for inspect/cancel
  producer: this.producer,                  // the immutable registration producer
}
```

Nothing else changes: `this.endpoint` and `this.producer` already exist for `connection()`.

## Consumer

`packages/execution/src/attached-attempt.ts#attachRunnerAttempt` binds a caller-selected lease, serves
`fact`/`payload`/`native-write-intent` through caller handlers and replies with the ORIGINAL ids. The
caller (main) still supplies the original Store ingress, the immutable payload body, and the fresh
main/Broker native-write guard. The port itself grants none of them.

## Explicit non-goals

- No second coordinator, ledger, Work, attempt, Runner, credential or execution lifecycle.
- No replay of business commands; a detached pending native intent stays `indeterminate`.
- No change to the frozen Runner v1 wire contract, authorization, or native profile admission.
- `attachPort` is not readiness/permission; it is a reference to a registration main already owns.
