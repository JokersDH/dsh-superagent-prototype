import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function fileSha256(path) {
  return sha256(readFileSync(path))
}

/** Exact loopback HTTP URL: plain http, no credentials, no query, no fragment, root path. */
export function loopbackOrigin(value) {
  let url
  try {
    url = new URL(String(value))
  } catch {
    throw new TypeError(`Not a URL: ${String(value)}`)
  }
  if (
    url.protocol !== 'http:' ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new TypeError(`Origin must be plain loopback http: ${value}`)
  return url
}

/**
 * Reads a product API credential from the private state directory. Ownership and mode are checked
 * on a real regular file before the bytes are read, and the value is never returned to a caller that
 * could print it (callers only pass it to request headers).
 */
export function readPrivateCredential(stateDir, name = 'api.key') {
  if (!/^[a-z]+\.key$/.test(name)) throw new TypeError('Unrecognized credential name')
  const path = resolve(stateDir, name)
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
    throw new Error('Private credential must be an owner-only regular file')
  if (process.getuid && stat.uid !== process.getuid()) throw new Error('Private credential has another owner')
  const value = readFileSync(path, 'utf8')
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Private credential has an unexpected encoding')
  return value
}

export function gitSource(root, { ignoreUntrackedPrefixes = [] } = {}) {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const lines = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
  // Generated acceptance evidence must not make the product source look modified, whether it is
  // tracked (a re-run rewrites it) or untracked (a fresh run writes it). Other edits still count.
  const relevant = lines.filter((line) => {
    const path = line.slice(3)
    return !ignoreUntrackedPrefixes.some((prefix) => path.startsWith(prefix))
  })
  return { commit, dirty: relevant.length > 0 }
}

export function branchName(root) {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
}

export function isFresh(checkedAt, now, maxAgeMs) {
  const timestamp = Date.parse(String(checkedAt))
  if (!Number.isFinite(timestamp)) return false
  return now - timestamp <= maxAgeMs && timestamp <= now + 60_000
}

export function environmentIdentity() {
  return {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    os: execFileSync('uname', ['-sr'], { encoding: 'utf8' }).trim(),
  }
}
