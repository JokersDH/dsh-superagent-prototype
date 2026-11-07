/** Shared test scaffolding: a throwaway state directory and a ProductStore over it. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProductStore } from '../src/index.ts'

export const tempDir = (prefix = 'storage-case-'): string => mkdtempSync(join(tmpdir(), prefix))

export interface StoreContext {
  dir: string
  path: string
  store: ProductStore
}

export const makeStore = (dir: string = tempDir()): StoreContext => {
  const path = join(dir, 'product.sqlite')
  return { dir, path, store: new ProductStore({ path }) }
}

/** Runs `fn` with a fresh store and always closes and removes the state directory. */
export const withStore = async (fn: (context: StoreContext) => Promise<void> | void): Promise<void> => {
  const context = makeStore()
  try {
    await fn(context)
  } finally {
    context.store.close()
    rmSync(context.dir, { recursive: true, force: true })
  }
}
