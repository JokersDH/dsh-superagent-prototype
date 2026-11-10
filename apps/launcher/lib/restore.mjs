/**
 * `pa restore` / `pa import-bundle` / `pa rollback` entrypoints.
 *
 * - restore: verified bundle -> brand-new private state directory; never overwrites an active state
 *   and never starts the daemon. Explicit `--map-path old=new` pairs rewrite project bindings.
 * - import-bundle: verify and copy a bundle into the managed private backup directory.
 * - rollback: keep the failed current state directory and restore a previously verified snapshot
 *   into its place; if the restore fails the original directory is put back.
 */
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, realpathSync, renameSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { restoreBundle, verifyBundle } from '@personal-agent/portability'
import { appendBackupIndex, readBackupIndex } from './backup-index.mjs'

const asPortabilityFailure = (error) => {
  if (error && typeof error === 'object' && 'code' in error)
    return { ok: false, code: String(error.code), message: error.message, detail: error.detail ?? {} }
  throw error
}

function parseMappings(raw) {
  const mappings = []
  for (const value of raw ?? []) {
    const separator = value.indexOf('=')
    if (separator <= 0) return { error: `--map-path 需要 old=new 形式：${value}` }
    const from = value.slice(0, separator)
    const to = value.slice(separator + 1)
    if (!isAbsolute(from) || !isAbsolute(to)) return { error: `--map-path 两侧都必须是绝对路径：${value}` }
    mappings.push({ from: resolve(from), to: resolve(to) })
  }
  return { mappings }
}

export function resolveBundlePath(roots, argument) {
  if (isAbsolute(argument) && existsSync(argument)) return resolve(argument)
  const direct = resolve(argument)
  if (existsSync(direct)) return direct
  const managed = join(roots.config, 'backups', argument)
  if (existsSync(managed)) return managed
  if (existsSync(`${managed}.pab`)) return `${managed}.pab`
  return null
}

function managedBackupDirectory(roots) {
  const directory = join(roots.config, 'backups')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  return directory
}

export async function importBundle({ roots, values }) {
  if (values.bundle === undefined) return { ok: false, code: 'usage', message: 'import-bundle 需要 --bundle <bundle 文件路径>' }
  const source = resolveBundlePath(roots, values.bundle)
  if (source === null) return { ok: false, code: 'archive_invalid', message: '找不到要导入的 bundle 文件', detail: { argument: values.bundle } }
  try {
    const verified = await verifyBundle(source, { stagingRoot: roots.cache })
    const target = join(managedBackupDirectory(roots), `${verified.archiveSha256}.pab`)
    if (!existsSync(target)) {
      copyFileSync(source, target)
      chmodSync(target, 0o600)
    }
    appendBackupIndex(roots.config, {
      archiveSha256: verified.archiveSha256,
      manifestDigest: verified.manifestDigest,
      bytes: verified.bytes,
      createdAt: verified.manifest.createdAt,
      stateName: verified.manifest.source.stateName,
      statePath: null,
      productSchema: verified.manifest.database.productSchema,
      entries: verified.manifest.counts.entries,
      artifacts: verified.manifest.counts.artifacts,
      imported: true,
      bundlePath: target,
    })
    return {
      ok: true,
      status: 'IMPORTED',
      bundlePath: target,
      archiveSha256: verified.archiveSha256,
      manifestDigest: verified.manifestDigest,
      counts: verified.manifest.counts,
      database: {
        integrity: verified.database.integrity,
        foreignKeyViolations: verified.database.foreignKeyViolations,
        productSchema: verified.database.productSchema,
      },
    }
  } catch (error) {
    return asPortabilityFailure(error)
  }
}

export async function restoreState({ roots, values }) {
  if (values.bundle === undefined) return { ok: false, code: 'usage', message: 'restore 需要 --bundle <bundle 路径或导入 id>' }
  if (values.to === undefined) return { ok: false, code: 'usage', message: 'restore 需要 --to <新的私有 state 目录>' }
  const target = resolve(values.to)
  if (target === resolve(roots.data))
    return {
      ok: false,
      code: 'target_active',
      message: '不能把恢复目标设为当前活跃 state',
      detail: { target },
      hint: '恢复到新的私有目录；活跃实例的 state 永不被覆盖。',
    }
  const mapped = parseMappings(values['map-path'])
  if (mapped.error) return { ok: false, code: 'usage', message: mapped.error }
  const bundlePath = resolveBundlePath(roots, values.bundle)
  if (bundlePath === null) return { ok: false, code: 'archive_invalid', message: '找不到 bundle 文件', detail: { argument: values.bundle } }
  try {
    const result = await restoreBundle({
      bundlePath,
      targetStateDir: target,
      stagingRoot: roots.cache,
      mapPaths: mapped.mappings,
    })
    return {
      ok: true,
      status: 'RESTORED',
      target: result.targetStateDir,
      reportPath: result.reportPath,
      report: result.report,
      nextSteps: [
        `核对 restore-report.json 的 requiresRevalidation 与 pendingRebind 后再启动。`,
        `node apps/launcher/bin/pa.mjs start --state ${result.targetStateDir}`,
      ],
    }
  } catch (error) {
    return asPortabilityFailure(error)
  }
}

