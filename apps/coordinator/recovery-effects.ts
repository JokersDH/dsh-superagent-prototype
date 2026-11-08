import { IdSchema } from '@personal-agent/contracts'
import type { Effects } from '@personal-agent/effects'
import type { ProductStore } from '@personal-agent/storage'
import { reconcileRegisteredRunner } from './reconcile-runner.ts'

export class RuntimeRecoveryHeld extends Error {
  readonly reason: string
  constructor(reason: string) { super(`Runtime recovery held: ${reason}`); this.reason = reason }
}

/** Reuse the durable queue's bounded concurrency/backoff; retry only query and the same pinned cancel ID. */
export function handleRunnerRecovery(effects: Pick<Effects, 'handle'>, store: ProductStore, options: { concurrency?: number; timeoutMs?: number } = {}): void {
  const concurrency = options.concurrency ?? 2
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new RangeError('Recovery concurrency must be between 1 and 4')
  effects.handle('runtime.reconcile', async (reasonRef, attemptId) => {
    IdSchema.parse(reasonRef)
    const result = await reconcileRegisteredRunner(store, attemptId, options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
    if (result.status === 'held') throw new RuntimeRecoveryHeld(result.reason)
  }, { limit: () => concurrency, retry: [2000, 60_000] })
}
