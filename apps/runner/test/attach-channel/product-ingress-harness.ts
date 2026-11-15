/**
 * wave-31 harness for the ORIGINAL product ingress.
 *
 * This composes the real `ProductStore`, the real personal engine repositories and the real
 * `createStoredRuntimeIngress` binding used by `apps/coordinator/product/execution.ts` — not a double
 * of the fact sink. The only fixture pieces are the pre-seeded ticket/binding that
 * `tests/integration/runtime-ingress-fixture.ts` also uses for the product runtime tests.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProductStore } from '../../../../packages/storage/dist/index.js'
import { createPersonalEngine } from '../../../../packages/orchestrator-core/dist/index.js'
import { bindCoreRepositories } from '../../../../apps/coordinator/main.ts'
import { createStoredRuntimeIngress, storedAttemptPayloads } from '../../../../apps/coordinator/stored-ingress.ts'
import { binding, initialTicket, producer } from '../../../../tests/integration/runtime-ingress-fixture.ts'
import type { CriticalFact } from '../../../../packages/contracts/src/types.ts'

export function openProductIngress() {
  const directory = mkdtempSync(join(tmpdir(), 'pa-i31-store-'))
  const store = new ProductStore({ path: join(directory, 'state.sqlite'), artifactsRoot: join(directory, 'artifacts') })
  store.domain.tickets.save(initialTicket() as never)
  store.authority.enable(binding.contract)
  store.bindings.record(binding as never)
  store.bindings.setCurrent(binding.ticketId, binding.attemptId)
  const policy: never = (() => ({
    version: 'v1',
    paused: false,
    evalTimeoutMs: 1000,
    gate: () => ({ admissible: false, reason: 'fixture' }),
    revalidate: () => true,
    admitsInferred: () => false,
  })) as never
  const core = createPersonalEngine({
    repo: bindCoreRepositories(store),
    policy,
    scope: { scope: () => ({ listened: true, observed: false }) },
    assessor: { request: () => {} },
    executor: { start: () => {}, deliver: () => {}, stop: () => {} },
    outbox: { send: () => {}, withdraw: () => {}, status: () => undefined },
    completionPolicy: () => {
      throw new Error('fixture ingress does not complete work')
    },
    isCurrentContract: (ref: unknown) => store.authority.isCurrent(ref as never),
  } as never)
  const ingress = createStoredRuntimeIngress(store, core as never, policy)
  const bound = ingress.bind(producer)
  const payloads = storedAttemptPayloads(store)
  const recorded: CriticalFact[] = []
  const sink = {
    record: async (fact: CriticalFact) => {
      recorded.push(fact)
      return bound.record(fact)
    },
  }
  return {
    directory,
    store,
    bound,
    payloads,
    recorded,
    sink,
    /** Write a payload into the real store and return the reference the Runner should ask for. */
    putPayload: (value: unknown): string => store.payloads.write(value as never).ref,
    close: () => rmSync(directory, { recursive: true, force: true }),
  }
}

export type ProductIngress = ReturnType<typeof openProductIngress>