function latestSnapshotFor(roots, target) {
  const entries = readBackupIndex(roots.config)
  const canonical = existsSync(target) ? realpathSync(target) : target
  const candidates = entries.filter((entry) => {
    if (entry.imported || typeof entry.statePath !== 'string') return false
    try {
      return realpathSync(entry.statePath) === canonical
    } catch {
      return entry.statePath === canonical
    }
  })
  candidates.sort((left, right) => (left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : 0))
  return candidates[0] ?? null
}

export async function rollbackState({ roots, values }) {
  const target = resolve(values.target ?? roots.data)
  let bundlePath
  if (values.bundle !== undefined) {
    bundlePath = resolveBundlePath(roots, values.bundle)
    if (bundlePath === null) return { ok: false, code: 'archive_invalid', message: '找不到回滚用的 bundle 文件', detail: { argument: values.bundle } }
  } else {
    const snapshot = latestSnapshotFor(roots, target)
    if (snapshot === null)
      return {
        ok: false,
        code: 'no_snapshot',
        message: '没有该 state 的已验证升级前快照',
        detail: { target },
        hint: '先用 `pa backup --out <文件>` 创建快照，或用 --bundle 指定已有 bundle。',
      }
    bundlePath = snapshot.bundlePath
  }
  let targetStat
  try {
    targetStat = lstatSync(target)
  } catch {
    return { ok: false, code: 'target_invalid', message: '回滚目标 state 不存在', detail: { target } }
  }
  if (!targetStat.isDirectory() || targetStat.isSymbolicLink())
    return { ok: false, code: 'target_invalid', message: '回滚目标必须是真实 state 目录', detail: { target } }
  if (!existsSync(join(target, 'state.sqlite')))
    return { ok: false, code: 'target_invalid', message: '回滚目标没有产品数据库', detail: { target } }

  // Verify the snapshot before moving the current state aside.
  try {
    await verifyBundle(bundlePath, { stagingRoot: roots.cache })
  } catch (error) {
    return asPortabilityFailure(error)
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  let failedDir = `${target}.failed-${stamp}`
  for (let suffix = 1; existsSync(failedDir); suffix += 1) failedDir = `${target}.failed-${stamp}-${suffix}`
  renameSync(target, failedDir)
  try {
    const result = await restoreBundle({ bundlePath, targetStateDir: target, stagingRoot: roots.cache })
    return {
      ok: true,
      status: 'ROLLED_BACK',
      target,
      bundlePath,
      failedDir,
      reportPath: result.reportPath,
      report: result.report,
      notes: [
        '失败/升级前目录已保留，可人工检查或删除。',
        '恢复后的实例需要重新核对 requiresRevalidation 与 pendingRebind 后再启动。',
      ],
    }
  } catch (error) {
    const failure = asPortabilityFailure(error)
    let restoredOriginal = false
    if (!existsSync(target)) {
      try {
        renameSync(failedDir, target)
        restoredOriginal = true
      } catch {
        restoredOriginal = false
      }
    }
    return {
      ...failure,
      ok: false,
      code: failure.code ?? 'rollback_failed',
      message: `回滚失败：${failure.message ?? 'restore failed'}`,
      detail: { ...failure.detail, failedDir, restoredOriginal },
      hint: restoredOriginal
        ? '已把原目录放回，保持可启动状态；请检查 bundle 后重试。'
        : '原目录仍在 failed 路径中，需人工恢复；不要假报已回滚。',
    }
  }
}

/** Read the managed bundle list for diagnosis (never starts or restores anything). */
export function listManagedBundles(roots) {
  const directory = join(roots.config, 'backups')
  if (!existsSync(directory)) return []
  return readBackupIndex(roots.config).map((entry) => ({
    bundlePath: entry.bundlePath,
    archiveSha256: entry.archiveSha256,
    createdAt: entry.createdAt,
    stateName: entry.stateName,
    imported: entry.imported === true,
    present: typeof entry.bundlePath === 'string' ? existsSync(entry.bundlePath) : false,
    bytes: entry.bytes,
  }))
}
