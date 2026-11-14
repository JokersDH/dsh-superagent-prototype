/**
 * Bounded logical content proof for a workflow database.
 *
 * SQLite `integrity_check`, foreign keys and `user_version` prove that a file is structurally a
 * current product database; they do not prove that the rows are the rows of the snapshot that was
 * restored. This module re-reads every durable table (except the explicitly listed root-local
 * runtime tables) and hashes rows by primary storage order, column names and values. A legitimate
 * extra message, a changed answer/delivery, a removed row or a replaced event changes the digest.
 *
 * Excluded tables are limited to root-local runtime presence/ownership and FTS shadow storage that
 * is derived from `conversation_messages`; they are never used as writer-quiescence or execution
 * evidence. The exclusion list and limits are part of the digest header, so a future change needs a
 * new protocol version rather than silently changing the meaning of an existing digest.
 */
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'

export const CONTENT_PROOF_PROTOCOL = 'workflow-content/1' as const

export interface ContentProofLimits {
  readonly maxTables: number
  readonly maxRows: number
  readonly maxBytes: number
}
export const DEFAULT_CONTENT_PROOF_LIMITS: ContentProofLimits = Object.freeze({
  maxTables: 256, maxRows: 200_000, maxBytes: 64 * 1024 * 1024,
})

export interface ContentCollection {
  readonly name: string
  readonly rows: number
  /** SHA-256 over the column header and ordered `rowid:values` lines. */
  readonly digest: string
}

export interface WorkflowContentSummary {
  readonly protocol: typeof CONTENT_PROOF_PROTOCOL
  readonly productSchema: number | null
  readonly digest: string | null
  readonly complete: boolean
  readonly collections: readonly ContentCollection[]
  readonly omittedTables: readonly string[]
  readonly limits: ContentProofLimits
  readonly reason: string | null
  readonly rows: number
  readonly bytes: number
}

/** Root-local runtime tables, not portable business content and not writer-quiescence evidence. */
export const CONTENT_OMITTED_TABLES = Object.freeze(['coordinator_instances', 'writer_claim'])
const FTS_PREFIX = 'conversation_search'

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : `number:${value}`
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'bigint') return `bigint:${value.toString()}`
  if (Buffer.isBuffer(value)) return `blob:${value.toString('base64')}`
  if (value instanceof Uint8Array) return `blob:${Buffer.from(value).toString('base64')}`
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([name, item]) => `${JSON.stringify(name)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(String(value))
}

/**
 * Read a bounded, deterministic content summary. A limit/failure result has `complete: false` and
 * `digest: null`; callers must not treat it as a partial match.
 */
export function readWorkflowContent(databasePath: string, options: { limits?: Partial<ContentProofLimits> } = {}): WorkflowContentSummary {
  const limits: ContentProofLimits = { ...DEFAULT_CONTENT_PROOF_LIMITS, ...(options.limits ?? {}) }
  for (const [name, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Invalid content proof limit ${name}`)
  const omitted = [...CONTENT_OMITTED_TABLES]
  const fail = (reason: string, productSchema: number | null, collections: ContentCollection[] = [], rows = 0, bytes = 0): WorkflowContentSummary =>
    ({ protocol: CONTENT_PROOF_PROTOCOL, productSchema, digest: null, complete: false, collections, omittedTables: omitted, limits, reason, rows, bytes })
  let database: Database.Database
  try { database = new Database(databasePath, { readonly: true, fileMustExist: true }) }
  catch (error) { return fail(`database is not readable: ${String(error)}`, null) }
  try {
    const productSchema = Number(database.pragma('user_version', { simple: true }))
    const tables = (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
      .map(row => row.name)
      .filter(name => !omitted.includes(name) && !name.startsWith(FTS_PREFIX))
    if (tables.length > limits.maxTables) return fail('table count exceeds the content proof limit', productSchema)
    const collections: ContentCollection[] = []
    let rows = 0, bytes = 0
    for (const name of tables) {
      const quoted = `"${name.replaceAll('"', '""')}"`
      const columns = (database.pragma(`table_info(${quoted})`) as { name: string }[]).map(column => column.name)
      if (columns.length === 0) return fail(`table ${name} has no readable columns`, productSchema, collections, rows, bytes)
      const header = `${name}\u0000${columns.join('\u0000')}`
      const hash = createHash('sha256').update(header)
      let tableRows = 0
      const statement = database.prepare(`SELECT rowid AS "__rowid", * FROM ${quoted} ORDER BY rowid`)
      for (const row of statement.iterate() as Iterable<Record<string, unknown>>) {
        tableRows += 1; rows += 1
        if (tableRows > limits.maxRows) return fail(`table ${name} exceeds the row limit`, productSchema, collections, rows, bytes)
        if (rows > limits.maxRows) return fail('row count exceeds the content proof limit', productSchema, collections, rows, bytes)
        const line = `${canonical(row.__rowid)}:${columns.map(column => canonical(row[column])).join(',')}`
        bytes += Buffer.byteLength(line) + 1
        if (bytes > limits.maxBytes) return fail('content bytes exceed the content proof limit', productSchema, collections, rows, bytes)
        hash.update('\n').update(line)
      }
      collections.push({ name, rows: tableRows, digest: hash.digest('hex') })
    }
    const digest = sha256([CONTENT_PROOF_PROTOCOL, `schema:${productSchema}`, `omitted:${omitted.join(',')}`,
      `limits:${limits.maxTables}/${limits.maxRows}/${limits.maxBytes}`,
      ...collections.map(value => `${value.name}:${value.rows}:${value.digest}`)].join('\n'))
    return { protocol: CONTENT_PROOF_PROTOCOL, productSchema, digest, complete: true, collections, omittedTables: omitted, limits, reason: null, rows, bytes }
  } catch (error) {
    return fail(`content proof could not be read: ${String(error)}`, null)
  } finally { database.close() }
}
