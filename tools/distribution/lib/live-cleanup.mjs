/**
 * Probe-born live resource registry and cleanup (wave-24).
 *
 * Registration happens immediately after spawn, before any waitHealth. A record is never ownership
 * by itself: launcher and each child carry their own birth PID/start/UID/role/argv/root/config/
 * operation. Paths are compared as exact normalized tokens, never substrings. Every direct signal is
 * preceded by a fresh full identity read. Missing/unknown evidence stays UNKNOWN and keeps material.
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const tokenize = (command) => (command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((t) => t.replace(/^['"]|['"]$/g, ''))
const norm = (p) => typeof p === 'string' ? (p.startsWith('/private/') ? p.slice('/private'.length) : p) : null
const samePath = (a, b) => norm(a) !== null && norm(b) !== null && norm(a) === norm(b)

export function processSnapshot(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null
  const r = spawnSync('ps', ['-p', String(pid), '-o', 'ppid=,stat=,lstart=,uid=,command='], { encoding: 'utf8' })
  if (r.status !== 0 || !r.stdout.trim()) return null
  const line = r.stdout.trim(), m = line.match(/^(\d+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d+:\d+:\d+\s+\d{4})\s+(\d+)\s+(.*)$/)
  if (!m) return null
  const state = m[2]
  return { pid, ppid: Number(m[1]), stat: state, live: !state.startsWith('Z'), startText: m[3], startMs: Date.parse(m[3]), uid: Number(m[4]), command: m[5], tokens: tokenize(m[5]) }
}

/** Register the spawn handle immediately; start/UID may be null, which remains explicit UNKNOWN. */
export function registerSpawn({ pid, install, config, data, operation = 'start' }) {
  const actual = processSnapshot(pid)
  return {
    id: `probe-launcher-${pid}-${Date.now()}`,
    role: 'launcher', operation, pid: Number(pid) || null,
    install: norm(install), config: norm(config), data: norm(data),
    processStart: actual?.startText ?? null, recordedStartMs: actual?.startMs ?? null,
    uid: actual?.uid ?? null, observedAt: new Date().toISOString(),
    instanceMissing: true, children: [],
  }
}

