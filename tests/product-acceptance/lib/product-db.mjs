import { createRequire } from 'node:module'
import { join } from 'node:path'

/**
 * Read-only observations of the product database, used to prove that a recovery or retry did not
 * create a physical writer. A schema change yields null (UNKNOWN) rather than a false claim.
 */
export function readRuntimeState(stateRoot, root) {
  return query(stateRoot, root, (database) => {
    const attempts = database.prepare('SELECT attempt_id, ticket_id, state FROM runtime_bindings').all()
    const begins = Number(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM dispatch_receipts WHERE command_id LIKE '%-begin-%' AND delivery IN ('native_accepted', 'written')",
        )
        .get()?.count ?? 0,
    )
    const observed = Number(
      database
        .prepare("SELECT COUNT(*) AS count FROM runtime_observations WHERE kind = 'dispatch.observed'")
        .get()?.count ?? 0,
    )
    const verifications = Number(
      database.prepare('SELECT COUNT(*) AS count FROM completion_verifications').get()?.count ?? 0,
    )
    return {
      attempts: attempts.map((row) => ({
        attemptId: row.attempt_id,
        ticketId: row.ticket_id,
        state: row.state,
      })),
      begins,
      observed,
      verifications,
    }
  })
}

export function countRows(stateRoot, root, table, where = '') {
  return query(stateRoot, root, (database) => {
    const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get()
    return Number(row?.count ?? 0)
  })
}

function query(stateRoot, root, run) {
  try {
    const require = createRequire(join(root, 'packages/storage/package.json'))
    const Database = require('better-sqlite3')
    const database = new Database(join(stateRoot, 'state.sqlite'), { readonly: true, fileMustExist: true })
    try {
      return run(database)
    } finally {
      database.close()
    }
  } catch {
    return null
  }
}
