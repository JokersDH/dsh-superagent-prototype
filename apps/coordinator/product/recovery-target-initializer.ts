import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ApplicationFault } from '@personal-agent/application'
import { RecoveryTargetMaterialSchema } from '@personal-agent/contracts'
import type { RecoveryTargetMaterial } from '@personal-agent/contracts'
import { ProductStore, PRODUCT_SCHEMA_VERSION } from '@personal-agent/storage'

const fault = (message: string) => new ApplicationFault('state_in_use', message, 'none')
const identity = (stat: { dev: number | bigint; ino: number | bigint }) => `${stat.dev}:${stat.ino}`

/** Initialize only an exclusively created database. Interrupted or foreign databases are not repaired. */
export async function initializeRecoveryTarget(input: RecoveryTargetMaterial): Promise<void> {
  const material = RecoveryTargetMaterialSchema.parse(input), root = resolve(material.stateRoot)
  if (material.productSchema !== PRODUCT_SCHEMA_VERSION)
    throw new ApplicationFault('unsupported_capability', 'Target material belongs to another product schema', 'none')
  const before = lstatSync(root)
  const assertRoot = () => {
    const current = lstatSync(root)
    if (root !== material.stateRoot || realpathSync(root) !== root || !current.isDirectory() || current.isSymbolicLink() ||
      current.mode & 0o077 || (process.getuid && current.uid !== process.getuid()) || identity(current) !== identity(before))
      throw fault('Target directory is not the original canonical private directory')
  }
  assertRoot()
  for (const name of ['state.sqlite', 'state.sqlite-wal', 'state.sqlite-shm', 'artifacts', 'writer.lock', 'workbench.json', 'instance.json']) {
    try { lstatSync(join(root, name)); throw fault('Target contains pre-existing database, resources or artifacts') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  // O_EXCL prevents a check/open race from adopting an existing database. On failure leave evidence.
  const file = join(root, 'state.sqlite'), fd = openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600)
  let store: ProductStore | undefined
  try {
    const created = fstatSync(fd)
    assertRoot()
    if (identity(lstatSync(file)) !== identity(created)) throw fault('Target database identity changed before initialization')
    mkdirSync(join(root, 'artifacts'), { mode: 0o700 })
    store = new ProductStore({ path: file })
    if (store.database.productSchema !== material.productSchema || store.database.checkIntegrity().integrity !== 'ok')
      throw fault('New target schema initialization did not complete')
    store.close(); store = undefined
    assertRoot()
    const after = lstatSync(file)
    if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1 || identity(after) !== identity(created))
      throw fault('Target database identity changed during initialization')
    fsyncSync(fd)
    const directory = openSync(root, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { fsyncSync(directory) } finally { closeSync(directory) }
  } finally { store?.close(); closeSync(fd) }
}
