/** Wave-25 A11: a different Node PID reads the persisted original-result deliveries after close. */
import { ProductStore } from '../../../../packages/storage/dist/index.js'
const [databasePath, answerId, secondAnswerId] = process.argv.slice(2)
if (!databasePath || !answerId || !secondAnswerId) throw new Error('Usage: wave25-result-reader.mjs <db> <answerId> <secondAnswerId>')
const store = new ProductStore({ path: databasePath })
try {
  console.log(JSON.stringify({ pid: process.pid, first: store.answers.deliveries(answerId).map(row => ({ targetBindingId: row.targetBindingId, status: row.status })),
    second: store.answers.deliveries(secondAnswerId).map(row => ({ targetBindingId: row.targetBindingId, status: row.status })) }))
} finally { store.close() }
