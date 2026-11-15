/**
 * Wave-31 H11 package backup/restore consumer.
 *
 * The immutable package's own launcher performs backup -> verify-backup -> restore into a new private
 * state root. The restored database is then read with the original A public readers for the same
 * Work/question/answer/command/native_applied tuple. No daemon is started and no review grant is
 * claimed; review startup remains NOT_REACHED.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/dist/index.js'

const PA = 'apps/launcher/bin/pa.mjs'

function runPa({ packageRoot, roots, args }) {
  const result = spawnSync(process.execPath, [join(packageRoot, PA), ...args,
    '--install', packageRoot, '--config-root', roots.config, '--data-root', roots.data,
    '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace, '--json'],
  { encoding: 'utf8', timeout: 120000 })
  let parsed = null
  try { parsed = JSON.parse(result.stdout) } catch { parsed = null }
  return { exit: result.status, stdout: result.stdout, stderr: result.stderr, parsed }
}

export function runPackageBackupRestore({ packageRoot, releaseManifest, sourceState, original, out }) {
  mkdirSync(out, { recursive: true, mode: 0o700 })
  const roots = {
    config: join(out, 'config'), data: join(out, 'data'), cache: join(out, 'cache'),
    logs: join(out, 'logs'), workspace: join(out, 'workspace'),
  }
  for (const dir of Object.values(roots)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  cpSync(releaseManifest, join(roots.config, 'release.json'))
  cpSync(sourceState, roots.data, { recursive: true })
  const bundle = join(out, 'backup.pab')
  const backup = runPa({ packageRoot, roots, args: ['backup', '--out', bundle] })
  const verify = runPa({ packageRoot, roots, args: ['verify-backup', '--bundle', bundle] })
  const restoredRoot = join(out, 'restored')
  const restore = runPa({ packageRoot, roots, args: ['restore', '--bundle', bundle, '--to', restoredRoot] })
  const secondRestore = runPa({ packageRoot, roots, args: ['restore', '--bundle', bundle, '--to', restoredRoot] })
  const missingBundle = runPa({ packageRoot, roots, args: ['verify-backup', '--bundle', join(out, 'missing.pab')] })
  const emptyData = { ...roots, data: join(out, 'empty-data') }
  mkdirSync(emptyData.data, { recursive: true, mode: 0o700 })
  const emptyBackup = runPa({ packageRoot, roots: emptyData, args: ['backup', '--out', join(out, 'empty.pab')] })
  let readback = null
  const restoredDb = join(restoredRoot, 'state.sqlite')
  if (existsSync(restoredDb)) {
    const store = new ProductStore({ path: restoredDb })
    try {
      readback = {
        work: store.product.works.get(original.workId)?.id ?? null,
        question: store.product.questions.get(original.questionId)?.id ?? null,
        questionVersion: store.product.questions.get(original.questionId)?.version ?? null,
        answer: store.answers.get(original.answerId)?.questionId ?? null,
        delivery: store.answers.deliveries(original.answerId)[0]?.status ?? null,
        command: store.commands.get(original.commandId)?.status ?? null,
      }
    } finally { store.close() }
  }
  const checks = {
    backupCreated: backup.parsed?.ok === true && backup.parsed?.status === 'CREATED' && existsSync(bundle),
    verifyOk: verify.parsed?.ok === true && verify.parsed?.status === 'VERIFIED',
    restoreOk: restore.parsed?.ok === true && existsSync(restoredDb),
    sameWork: readback?.work === original.workId,
    sameQuestionAnswer: readback?.question === original.questionId && readback?.answer === original.questionId && readback?.questionVersion >= 1,
    nativeApplied: readback?.delivery === 'native_applied',
    commandRecorded: readback?.command === 'recorded',
    secondRestoreRefused: secondRestore.parsed?.status === 'BLOCKED' && secondRestore.parsed?.code === 'target_not_empty',
    missingBundleRefused: missingBundle.parsed?.ok === false || missingBundle.parsed?.status === 'BLOCKED',
    emptyStateRefused: emptyBackup.parsed?.status === 'BLOCKED' || emptyBackup.parsed?.ok === false,
  }
  return {
    protocol: 'package-backup-restore/1',
    surface: 'immutable package launcher backup/verify-backup/restore + original A readers',
    packageRoot, bundle, restoredRoot,
    commandExits: { backup: backup.exit, verify: verify.exit, restore: restore.exit, secondRestore: secondRestore.exit, missingBundle: missingBundle.exit, emptyBackup: emptyBackup.exit },
    statuses: { backup: backup.parsed?.status ?? null, verify: verify.parsed?.status ?? null, restore: restore.parsed?.status ?? null, secondRestore: secondRestore.parsed?.status ?? null, emptyBackup: emptyBackup.parsed?.status ?? null },
    readback, checks,
    reviewStartup: 'NOT_REACHED: restore does not start a daemon; explicit review-restored selection/health/PID REUSED path was not exercised.',
  }
}
