/**
 * `pa backup` / `pa verify-backup` entrypoints. Backup uses the portability bundle writer (consistent
 * SQLite snapshot through the storage port, referenced artifacts re-hashed, non-secret bindings) and
 * records only bundle identity in the private index. Verification never restores or starts anything.
 */
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { createBundle, manifestDigest, verifyBundle } from '@personal-agent/portability'
import { appendBackupIndex, readBackupIndex } from './backup-index.mjs'
import { readInstanceRecord, verifyInstance } from './instance.mjs'
import { readRelease } from './release.mjs'

export async function backupState({ installRoot, roots, values }) {
  if (values.out === undefined) return { ok: false, code: 'usage', message: 'backup 需要 --out <bundle 文件路径>' }
  const outputPath = isAbsolute(values.out) ? values.out : resolve(values.out)
  if (existsSync(outputPath)) {
    return {
      ok: false,
      code: 'target_not_empty',
      message: '备份目标已存在；不覆盖既有文件',
      detail: { output: outputPath },
      hint: '换一个 --out 路径，或先人工确认旧文件后再处理。',
    }
  }
  const parent = dirname(outputPath)
  try {
    if (!lstatSync(parent).isDirectory()) throw new Error('not a directory')
  } catch {
    return { ok: false, code: 'target_invalid', message: '备份目标父目录不存在', detail: { parent } }
  }
  const release = readRelease(roots.config)
  let running = false
  let access = null
  try {
    const record = readInstanceRecord(roots.config)
    if (record) {
      const verification = await verifyInstance(record)
      running = verification.ok
      access = record.access
    }
  } catch {
    // A stale/unverified instance record does not block a consistent snapshot; the manifest records
    // writer facts and never turns an old record into authority.
    running = false
    access = null
  }
  let bundle
  try {
    bundle = await createBundle({
      stateDir: roots.data,
      outputPath,
      stagingRoot: roots.cache,
      productVersion: release.release?.producer.version ?? '0.1.0',
      toolVersion: 'pa-backup/1',
      instance: { running, access },
    })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error)
      return { ok: false, code: error.code, message: error.message, detail: error.detail ?? {} }
    throw error
  }
  const entry = {
    archiveSha256: bundle.archiveSha256,
    manifestDigest: manifestDigest(bundle.manifest),
    bytes: bundle.bytes,
    createdAt: bundle.manifest.createdAt,
    stateName: bundle.manifest.source.stateName,
    statePath: roots.data,
    productSchema: bundle.manifest.database.productSchema,
    entries: bundle.manifest.counts.entries,
    artifacts: bundle.manifest.counts.artifacts,
    database: {
      integrity: bundle.manifest.database.integrity,
      foreignKeyViolations: bundle.manifest.database.foreignKeyViolations,
      eventSeq: bundle.manifest.database.eventSeq,
    },
    bundlePath: realpathSync(outputPath),
  }
  appendBackupIndex(roots.config, entry)
  return {
    ok: true,
    status: 'CREATED',
    bundlePath: entry.bundlePath,
    archiveSha256: entry.archiveSha256,
    manifestDigest: entry.manifestDigest,
    bytes: entry.bytes,
    counts: bundle.manifest.counts,
    evidence: bundle.manifest.evidence ?? null,
    database: entry.database,
    source: bundle.manifest.source,
    limitations: bundle.manifest.limitations,
  }
}

export async function verifyBackup({ roots, values }) {
  if (values.bundle === undefined) return { ok: false, code: 'usage', message: 'verify-backup 需要 --bundle <bundle 文件路径>' }
  const bundlePath = isAbsolute(values.bundle) ? values.bundle : resolve(values.bundle)
  try {
    const verified = await verifyBundle(bundlePath, { stagingRoot: roots.cache })
    return {
      ok: true,
      status: 'VERIFIED',
      bundlePath,
      manifestDigest: verified.manifestDigest,
      archiveSha256: verified.archiveSha256,
      bytes: verified.bytes,
      createdAt: verified.manifest.createdAt,
      producer: verified.manifest.producer,
      source: verified.manifest.source,
      counts: verified.manifest.counts,
      evidence: verified.manifest.evidence ?? null,
      database: {
        integrity: verified.database.integrity,
        foreignKeyViolations: verified.database.foreignKeyViolations,
        productSchema: verified.database.productSchema,
      },
      excluded: verified.manifest.selection.excluded,
      limitations: verified.manifest.limitations,
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error)
      return { ok: false, code: error.code, message: error.message, detail: error.detail ?? {} }
    throw error
  }
}

export function listBackups(configRoot) {
  return readBackupIndex(configRoot)
}

export function ensureBackupDirectory(roots) {
  const directory = join(roots.config, 'backups')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  return directory
}
