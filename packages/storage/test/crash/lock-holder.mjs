/** Holds the writer lock in a child process until the parent kills it, for REL-03 stale-holder tests. */
import { InstanceRegistry, ProductStore, WriterLock } from '../../src/index.ts'

const [dbPath, stateDir] = process.argv.slice(2)
if (!dbPath || !stateDir) throw new Error('usage: lock-holder.mjs <db> <stateDir>')
const store = new ProductStore({ path: dbPath })
const lock = new WriterLock(stateDir, new InstanceRegistry(store.db))
const content = lock.acquire()
// Synchronous write so the parent sees the marker while the event loop stays free for heartbeats.
process.stdout.write(`LOCKED ${content.nonce}\n`)
setInterval(() => lock.heartbeat(), 1000)
