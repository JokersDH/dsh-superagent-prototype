/**
 * Path and reference refusal rules shared by the reader and the local read port.
 *
 * These are security checks over already-resolved, project-relative references. They never grant
 * access; they only refuse account material, native homes, credentials and binary/opaque inputs.
 */

const DENIED_SEGMENTS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.ssh',
  '.aws',
  '.gnupg',
  '.config',
  '.codex',
  '.claude',
  '.dsh',
  '.deepseek',
  '.pnpm-store',
  '.cache',
  '.local-state',
  'account-home',
  'native-home',
  'sessions',
])

const DENIED_NAMES = new Set([
  '.env',
  '.npmrc',
  '.pnpmfile.cjs',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'credentials',
  'credentials.json',
  'secrets',
  'secrets.json',
])

const DENIED_EXTENSION = /\.(?:pem|key|p12|pfx|kdbx|sqlite|sqlite3|db|db-wal|db-shm|pcap|core)$/i

/** A reference with a scheme (`https:`, `file:`, `C:`) or protocol-relative `//host` is external. */
export function isExternalReference(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || value.startsWith('//')
}

export function isDeniedPath(value: string): boolean {
  if (isExternalReference(value)) return true
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.includes('\\') || value.includes('\0')) return true
  const segments = value.split('/').filter((segment) => segment.length > 0)
  if (segments.length === 0 || segments.includes('..')) return true
  return segments.some((segment, index) => {
    const lower = segment.toLowerCase()
    if (DENIED_SEGMENTS.has(lower)) return true
    if (lower === '.env' || lower.startsWith('.env.')) return true
    if (DENIED_NAMES.has(lower)) return true
    return index === segments.length - 1 && DENIED_EXTENSION.test(lower)
  })
}

/** Conservative set containment over declared scope atoms; it is not a glob-inclusion engine. */
export function scopeWithin(scope: import('@personal-agent/contracts').Scope, grant: import('@personal-agent/contracts').Scope): boolean {
  return (
    scope.projectId === grant.projectId &&
    scope.allowedPaths.every((path) => grant.allowedPaths.includes(path)) &&
    grant.excludedPaths.every((path) => scope.excludedPaths.includes(path)) &&
    scope.externalActions.every((action) => grant.externalActions.includes(action)) &&
    (!grant.expiresAt || (!!scope.expiresAt && Date.parse(scope.expiresAt) <= Date.parse(grant.expiresAt)))
  )
}

/** A path is inside an allowed project-relative root when equal or prefixed by `root/`. */
export function pathWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
}
