# G1 Coordinator Composition

Current follow-up: [local HTTP interface](http/README.md) and `docs/rfcs/WP-16/0002-main-application-checkpoint.md`. Authenticated application/Broker/HTTP and an API sandbox now exist; actual native product composition/full workbench remain pending. The sections below preserve the earlier G1 adapter scopes.

- `main.ts`: compatibility export of the structural binder now in `packages/application/src/core-repositories.ts`. It preserves full aggregate JSON and uses the same UnitOfWork.
- `runtime-ingress.ts`: authoritative data/identity/fact admission and outer transaction interface. Read ADR 0004 and `docs/rfcs/WP-01/0001-runtime-ingress-store.md`.
- `stored-ingress.ts`: actual ProductStore adapter with mandatory current Policy revalidation, immutable payload references, atomic config-drift hold and reconciliation request. It does not complete work or release resources from an exit observation.
- `recover-facts.ts`: bounded all-record preflight, original payload restoration and fact-only replay. Trusted decoder integrity and archived producer context are required; no native business restart interface exists here.

From the repository root after `pnpm install --frozen-lockfile`, build/check the dependencies first:

```sh
pnpm check:g1-core
pnpm --filter @personal-agent/coordinator typecheck
pnpm --filter @personal-agent/coordinator test
pnpm check:g1-ingress
pnpm check:g1-production
pnpm check:g1-recovery
```

The deterministic ingress tests use a transactional in-memory fixture and the built real core. They check strict wire parsing, trusted producer/full binding, immutable payload/body digests, once-only receipts, post-await freshness, physical-only observations, rollback and no ACK before the outer commit. The fixture never claims its in-memory receipts are production durability evidence.

`pnpm check:g1-ingress` also builds the storage dependencies and runs seven real SQLite tests in addition to the 18 deterministic tests. It tests actual UnitOfWork/FactReceipts/core/effects with explicitly test-only binding/observation tables, including rollback of every write when the last receipt INSERT fails and duplicate receipt preservation after reopening.

`createRuntimeIngress` does not create production runtime DB tables or implement authentication, process reconciliation, native permissions or verification. Production repositories/Runner wiring wait for the owning modules and the pending review fixes. Do not feed a successful fixture result into overall G1/product readiness.

`check:g1-production` uses the actual runtime binding/payload repositories and a real controlled fake child for five integration cases. It still uses fixture intake, resource registration and an advisory fake policy; durable Runner replay/IPC recovery and complete G1 remain pending. Current scope and next assignments are in `docs/adr/core/g1-production-handoff.md` at repository root.

`check:g1-recovery` additionally runs seven recovery cases and two real SIGKILL windows. Main restores missing payloads before admission and keeps original receipts after a commit/ACK gap. Its test snapshots are synced decoder exports, not certification of B's currently unaccepted Journal writer; see the current recovery handoff at repository root.
