/**
 * Redacted support bundle: whitelisted status/version/digests/error codes only.
 *
 * It never exports conversation bodies, replies, prompts, credentials/keys, native session data,
 * IPC nonces, account directories or arbitrary file contents. Root paths and instance argv are not
 * included; only logical root names + private flags and derived identities are reported.
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore, PRODUCT_SCHEMA_VERSION, verifyDatabase } from '../../../packages/storage/dist/index.js'

const VERSION = 'pa-support/1'
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null } }
const privateDir = (path) => {
  try { const stat = lstatSync(path); return stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 }
  catch { return false }
}
const present = (path) => existsSync(path)

export function supportBundle({ roots, timeoutMs = 0 } = {}) {
  const release = readJson(join(roots.config, 'release.json'))
  const install = readJson(join(roots.install, '..', 'install.json')) ?? readJson(join(roots.install, 'install.json'))
  const record = readJson(join(roots.config, 'instance.json'))
  const journal = readJson(join(roots.config, 'install-switch.json'))
  const databasePath = join(roots.data, 'state.sqlite')
  let database = { present: present(databasePath), schema: null, integrity: null, digest: null }
  if (database.present) {
    try { database.digest = sha256(readFileSync(databasePath)) } catch { database.digest = null }
    try {
      const store = new ProductStore({ path: databasePath })
      store.close()
      const verify = verifyDatabase(databasePath)
      database.schema = verify.productSchema
      database.integrity = verify.integrity
    } catch (error) { database.integrity = `error:${String(error?.code ?? error?.name ?? 'unknown')}` }
  }
  const instance = record === null ? null : {
    protocol: record.protocol, buildId: record.buildId ?? null, mode: record.mode ?? null, access: record.access ?? null,
    startupMode: record.startupMode ?? null, startedAt: record.startedAt ?? null,
    ports: { console: record.consoleURL ? Number(new URL(record.consoleURL).port) : null, api: record.apiURL ? Number(new URL(record.apiURL).port) : null },
  }
  return {
    protocol: VERSION,
    generatedAt: new Date().toISOString(),
    productSchema: Number(PRODUCT_SCHEMA_VERSION),
    platform: { platform: process.platform, arch: process.arch, node: process.versions.node, modules: process.versions.modules },
    install: install === null ? null : { buildId: install.buildId ?? null, schema: install.producer?.productSchema ?? null, sourceDirty: install.source?.dirty ?? null, sourceCommit: install.source?.commit ?? null },
    release: release === null ? null : { buildId: release.buildId ?? null, schema: release.producer?.productSchema ?? null, artifacts: Array.isArray(release.artifacts) ? release.artifacts.length : null },
    roots: Object.fromEntries(['config', 'data', 'cache', 'logs', 'workspace'].map((name) => [name, { private: privateDir(roots[name]), present: present(roots[name]) }])),
    state: { database, restoreMarker: present(join(roots.data, 'restore-report.json')) },
    instance,
    journal: journal === null ? null : { status: journal.status ?? null, reason: journal.reason ?? null, at: journal.switchedAt ?? null },
    redaction: { fields: ['conversation text', 'reply text', 'prompts', 'credentials/keys', 'native sessions', 'IPC nonces', 'account directories', 'argv', 'absolute root paths', 'file contents'], included: false },
  }
}

export function writeSupportBundle({ roots, out }) {
  if (typeof out !== 'string' || out.length === 0) throw new Error('support requires --out <path>')
  const bundle = supportBundle({ roots })
  writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  return { path: out, digest: sha256(readFileSync(out)), bundle }
}
