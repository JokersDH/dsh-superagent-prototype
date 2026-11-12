/** Wave-13 A7: seed real state, SIGKILL before/after snapshot creation, parent verifies recovery. */
import { ProductStore } from '../../../../packages/storage/dist/index.js'
import { WorkflowSnapshots } from '../../../../packages/workflows/dist/index.js'

const [path, snapshotPath, mode] = process.argv.slice(2)
if (!path || !snapshotPath || !mode) throw new Error('Usage: snapshot-crash.mjs <db> <snapshot> <before|after>')
const at = '2026-11-12T00:00:00.000Z'
const store = new ProductStore({ path })
store.product.works.insert({ id: 'snapshot-work', projectId: 'project-1', conversationId: 'conversation-1', title: 'Snapshot crash work', createdAt: at })
const artifact = store.artifacts.write(Buffer.from('{"snapshot":"crash"}'))
store.artifacts.insert(artifact)
if (mode === 'before') process.kill(process.pid, 'SIGKILL')
await new WorkflowSnapshots(store).create({ destination: snapshotPath })
process.kill(process.pid, 'SIGKILL')
