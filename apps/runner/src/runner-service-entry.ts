/**
 * Spawned Runner service entry (wave-02 B2).
 *
 * The parent starts this file with `node runner-service-entry.ts <scenario>`. It builds the
 * per-attempt context from the bridge bootstrap and serves one attempt over stdio.
 *
 * Scenarios:
 * - `happy`, `waiting-user`, `ignore-cancel`, ...  the deterministic fake agent (fixture lane);
 * - `codex-fake`  the **Codex native Driver** against an in-process fake app-server that speaks the
 *   installed protocol's method names. This exercises the real Driver over the real Runner process;
 *   it does not execute an installed Codex (that stays NOT_TESTED).
 */
import { serveRunner } from './runner-service.ts'
import { FakeDriver } from '../../../packages/testing/src/fake-driver.ts'
import { CodexNativeDriver } from '../../../packages/drivers/codex-native/src/index.ts'
import { CodexProductDriver } from '../../../packages/drivers/codex-native/src/native.ts'
import { createFakeAppServer } from '../../../packages/drivers/codex-native/src/fake-app-server.ts'
import { ProcessHost } from './process-host.ts'
import { encodeFrame } from '../../../packages/driver-kit/src/index.ts'
import { prepareRunnerEnvironment } from './environment-preparation.ts'

const scenario = process.argv[2] ?? 'happy'
let detached = false
process.stdout.on('error', error => { if ((error as NodeJS.ErrnoException).code === 'EPIPE') detached = true; else throw error })

const handle = await serveRunner({
  input: (async function* (): AsyncGenerator<Uint8Array> {
    for await (const chunk of process.stdin) yield chunk as Uint8Array
  })(),
  write: frame => {
    if (!detached) process.stdout.write(encodeFrame(frame))
  },
  eagerPrepare: scenario === 'codex-native',
  ...(scenario === 'codex-native' && process.env.PA_RUNNER_ENVIRONMENT_PLAN
    ? { prepare: (spec, context) => prepareRunnerEnvironment(process.env.PA_RUNNER_ENVIRONMENT_PLAN!, spec, context) }
    : {}),
  ...(process.env.PA_RUNNER_RECOVERY_ROOT ? { recoveryRoot: process.env.PA_RUNNER_RECOVERY_ROOT } : {}),
  createDriver: (_spec, hooks) =>
    scenario === 'codex-native' ? new CodexProductDriver({ beforeAnswerWrite: hooks.beforeNativeWrite }) : scenario.startsWith('codex-fake')
      ? new CodexNativeDriver({
          // `codex-fake` completes a plain turn; `codex-fake-approval` emits an approval first.
          connect: async () => createFakeAppServer({ approval: scenario === 'codex-fake-approval' }).transport(),
        })
      : new FakeDriver({ scenario }),
  // Payloads are served by the coordinator over the same bridge; the Runner never owns the store.
  payloads: {
    read: async (reference: string) => JSON.parse(reference) as never,
  },
  // No local sink: facts are forwarded over the bridge and the coordinator's reply is the receipt.
  processHost: new ProcessHost({ resolveCwd: () => process.env.PA_RUNNER_CWD ?? process.cwd() }),
})

await handle.done
await handle.shutdown()
