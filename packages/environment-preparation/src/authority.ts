import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync,
} from 'node:fs'
import { join } from 'node:path'
import { canonical, inside, isDirectory, samePath, sha256 } from './paths.ts'
import type { EnvironmentManager } from './types.ts'

/** Signed, caller-owned authority used for cross-process verification and trusted cleanup. */
export interface Authority {
  root: string
  key: Buffer
  receiptsDir: string
}

export interface OwnedPath {
  relative: string
  real: string
  dev: number
  ino: number
}

export interface ReceiptBody {
  protocol: 'environment-receipt/2'
  requestId: string
  inputFingerprint: string
  fingerprint: string
  installedDigest: string
  workspaceReal: string
  /** Device/inode of the actual workspace directory, so a replacement at the same path is detectable. */
  workspaceIdentity?: { dev: number; ino: number }
  projectReal: string
  manager: EnvironmentManager
  nodeVersion: string
  policy: string
  environment: Record<string, string>
  excludedPaths: string[]
  ownedPaths: OwnedPath[]
  mode: 'single' | 'pnpm_workspace'
  packageJsonDigest: string
  /** Present for pnpm_workspace receipts. */
  workspaceDigest?: string
  manifests?: { relative: string; digest: string }[]
  modulesDirs?: string[]
  lockFiles: { name: string; digest: string }[]
  dependencies: { name: string; spec: string }[]
  phase: 'ready'
  createdAt: string
}

export interface StoredReceipt {
  id: string
  body: ReceiptBody
}

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
}

const privateDirectory = (path: string, create: boolean): void => {
  if (!existsSync(path)) {
    if (!create) throw new Error(`Authority directory is missing: ${path}`)
    mkdirSync(path, { recursive: true, mode: 0o700 })
  }
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Authority root must be a real directory, not a symlink.')
  if ((stat.mode & 0o077) !== 0) throw new Error('Authority root must not be accessible by group/other (mode 0700).')
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('Authority root must be owned by the current user.')
}

function readOrCreateKey(root: string, create: boolean): Buffer {
  const path = join(root, 'authority.key')
  if (!existsSync(path)) {
    if (!create) throw new Error('Authority key is missing.')
    try {
      const fd = openSync(path, 'wx', 0o600)
      try {
        const bytes = Buffer.from(randomBytes(32).toString('hex'))
        let offset = 0
        while (offset < bytes.length) offset += writeSync(fd, bytes, offset)
      } finally { closeSync(fd) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error('Authority key must be a private regular file.')
  const value = readFileSync(path, 'utf8').trim()
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Authority key is malformed.')
  return Buffer.from(value, 'hex')
}

/** Creates/validates the caller-owned authority root outside both project and workspace. */
export function ensureAuthority(authorityRoot: string, project: string, workspace: string): Authority {
  if (!authorityRoot.startsWith('/')) throw new Error('authorityRoot must be an absolute path.')
  const root = canonical(authorityRoot)
  if (inside(project, root) || inside(workspace, root) || inside(root, project) || inside(root, workspace) || samePath(root, project) || samePath(root, workspace))
    throw new Error('authorityRoot must be outside the original project and the private workspace.')
  privateDirectory(root, true)
  const key = readOrCreateKey(root, true)
  const receiptsDir = join(root, 'receipts')
  privateDirectory(receiptsDir, true)
  return { root, key, receiptsDir }
}

export function loadAuthority(authorityRoot: string): Authority {
  if (!authorityRoot.startsWith('/')) throw new Error('authorityRoot must be an absolute path.')
  const root = canonical(authorityRoot)
  privateDirectory(root, false)
  const key = readOrCreateKey(root, false)
  const receiptsDir = join(root, 'receipts')
  privateDirectory(receiptsDir, false)
  return { root, key, receiptsDir }
}

const mac = (key: Buffer, body: ReceiptBody): string => createHmac('sha256', key).update(canonicalJson(body)).digest('hex')

export function writeReceipt(authority: Authority, body: ReceiptBody): { id: string; receipt: StoredReceipt } {
  const id = randomBytes(32).toString('hex')
  const record = JSON.stringify({ body, mac: mac(authority.key, body) })
  const target = join(authority.receiptsDir, `${id}.json`)
  const temporary = join(authority.receiptsDir, `.${id}.tmp`)
  writeFileSync(temporary, `${record}\n`, { mode: 0o600 })
  renameSync(temporary, target)
  return { id, receipt: { id, body } }
}

export function readReceipt(authority: Authority, id: string): { ok: true; receipt: StoredReceipt } | { ok: false; code: string; message: string } {
  if (!/^[a-f0-9]{64}$/.test(id)) return { ok: false, code: 'receipt_missing', message: 'Environment receipt id is malformed.' }
  const path = join(authority.receiptsDir, `${id}.json`)
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as { body?: ReceiptBody; mac?: string }
    if (!value.body || typeof value.mac !== 'string') return { ok: false, code: 'receipt_forged', message: 'Environment receipt is malformed.' }
    if (value.body.protocol !== 'environment-receipt/2') return { ok: false, code: 'receipt_forged', message: 'Environment receipt protocol is unsupported.' }
    const expected = Buffer.from(mac(authority.key, value.body), 'hex')
    const observed = Buffer.from(value.mac, 'hex')
    if (expected.length !== observed.length || !timingSafeEqual(expected, observed))
      return { ok: false, code: 'receipt_forged', message: 'Environment receipt signature does not match the authority key.' }
    return { ok: true, receipt: { id, body: value.body } }
  } catch {
    return { ok: false, code: 'receipt_missing', message: 'Environment receipt is missing or unreadable.' }
  }
}

export function removeReceipt(authority: Authority, id: string): void {
  if (!/^[a-f0-9]{64}$/.test(id)) return
  try { unlinkSync(join(authority.receiptsDir, `${id}.json`)) } catch { /* already gone */ }
}

export function ownedPath(workspace: string, relative: string): OwnedPath | undefined {
  const real = canonical(join(workspace, relative))
  if (!inside(canonical(workspace), real) || !existsSync(real)) return undefined
  const stat = lstatSync(real)
  return { relative, real, dev: Number(stat.dev), ino: Number(stat.ino) }
}

export function identityMatches(entry: OwnedPath): boolean {
  try {
    const stat = lstatSync(entry.real)
    return Number(stat.dev) === entry.dev && Number(stat.ino) === entry.ino
  } catch { return false }
}

export function workspaceKey(workspace: string): string {
  return sha256(`workspace:${canonical(workspace)}`)
}

/** Process liveness with only explicit evidence: true alive, false ESRCH, undefined observation failure. */
export function processAlive(pid: number): boolean | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined
  try { process.kill(pid, 0); return true } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    if (code === 'EPERM') return true
    return undefined
  }
}

