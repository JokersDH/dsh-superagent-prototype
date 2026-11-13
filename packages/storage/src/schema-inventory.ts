import Database from 'better-sqlite3'
import { PRODUCT_SCHEMA_VERSION } from './migrations.ts'
import { requiredSchemaObjects, TARGET_INDEX_TABLES } from './target-inventory.ts'

export interface SchemaInventory {
  productSchema: number | null
  missingTables: readonly string[]
  missingIndexes: readonly string[]
  unknownTables: readonly string[]
  futureSchema: boolean
}

/** Readonly inventory shared with snapshot verification; it never initializes or migrates a DB. */
export function inspectSchemaInventory(path: string, schema?: number | null): SchemaInventory {
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    let productSchema = schema ?? null
    if (productSchema === null) {
      try {
        const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'product_schema'").get() as { value?: string } | undefined
        if (row) productSchema = Number(JSON.parse(String(row.value)))
      } catch { productSchema = null }
    }
    if (!productSchema || !Number.isSafeInteger(productSchema) || productSchema < 1)
      return { productSchema, missingTables: [], missingIndexes: [], unknownTables: [], futureSchema: false }
    const { tables, indexes } = requiredSchemaObjects(productSchema)
    const actualTables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
      .map(row => row.name).filter(name => !name.startsWith('sqlite_')))
    const actualIndexes = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[])
      .map(row => row.name).filter(name => !name.startsWith('sqlite_autoindex_')))
    const known = new Set([...tables, ...TARGET_INDEX_TABLES])
    return { productSchema, missingTables: [...tables].filter(name => !actualTables.has(name)).sort(),
      missingIndexes: [...indexes].filter(name => !actualIndexes.has(name)).sort(),
      unknownTables: [...actualTables].filter(name => !known.has(name)).sort(), futureSchema: productSchema > PRODUCT_SCHEMA_VERSION }
  } finally { db.close() }
}
