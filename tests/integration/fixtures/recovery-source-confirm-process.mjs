import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'

const input = JSON.parse(readFileSync(process.argv[2], 'utf8')), crash = process.argv[3]
const store = new ProductStore({ path: join(input.stateRoot, 'state.sqlite') })
const product = createProductRuntime({ store, stateRoot: input.stateRoot, scratchProject: input.project,
  principal: input.principal, projects: [{ id: input.projectId, scope: { projectId: input.projectId, allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] } }],
  actionSecret: Buffer.alloc(32, 79), startupMode: 'recovery_readonly', now: () => input.now,
  recoveryExecutor: () => ({ id: 'read-only-fixture-executor', revision: 1, executable: process.execPath, expectedVersion: process.version }) })
const record = store.commands.record.bind(store.commands)
if (crash === 'before-commit') store.commands.record = (...args) => {
  const result = record(...args)
  if (String(args[0]).startsWith('recovery-confirm-')) process.kill(process.pid, 'SIGKILL')
  return result
}
try {
  const result = await product.operations.recoverySourceConfirm({ token: input.token }, { ...input.principal, source: 'local_cli' })
  if (crash === 'after-commit') process.kill(process.pid, 'SIGKILL')
  process.stdout.write(JSON.stringify(result) + '\n')
} finally { await product.close(); store.close() }