export interface WorkspaceLock { release(): void; path: string }

/** One installer per workspace: an existing live lock blocks; only ESRCH evidence permits stale removal. */
export function acquireWorkspaceLock(authority: Authority, workspace: string, requestId: string): { ok: true; lock: WorkspaceLock } | { ok: false; code: string; message: string } {
  const directory = join(authority.root, 'locks')
  privateDirectory(directory, true)
  const path = join(directory, `${workspaceKey(workspace)}.json`)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = randomBytes(16).toString('hex')
    try {
      const fd = openSync(path, 'wx', 0o600)
      try { writeSync(fd, JSON.stringify({ pid: process.pid, requestId, token, startedAt: new Date().toISOString() })) } finally { closeSync(fd) }
      return {
        ok: true,
        lock: {
          path,
          release: () => {
            try {
              const current = JSON.parse(readFileSync(path, 'utf8')) as { token?: string }
              if (current.token === token) unlinkSync(path)
            } catch { /* only our token is removable */ }
          },
        },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return { ok: false, code: 'workspace_lock_unavailable', message: `Could not create the workspace lock: ${String(error)}` }
    }
    let observed: string
    let content: { pid?: unknown; token?: unknown }
    try {
      observed = readFileSync(path, 'utf8')
      content = JSON.parse(observed) as { pid?: unknown; token?: unknown }
    } catch {
      return { ok: false, code: 'workspace_lock_indeterminate', message: 'An existing workspace lock cannot be read; it is not removed.' }
    }
    const alive = typeof content.pid === 'number' ? processAlive(content.pid) : undefined
    if (alive === true) return { ok: false, code: 'workspace_busy', message: 'Another preparation process holds this workspace.' }
    if (alive === undefined) return { ok: false, code: 'workspace_lock_indeterminate', message: 'Process existence for an existing workspace lock is unknown; it is not removed.' }
    // ESRCH: remove only the exact lock we observed, then race for acquisition again.
    try {
      if (readFileSync(path, 'utf8') === observed) unlinkSync(path)
    } catch { /* another process won the race */ }
  }
  return { ok: false, code: 'workspace_busy', message: 'The workspace lock could not be acquired.' }
}
