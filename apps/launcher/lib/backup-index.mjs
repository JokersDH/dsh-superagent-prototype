/**
 * Managed backup index in the private config root. It records only bundle identity and manifest
 * facts so `rollback --last` and operator diagnosis never need to trust a filename.
 */
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { PortabilityError } from '@personal-agent/portability'

export const BACKUP_INDEX_FILE = 'backup-index.json'
const MAX_ENTRIES = 200

export function backupIndexPath(configRoot) {
  return join(configRoot, BACKUP_INDEX_FILE)
}

export function readBackupIndex(configRoot) {
  const path = backupIndexPath(configRoot)
  if (!existsSync(path)) return []
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 1024 * 1024)
    throw new PortabilityError('unsafe_root', 'Backup index file is unsafe', { path })
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(parsed?.entries)) throw new Error('not an entry list')
    return parsed.entries
  } catch {
    throw new PortabilityError('manifest_invalid', 'Backup index is corrupt', { path })
  }
}

export function writeBackupIndex(configRoot, entries) {
  const value = { protocol: 'personal-backup-index/1', entries: entries.slice(-MAX_ENTRIES) }
  const path = backupIndexPath(configRoot)
  const temporary = `${path}.${process.pid}.tmp`
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  const fd = openSync(temporary, 'wx', 0o600)
  try {
    for (let offset = 0; offset < bytes.length;) offset += writeSync(fd, bytes, offset)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    renameSync(temporary, path)
  } finally {
    try { unlinkSync(temporary) } catch { /* renamed or absent */ }
  }
  return value.entries
}

export function appendBackupIndex(configRoot, entry) {
  const entries = readBackupIndex(configRoot).filter((existing) => existing.archiveSha256 !== entry.archiveSha256)
  entries.push(entry)
  return writeBackupIndex(configRoot, entries)
}
