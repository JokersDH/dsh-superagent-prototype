/** Shared test scaffolding for the verification package. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProductStore } from '@personal-agent/storage'

export const tempDir = (prefix = 'verification-case-'): string => mkdtempSync(join(tmpdir(), prefix))

export interface StoreContext {
  dir: string
  store: ProductStore
}

export const makeStore = (): StoreContext => {
  const dir = tempDir('verification-store-')
  return { dir, store: new ProductStore({ path: join(dir, 'product.sqlite') }) }
}

export const withStore = async (fn: (context: StoreContext) => Promise<void> | void): Promise<void> => {
  const context = makeStore()
  try {
    await fn(context)
  } finally {
    context.store.close()
    rmSync(context.dir, { recursive: true, force: true })
  }
}
