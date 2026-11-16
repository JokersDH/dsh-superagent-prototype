/**
 * wave-34 harness: drive the channel with main's ORIGINAL NativeProductAttempt methods.
 *
 * `attachCallbacks` is a thin closure over `recordFact`/`readPayload`/`nativeWriteDecision`, but it is
 * only returned by `launch()` (a native spawn). This harness therefore constructs the same class and
 * calls the same methods directly, supplying the post-registration endpoint from an in-process
 * service — the exact state `launch()` would have established — and no launch/spawn occurs.
 */
import { join } from 'node:path'
import type { TestContext } from 'node:test'
import { NativeProductAttempt } from '../../../../apps/coordinator/product/native-attempt.ts'
import { RunnerPayloadStore } from '../../src/payload-store.ts'
import { key } from '../../../../packages/orchestrator-core/dist/index.js'
import { JsonSchema } from '../../../../packages/contracts/src/schemas.ts'
import { canonicalDigest } from '../../../../packages/contracts/src/canonical.ts'
import type { CriticalFact, Json, RunnerCommand } from '../../../../packages/contracts/src/types.ts'
import type { AttachedAttemptCallbacks } from '../../../../packages/execution/src/attached-attempt.ts'
import type { RunningAttempt } from '../../../../packages/execution/src/contracts.ts'
import { binding, producer } from '../../../../tests/integration/runtime-ingress-fixture.ts'
import { makeAttemptSpec } from '../../../../packages/testing/src/index.ts'
import { startService, type DriverContext } from './actual-harness.ts'
import type { ProductIngress } from './product-ingress-harness.ts'

export const ATTEMPT = producer.attempt

export type NativeCallbacks = {
  recordFact(fact: CriticalFact): Promise<{ factId: string; persisted: true; seq: number }>
  readPayload(reference: string): Promise<unknown>
  nativeWrite(command: RunnerCommand): Promise<{ allowed: boolean }>
}

export async function startNativeCallbacks(
  t: TestContext,
  ingress: ProductIngress,
  script: (context: DriverContext) => Promise<{ reason: 'terminal' | 'cancelled' | 'error' | 'disconnected'; evidenceRefs: string[] }>,
  options: { sinkDelayMs?: number; failFactIds?: string[]; localPayload?: Json } = {},
) {
  const spec = makeAttemptSpec()
  let release!: () => void
  const started = new Promise<void>(resolve => {
    release = resolve
  })
  const sinkCalls: string[] = []
  const h = await startService(t, {
    spec,
    source: producer.source,
    runnerIdentityRef: producer.runnerIdentityRef,
    recovery: true,
    run: async context => {
      await started
      return script(context)
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const endpoint = await h.waitEndpoint()

  let current = true
  const runtime = new NativeProductAttempt(
    spec,
    ingress.store,
    h.root,
    join(h.root, 'runner-state'),
    producer,
    {
      record: async fact => {
        sinkCalls.push(fact.factId)
        if (options.sinkDelayMs) await new Promise(resolve => setTimeout(resolve, options.sinkDelayMs))
        if (options.failFactIds?.includes(fact.factId)) throw new Error('original ingress refused this fact')
        return ingress.sink.record(fact)
      },
    },
    () => current && ingress.store.bindings.current(binding.ticketId)?.state === 'active' && ingress.store.authority.isCurrent(binding.contract),
  )
  // The post-registration endpoint `launch()` would have discovered; supplied without spawning.
  ;(runtime as unknown as { endpoint: unknown }).endpoint = endpoint
  const local = new RunnerPayloadStore(join(h.root, 'caller-payloads'))
  // Content-addressed identity: the caller-side store is seeded with the same value the Driver will
  // store, so both sides agree on the immutable reference without sharing memory.
  const seededLocalRef = options.localPayload === undefined ? undefined : local.write(options.localPayload, 'critical')
  const prepared: string[] = []
  const callbacks: NativeCallbacks = {
    recordFact: fact => runtime.recordFact(fact, local, () => prepared.push(fact.factId)),
    readPayload: reference => runtime.readPayload(reference),
    nativeWrite: command => runtime.nativeWriteDecision(command),
  }

  const indexCommand = (command: RunnerCommand): void => {
    const record = { command, inputIds: [] }
    ingress.store.commands.record(key('product-command', command.id), canonicalDigest(JsonSchema.parse(record)), () => record)
  }
  const permit = (commandId: string, onWrite: () => void = () => undefined): void => runtime.allowAnswer(commandId, onWrite)
  const putLocalPayload = (value: Json): string => local.write(value, 'critical')
  const setCurrent = (value: boolean): void => {
    current = value
  }

  // The Driver starts only when the test activates it, so every handle is assigned first (no TDZ on
  // the harness object inside the script).
  return { h, endpoint, runtime, local, callbacks, indexCommand, permit, putLocalPayload, setCurrent, sinkCalls, prepared, spec, seededLocalRef, activate: release }
}

export type NativeCallbacksHarness = Awaited<ReturnType<typeof startNativeCallbacks>>

/**
 * Build the exact `RunningAttempt` shape `launch()` returns (handle + attachPort + attachCallbacks)
 * around the injected component state. This is a launch-shaped fixture, not a launch: no child is
 * spawned, and every test using it says so. It exists so consumers are written against the real
 * returned shape instead of a private field. `registration` is overridable only for refusal tests.
 */
export function launchShape(
  h: NativeCallbacksHarness,
  overrides: { attemptId?: string; registration?: unknown; callbacks?: Partial<AttachedAttemptCallbacks> } = {},
): RunningAttempt {
  return {
    attemptId: overrides.attemptId ?? h.spec.attemptId,
    feed: async () => undefined,
    waitExit: async () => ({ reason: 'terminal', evidenceRefs: ['launch-shape'] }),
    stop: async () => ({ quiescence: 'confirmed', evidenceRefs: ['launch-shape'] }),
    attachPort: { registration: overrides.registration ?? h.endpoint, producer: h.h.producer } as NonNullable<RunningAttempt['attachPort']>,
    attachCallbacks: {
      fact: fact => h.callbacks.recordFact(fact),
      payload: request => h.callbacks.readPayload(request.reference),
      nativeWrite: intent => h.callbacks.nativeWrite(intent.command),
      ...overrides.callbacks,
    },
  }
}
