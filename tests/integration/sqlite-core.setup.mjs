import { vi, afterEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const stores = [];
const directories = [];
vi.mock('../../packages/orchestrator-core/src/core/index.ts', async importOriginal => {
  const original = await importOriginal();
  if (!process.env.G1_STORAGE_REVIEW_ROOT) throw new Error('Provide the independently installed/built storage review checkout');
  const storageUrl = pathToFileURL(resolve(process.env.G1_STORAGE_REVIEW_ROOT, 'packages/storage/dist/index.js')).href;
  const { ProductStore } = await import(/* @vite-ignore */ storageUrl);
  const { bindCoreRepositories } = await import('../../apps/coordinator/main.ts');
  function SqliteRepositories() {
    const directory = mkdtempSync(join(tmpdir(), 'g1-core-sqlite-'));
    const store = new ProductStore({ path: join(directory, 'state.sqlite'), artifactsRoot: join(directory, 'artifacts') });
    stores.push(store); directories.push(directory);
    return bindCoreRepositories(store);
  }
  return { ...original, MemoryRepositories: SqliteRepositories };
});
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
afterAll(() => {
  if (stores.length || directories.length) throw new Error('Unreleased SQLite review resources');
});
