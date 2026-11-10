import { execFile } from 'node:child_process'
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const owned = (stat) => !process.getuid || stat.uid === process.getuid()

export class InstanceUnavailable extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

/** Read existing operator state without creating credentials, following links or returning raw errors. */
export function readPrivateState(state, name, maxBytes = 16384) {
  if (!/^[a-z][a-z.-]+$/.test(name)) throw new InstanceUnavailable('invalid_state_name')
  let descriptor
  try {
    const directory = lstatSync(state)
    if (!directory.isDirectory() || directory.isSymbolicLink() || !owned(directory) || directory.mode & 0o077)
      throw new InstanceUnavailable('unsafe_state_directory')
    descriptor = openSync(join(state, name), constants.O_RDONLY | constants.O_NOFOLLOW)
    const stat = fstatSync(descriptor)
    if (!stat.isFile() || !owned(stat) || stat.mode & 0o077 || stat.size > maxBytes)
      throw new InstanceUnavailable('unsafe_state_file')
    const bytes = Buffer.alloc(maxBytes + 1)
    let length = 0
    for (;;) {
      const count = readSync(descriptor, bytes, length, bytes.length - length)
      if (!count) break
      length += count
      if (length > maxBytes) throw new InstanceUnavailable('state_file_too_large')
    }
    return bytes.subarray(0, length).toString('utf8')
  } catch (error) {
    if (error instanceof InstanceUnavailable) throw error
    throw new InstanceUnavailable(error.code === 'ENOENT' ? 'state_missing' : 'state_unreadable')
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/** Numeric loopback origins avoid DNS and never accept credentials, paths or redirects. */
export function localOrigin(value) {
  let url
  try { url = new URL(value) } catch { throw new InstanceUnavailable('invalid_local_origin') }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.origin !== value ||
      url.username || url.password || !url.port)
    throw new InstanceUnavailable('invalid_local_origin')
  return url.origin
}

export function readInstanceRecord(state) {
  let record
  try { record = JSON.parse(readPrivateState(state, 'workbench.json')) }
  catch (error) {
    if (error instanceof InstanceUnavailable) throw error
    throw new InstanceUnavailable('invalid_instance_record')
  }
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      ![record.pid, record.apiPid, record.consolePid].every((pid) => Number.isSafeInteger(pid) && pid > 1) ||
      (record.protocol !== undefined && record.protocol !== 'personal-workbench/1') ||
      (record.protocol !== undefined && (!['fixture', 'personal'].includes(record.mode) || !record.processStart)) ||
      (record.processStart !== undefined && (typeof record.processStart !== 'string' || record.processStart.length > 128)))
    throw new InstanceUnavailable('invalid_instance_record')
  localOrigin(record.apiURL)
  localOrigin(record.consoleURL)
  if (record.apiURL === record.consoleURL) throw new InstanceUnavailable('invalid_instance_record')
  return record
}

async function command(file, argv) {
  try {
    return (await execute(file, argv, { timeout: 1500, maxBuffer: 65536, encoding: 'utf8' })).stdout.trim()
  } catch {
    throw new InstanceUnavailable('process_identity_unproven')
  }
}

export async function processStart(pid = process.pid) {
  return command('ps', ['-p', String(pid), '-o', 'lstart='])
}

export async function verifyLauncher(root, record) {
  const [cwd, argv, start, uid] = await Promise.all([
    command('lsof', ['-a', '-p', String(record.pid), '-d', 'cwd', '-Fn']),
    command('ps', ['-ww', '-p', String(record.pid), '-o', 'command=']),
    processStart(record.pid),
    command('ps', ['-p', String(record.pid), '-o', 'uid=']),
  ])
  const canonicalRoot = realpathSync(root)
  if (!cwd.split('\n').includes(`n${canonicalRoot}`) ||
      !/(?:^|[\s/])tools\/dev\/(?:start|workbench)\.mjs(?:\s|$)/.test(argv) ||
      (process.getuid && Number(uid) !== process.getuid()) ||
      (record.processStart !== undefined && record.processStart !== start))
    throw new InstanceUnavailable('process_identity_mismatch')
  return { start, legacy: record.protocol === undefined }
}

async function verifyListener(pid, origin, parentPid) {
  const port = new URL(localOrigin(origin)).port
  const [output, identity] = await Promise.all([
    command('lsof', ['-a', '-p', String(pid), '-iTCP:' + port, '-sTCP:LISTEN', '-Fn']),
    command('ps', ['-p', String(pid), '-o', 'ppid=', '-o', 'uid=']),
  ])
  const [parent, uid] = identity.split(/\s+/).map(Number)
  if (!output.split('\n').includes(`p${pid}`) || parent !== parentPid || (process.getuid && uid !== process.getuid()))
    throw new InstanceUnavailable('listener_identity_mismatch')
}

export async function localJson(origin, path, { bearer, timeoutMs = 2000, maxBytes = 262144 } = {}) {
  localOrigin(origin)
  if (!/^\/v1\/[a-z]+$/.test(path) && !/^\/v1\/works\/[A-Za-z0-9._:%-]{1,768}\/environment$/.test(path)) throw new InstanceUnavailable('invalid_read_path')
  const signal = AbortSignal.timeout(timeoutMs)
  let response
  try {
    response = await fetch(origin + path, {
      method: 'GET', redirect: 'error', signal,
      headers: { accept: 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    })
    if (!response.ok) throw new InstanceUnavailable(response.status === 401 ? 'authentication_failed' : 'api_read_failed')
    if (!response.headers.get('content-type')?.includes('application/json')) throw new InstanceUnavailable('invalid_api_response')
    const reader = response.body.getReader()
    const parts = []
    let bytes = 0
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > maxBytes) throw new InstanceUnavailable('api_response_too_large')
        parts.push(value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    return JSON.parse(Buffer.concat(parts).toString('utf8'))
  } catch (error) {
    if (error instanceof InstanceUnavailable) throw error
    throw new InstanceUnavailable(signal.aborted ? 'api_timeout' : 'api_unavailable')
  }
}

/** Confirm the recorded launcher and both listeners before sending this state's credential. */
export async function probeInstance({ root, state, expectedMode, parseConfiguration }) {
  const record = readInstanceRecord(state)
  const identity = await verifyLauncher(root, record)
  await Promise.all([verifyListener(record.apiPid, record.apiURL, record.pid), verifyListener(record.consolePid, record.consoleURL, record.pid)])
  const health = await localJson(record.apiURL, '/v1/health')
  if (!health || health.status !== 'ok' || !['personal', 'fixture', 'product'].includes(health.mode))
    throw new InstanceUnavailable('invalid_health_response')
  if (expectedMode && health.mode !== expectedMode) throw new InstanceUnavailable('instance_mode_mismatch')
  if (record.protocol && record.mode !== health.mode) throw new InstanceUnavailable('instance_mode_mismatch')
  const bearer = readPrivateState(state, 'api.key', 64)
  if (!/^[a-f0-9]{64}$/.test(bearer)) throw new InstanceUnavailable('invalid_credential')
  const configuration = await localJson(record.apiURL, '/v1/configuration', { bearer })
  const parsed = parseConfiguration(configuration)
  return {
    record, identity, health, configuration: parsed,
    read: (path) => localJson(record.apiURL, path, { bearer }),
  }
}

export function instanceState(root, value) {
  return value ? (isAbsolute(value) ? resolve(value) : resolve(root, value)) : join(root, '.local-state/workbench')
}
