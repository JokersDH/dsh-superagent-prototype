/**
 * Applies one command transaction, then blocks so the parent can SIGKILL it inside or after the
 * commit window. `before-commit` holds the open transaction; `after-commit` commits first.
 */
import { writeSync } from 'node:fs'
import { ProductStore } from '../../src/index.ts'

const [dbPath, phase] = process.argv.slice(2)
if (!dbPath || (phase !== 'before-commit' && phase !== 'after-commit')) throw new Error('usage: worker.mjs <db> <before-commit|after-commit>')

const store = new ProductStore({ path: dbPath })
const COMMAND = 'crash-command'
const DIGEST = 'crash-digest'

store.uow.atomic(() => {
  store.domain.tickets.save({ id: 'ticket-crash', assignments: [], undelivered: [] })
  store.commands.record(COMMAND, DIGEST, () => {
    store.queue.enqueue('demo', 'key-1', JSON.stringify({ n: 1 }), 1, 0, new Date().toISOString())
    store.events.append({ topic: 'demo', entityRef: COMMAND, payload: { n: 1 } })
    return { accepted: true }
  })
  if (phase === 'before-commit') {
    writeSync(1, 'READY\n')
    blockForever()
  }
})
writeSync(1, 'COMMITTED\n')
blockForever()

function blockForever() {
  for (;;) { /* killed by the parent */ }
}
