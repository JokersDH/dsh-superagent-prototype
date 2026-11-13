/**
 * Non-secret launcher configuration kept in the private config root. It records resolved roots and
 * defaults only: no API key, model key, bootstrap token, native session, or account home is ever
 * written here, and the file is not part of a backup bundle.
 */
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PortabilityError } from '@personal-agent/portability'

export const LAUNCHER_CONFIG_PROTOCOL = 'personal-launcher/1'
export const LAUNCHER_CONFIG_FILE = 'launcher.json'
const ROOT_NAMES = ['install', 'config', 'data', 'cache', 'logs', 'workspace']

export function launcherConfigPath(configRoot) {
  return join(configRoot, LAUNCHER_CONFIG_FILE)
}

export function validateLauncherConfig(value) {
  const fail = (message) => {
    throw new PortabilityError('manifest_invalid', message)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('Launcher config must be an object')
  if (value.protocol !== LAUNCHER_CONFIG_PROTOCOL) fail('Launcher config protocol is not supported')
  if (typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))) fail('Launcher config createdAt is invalid')
  if (typeof value.roots !== 'object' || value.roots === null) fail('Launcher config roots are missing')
  const roots = {}
  for (const name of ROOT_NAMES) {
    const selected = value.roots[name]
    if (typeof selected !== 'string' || resolve(selected) !== selected) fail(`Launcher root ${name} must be absolute`)
    roots[name] = selected
  }
  return {
    protocol: LAUNCHER_CONFIG_PROTOCOL,
    createdAt: value.createdAt,
    roots,
  }
}

export function readLauncherConfig(configRoot) {
  const path = launcherConfigPath(configRoot)
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
    throw new PortabilityError('unsafe_root', 'Launcher config file is unsafe', { path })
  try {
    return validateLauncherConfig(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    if (error instanceof PortabilityError) throw error
    throw new PortabilityError('manifest_invalid', 'Launcher config is not valid JSON', { cause: error.message })
  }
}

export function writeLauncherConfig(configRoot, roots, now = new Date()) {
  const config = validateLauncherConfig({
    protocol: LAUNCHER_CONFIG_PROTOCOL,
    createdAt: now.toISOString(),
    roots: Object.fromEntries(ROOT_NAMES.map((name) => [name, roots[name]])),
  })
  const path = launcherConfigPath(configRoot)
  const temporary = `${path}.${process.pid}.tmp`
  const bytes = Buffer.from(`${JSON.stringify(config, null, 2)}\n`)
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
  return { path, config }
}
