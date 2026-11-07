# G1 Coordinator Composition

This directory is a main-agent composition module. It is **not yet a running daemon, HTTP server or usable personal assistant**.

- `main.ts`: structural adapter between the formal core Repositories and the storage DomainStore. It preserves full aggregate JSON and uses the same UnitOfWork.
- `runtime-ingress.ts`: authoritative data/identity/fact admission and outer transaction interface. Read ADR 0004 and `docs/rfcs/WP-01/0001-runtime-ingress-store.md`.

From the repository root after `pnpm install --frozen-lockfile`, build/check the dependencies first:

```sh
pnpm check:g1-core
pnpm --filter @personal-agent/coordinator typecheck
pnpm --filter @personal-agent/coordinator test
pnpm check:g1-ingress
```

The deterministic ingress tests use a transactional in-memory fixture and the built real core. They check strict wire parsing, trusted producer/full binding, immutable payload/body digests, once-only receipts, post-await freshness, physical-only observations, rollback and no ACK before the outer commit. The fixture never claims its in-memory receipts are production durability evidence.

`pnpm check:g1-ingress` also builds the storage dependencies and runs seven real SQLite tests in addition to the 18 deterministic tests. It tests actual UnitOfWork/FactReceipts/core/effects with explicitly test-only binding/observation tables, including rollback of every write when the last receipt INSERT fails and duplicate receipt preservation after reopening.

`createRuntimeIngress` does not create production runtime DB tables or implement authentication, process reconciliation, native permissions or verification. Production repositories/Runner wiring wait for the owning modules and the pending review fixes. Do not feed a successful fixture result into overall G1/product readiness.
