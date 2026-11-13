/**
 * Package-contained explicit restored-review preparation. It calls main's actual
 * `prepareRestoredReview` signer from the same immutable install and writes a new 0600 file; it
 * never copies credentials or invents another authority. The output is consumed only when explicitly
 * passed to `pa start --discussion-only --review-restored-scope`.
 */
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { ProductStore } from '@personal-agent/storage'
import { prepareRestoredReview } from '../../coordinator/product/restored-review.ts'
import { localCredentials } from '../../coordinator/http/local-state.ts'

export function prepareReview({ state, project, allowPaths, excludePaths, out }) {
  const projectIds = Array.isArray(project) ? project : typeof project === 'string' ? [project] : []
  if (typeof state !== 'string' || projectIds.length === 0 || !Array.isArray(allowPaths) || allowPaths.length === 0 || typeof out !== 'string')
    return { ok: false, code: 'usage', message: 'review-restored 需要 --state <恢复state> --project <历史项目id> --allow-path <相对路径> --out <新私有文件>' }
  const stateRoot = resolve(state), output = isAbsolute(out) ? out : resolve(out)
  if (existsSync(output)) return { ok: false, code: 'target_not_empty', message: 'review 配置已存在；不覆盖既有文件', detail: { output } }
  try {
    if (!lstatSync(dirname(output)).isDirectory()) throw new Error('not a directory')
  } catch {
    return { ok: false, code: 'target_invalid', message: 'review 配置父目录不存在', detail: { parent: dirname(output) } }
  }
  const store = new ProductStore({ path: resolve(stateRoot, 'state.sqlite') })
  try {
    const secret = Buffer.from(localCredentials(stateRoot)('action.key'), 'hex')
    const file = prepareRestoredReview(store, stateRoot,
      { userId: 'local-demo-user', authorityRef: 'local-demo-authority' },
      projectIds.map((projectId) => ({ projectId, allowedPaths: allowPaths, excludedPaths: excludePaths ?? ['.git'] })), secret)
    const fd = openSync(output, 'wx', 0o600)
    try { writeFileSync(fd, JSON.stringify(file, null, 2) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
    return { ok: true, status: 'prepared', output, projects: file.payload.projects.map((value) => value.projectId),
      expiresAt: file.payload.expiresAt, createdAt: file.payload.createdAt, access: file.payload.access,
      startupAvailable: file.payload.startupAvailable, protocol: file.payload.protocol }
  } catch (error) {
    return { ok: false, code: 'review_prepare_failed', message: String(error?.message ?? error) }
  } finally { store.close() }
}
