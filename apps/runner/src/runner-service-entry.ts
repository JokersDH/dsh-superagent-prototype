/**
 * Spawned Runner service entry (wave-02 B2).
 *
 * The parent starts this file with `node runner-service-entry.ts <fake-driver-scenario>`. It builds
 * the per-attempt context from the bridge bootstrap and serves one attempt over stdio.
 */
import { serveRunner } from './runner-service.ts'
import { FakeDriver } from '../../../packages/testing/src/fake-driver.ts'
import { ProcessHost } from './process-host.ts'
import { encodeFrame } from '../../../packages/driver-kit/src/index.ts'

const scenario = process.argv[2] ?? 'happy'

const handle = await serveRunner({
  input: (async function* (): AsyncGenerator<Uint8Array> {
    for await (const chunk of process.stdin) yield chunk as Uint8Array
  })(),
  write: frame => {
    process.stdout.write(encodeFrame(frame))
  },
  createDriver: () => new FakeDriver({ scenario }),
  // Payloads are served by the coordinator over the same bridge; the Runner never owns the store.
  payloads: {
    read: async (reference: string) => JSON.parse(reference) as never,
  },
  // No local sink: facts are forwarded over the bridge and the coordinator's reply is the receipt.
  processHost: new ProcessHost(),
})

await handle.done
await handle.shutdown()