/** Read the instance record if it appeared; children receive their own observed start/UID/role. */
export async function supplementBornRecord(record, configRoot, ms = 0) {
  const end = Date.now() + ms
  let raw = null
  while (true) {
    try { raw = JSON.parse(readFileSync(join(configRoot, 'instance.json'), 'utf8')) } catch { raw = null }
    if (raw?.pid || Date.now() >= end) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const result = { ...record, config: norm(configRoot), instanceMissing: !raw?.pid }
  if (!raw?.pid) return result
  const launcher = processSnapshot(raw.pid)
  result.instancePid = raw.pid
  result.instanceProcessStart = raw.processStart ?? null
  result.processStart = launcher?.startText ?? result.processStart
  result.recordedStartMs = launcher?.startMs ?? result.recordedStartMs
  result.uid = launcher?.uid ?? result.uid
  const children = []
  const add = (pidValue, startValue, role) => {
    if (!Number.isInteger(pidValue) || pidValue <= 0 || pidValue === raw.pid) return
    const snap = processSnapshot(pidValue)
    const tokens = snap?.tokens ?? null
    const entryToken = role === 'api' ? tokens?.find((t) => t.endsWith('/demo.ts') || t === 'demo.ts') ?? null
      : tokens?.find((t) => t.endsWith('/pa.mjs') || t.endsWith('/bin/pa')) ?? null
    const modeIndex = tokens ? tokens.indexOf('--startup-mode') : -1
    children.push({ role, pid: pidValue, processStart: startValue ?? snap?.startText ?? null,
      recordedStartMs: startValue ? Date.parse(startValue) : (snap?.startMs ?? null), uid: snap?.uid ?? null,
      config: norm(configRoot), entry: entryToken, operation: modeIndex >= 0 ? tokens[modeIndex + 1] ?? null : null,
      capturedTokens: tokens, observedAt: new Date().toISOString(), snapshotTokens: tokens })
  }
  add(raw.apiPid, raw.apiProcessStart, 'api')
  add(raw.consolePid, raw.consoleProcessStart, 'console')
  result.children = children
  return result
}

export function readBornRecord(configRoot) {
  try {
    const raw = JSON.parse(readFileSync(join(configRoot, 'instance.json'), 'utf8'))
    if (!raw?.pid || !raw?.processStart) return null
    const snap = processSnapshot(raw.pid)
    return { pid: raw.pid, configRoot, processStart: raw.processStart, recordedStartMs: Date.parse(raw.processStart), uid: snap?.uid ?? null, children: [], instanceMissing: false, raw }
  } catch { return null }
}

export async function waitBornRecord(configRoot, ms = 3000) {
  const spawned = registerSpawn({ pid: 0, install: '', config: configRoot, data: '' })
  return supplementBornRecord(spawned, configRoot, ms)
}

const hasPathToken = (tokens, value) => tokens.some((token) => samePath(token, value))
const hasUnderToken = (tokens, root) => tokens.some((token) => { const a = norm(token), b = norm(root); return a === b || (a && b && a.startsWith(`${b}/`)) })
const hasToken = (tokens, value) => tokens.includes(value)

function verifyOne(resource, expectedRole, { install, data, operation, parentConfig }) {
  if (!resource || resource.unknown || !resource.pid || !resource.recordedStartMs || !resource.processStart) return { owned: false, reason: 'birth_identity_missing', resource }
  const actual = processSnapshot(resource.pid)
  if (!actual || !actual.live) return { owned: false, reason: 'process_missing', pid: resource.pid }
  const startOk = Number.isFinite(resource.recordedStartMs) && actual.startMs === resource.recordedStartMs
  const uidOk = resource.uid === null ? false : actual.uid === resource.uid
  const roleOk = resource.role === expectedRole
  const isLauncher = expectedRole === 'launcher'
  const operationOk = isLauncher ? resource.operation === operation : (resource.operation !== null && resource.operation !== undefined)
  const tokenInstall = isLauncher ? hasPathToken(actual.tokens, install) : hasUnderToken(actual.tokens, install)
  const tokenData = isLauncher ? hasPathToken(actual.tokens, data) : (hasPathToken(actual.tokens, data) || hasUnderToken(actual.tokens, data))
  const tokenConfig = isLauncher ? hasPathToken(actual.tokens, resource.config) : samePath(resource.config, parentConfig)
  const captured = Array.isArray(resource.capturedTokens) ? resource.capturedTokens.map((token) => norm(token) ?? token) : null
  const current = actual.tokens.map((token) => norm(token) ?? token)
  const argvExact = isLauncher ? true : captured !== null && captured.length === current.length && captured.every((token, index) => token === current[index])
  const modeIndex = current.indexOf('--startup-mode')
  const operationCurrent = isLauncher ? hasToken(actual.tokens, 'start') : modeIndex >= 0 && current[modeIndex + 1] === resource.operation
  const entryOk = isLauncher ? true : (resource.entry === null ? false : current.some((token) => token === norm(resource.entry) || norm(token) === norm(resource.entry)))
  const argvOk = tokenInstall && tokenData && tokenConfig && argvExact && operationCurrent && entryOk
  const evidence = { pid: resource.pid, role: resource.role, startOk, uidOk, roleOk, operationOk, tokenInstall, tokenData, tokenConfig, argvExact, operationCurrent, entryOk, argvOk, actual }
  return { owned: startOk && uidOk && roleOk && operationOk && argvOk, reason: 'exact_identity', evidence }
}

export function verifyBornRecord(record, { install, dataRoot, operation = 'start' }) {
  if (!record) return { owned: false, reason: 'record_missing' }
  if (record.data && !samePath(record.data, dataRoot)) return { owned: false, reason: 'root_mismatch', recorded: record.data, requested: dataRoot }
  const parentConfig = record.config ?? record.configRoot
  const launcher = verifyOne({ ...record, role: 'launcher', config: parentConfig }, 'launcher', { install, data: dataRoot, operation, parentConfig })
  if (!launcher.owned) return launcher
  const children = (record.children ?? []).map((child) => verifyOne(child, child.role, { install, data: dataRoot, operation, parentConfig }))
  const bad = children.find((child) => !child.owned)
  if (bad) return bad
  return { owned: children.length === 0 || children.every((c) => c.owned), checks: [launcher, ...children], pids: [record.pid, ...(record.children ?? []).map((c) => c.pid)] }
}

/** Freshly re-verify every PID immediately before any signal. */
function freshProof(record, options) {
  const proof = verifyBornRecord(record, options)
  if (!proof.owned) return proof
  const fresh = (record.children ?? []).every((child) => {
    const now = processSnapshot(child.pid)
    return now && now.startMs === child.recordedStartMs && now.uid === child.uid
  })
  const launcher = processSnapshot(record.pid)
  const nowLauncher = launcher && launcher.startMs === record.recordedStartMs && launcher.uid === record.uid
  return fresh && nowLauncher ? proof : { owned: false, reason: 'identity_changed_before_signal' }
}

export async function cleanupBornResources({ cli, install, roots: { config, data }, records, args, env, operation = 'start', allowDirectSignal = true }) {
  const report = { status: 'CLEAN', stopped: [], unknown: [], retained: false, signals: [] }
  const list = Array.isArray(records) ? records : []
  if (list.length === 0) { report.status = 'UNKNOWN'; report.unknown.push({ reason: 'no_probe_record' }); report.retained = true; return report }
  for (const record of list) {
    if (!record) { report.status = 'UNKNOWN'; report.unknown.push({ reason: 'record_missing_in_mixed_set' }); continue }
    const proof = verifyBornRecord(record, { install, dataRoot: data, operation })
    if (!proof.owned) { report.status = 'UNKNOWN'; report.unknown.push({ pid: record.pid ?? null, reason: proof.reason, proof }); continue }
    const stop = spawnSync(cli, ['stop', '--json', ...args], { encoding: 'utf8', timeout: 60_000, env })
    const waitGone = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (proof.pids.every((pid) => { const snap = processSnapshot(pid); return snap === null || !snap.live })) return true; await new Promise((r) => setTimeout(r, 150)) } return proof.pids.every((pid) => { const snap = processSnapshot(pid); return snap === null || !snap.live }) }
    let stopped = await waitGone(8000), method = 'cli-stop'
    if (!stopped && allowDirectSignal) {
      method = record.instanceMissing ? 'proven-spawn-group-signal' : 'proven-direct-signal'
      // A spawn-before-record fault has no child identities. Its detached process group was created
      // by this exact spawn, so the group is signalled only after the launcher's fresh full proof.
      const targets = record.instanceMissing ? [-record.pid] : record.pids ?? [record.pid, ...(record.children ?? []).map((c) => c.pid)]
      const signalFresh = (pid, signal) => {
        if (record.instanceMissing) {
          if (pid !== -record.pid) return { ok: false, reason: 'group_target_mismatch' }
          const fresh = freshProof(record, { install, dataRoot: data, operation })
          if (!fresh.owned) return { ok: false, reason: fresh.reason, fresh }
          try { process.kill(pid, signal); return { ok: true, fresh } } catch (error) { return { ok: false, reason: String(error?.code ?? error) } }
        }
        const parentConfig = record.config ?? record.configRoot
        if (pid === record.pid) {
          const fresh = freshProof({ ...record, children: [] }, { install, dataRoot: data, operation })
          if (!fresh.owned) return { ok: false, reason: fresh.reason, fresh }
          try { process.kill(pid, signal); return { ok: true, fresh } } catch (error) { return { ok: false, reason: String(error?.code ?? error) } }
        }
        const child = (record.children ?? []).find((c) => c.pid === pid)
        if (!child) return { ok: false, reason: 'child_not_registered', pid }
        const fresh = verifyOne(child, child.role, { install, data: data, operation, parentConfig })
        if (!fresh.owned) return { ok: false, reason: fresh.reason, fresh }
        try { process.kill(pid, signal); return { ok: true, fresh } } catch (error) { return { ok: false, reason: String(error?.code ?? error) } }
      }
      for (const pid of targets) { const attempt = signalFresh(pid, 'SIGTERM'); report.signals.push({ pid, signal: 'SIGTERM', ...attempt }) }
      stopped = await waitGone(5000)
      if (!stopped) {
        for (const pid of targets) { const attempt = signalFresh(pid, 'SIGKILL'); report.signals.push({ pid, signal: 'SIGKILL', ...attempt }) }
        if (report.signals.some((item) => item.signal === 'SIGKILL' && !item.ok)) { report.status = 'UNKNOWN'; report.unknown.push({ pid: record.pid, reason: 'kill_identity_recheck_failed', signals: report.signals.filter((s) => s.signal === 'SIGKILL') }); continue }
        stopped = await waitGone(3000)
      }
    }
    if (!stopped) { report.status = 'UNKNOWN'; report.unknown.push({ pid: record.pid, reason: 'stop_unconfirmed', stdout: stop.stdout?.slice(0, 300), proof }); continue }
    report.stopped.push({ pid: record.pid, pids: proof.pids, operation, method })
    if (record.instanceMissing) { report.status = 'UNKNOWN'; report.unknown.push({ pid: record.pid, reason: 'instance_record_missing' }) }
  }
  if (report.unknown.length > 0) report.retained = true
  return report
}
