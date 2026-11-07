/**
 * Small helpers shared by the install step and the probes: sanitising evidence paths, hashing files
 * and comparing dotted versions. Deliberately dependency-free.
 */
import { createHash } from 'node:crypto'
import { readFile, mkdtemp } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/** Path prefixes that must not leak into committed evidence. */
export function defaultSubstitutions(root) {
  // Longest/most specific prefix first: the experiment root lives under $HOME, so it must win.
  return [
    [root, '<PLATFORM_ROOT>'],
    [homedir(), '<HOME>'],
    [tmpdir(), '<TMPDIR>'],
  ].filter(([from]) => typeof from === 'string' && from.length > 0)
}

export function sanitizeText(text, extra = []) {
  let out = String(text)
  for (const [from, to] of extra) out = out.split(from).join(to)
  return out
}

/** Deep-sanitise a JSON-ish value: strings are rewritten, objects/arrays are copied. */
export function sanitize(value, extra = []) {
  if (typeof value === 'string') return sanitizeText(value, extra)
  if (Array.isArray(value)) return value.map(item => sanitize(item, extra))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item, extra)]))
  }
  return value
}

export async function sha256File(path) {
  const bytes = await readFile(path)
  return createHash('sha256').update(bytes).digest('hex')
}

/** Compare dotted versions numerically: `compareVersions('3.51.3','3.51.2') > 0`. */
export function compareVersions(left, right) {
  const parse = value => String(value).split(/[.+-]/).map(part => Number.parseInt(part, 10)).filter(Number.isFinite)
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

export const atLeast = (actual, minimum) => compareVersions(actual, minimum) >= 0

export async function makeTempDir(prefix) {
  return mkdtemp(join(tmpdir(), prefix))
}

/** A check result the report can aggregate without interpretation. */
export function check(id, passed, detail, extra = {}) {
  return { id, status: passed ? 'PASS' : 'FAIL', detail, ...extra }
}
