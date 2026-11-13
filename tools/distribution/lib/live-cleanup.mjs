/**
 * Probe-born live resource ownership and cleanup. A record is not ownership by itself: the exact
 * PID must still match its recorded start, UID and argv (install + config/data roots) before any
 * signal. Unknown discovery/stop keeps the private material; it is never converted into an empty set.
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const ps = (pid) => {
  const r = spawnSync('ps', ['-p', String(pid), '-o', 'ppid=,lstart=,uid=,command='], { encoding: 'utf8' })
  if (r.status !== 0 || !r.stdout.trim()) return null
  const line = r.stdout.trim(), m = line.match(/^(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d+:\d+:\d+\s+\d{4})\s+(\d+)\s+(.*)$/)
  if (!m) return null
  return { pid, ppid: Number(m[1]), startText: m[2], startMs: Date.parse(m[2]), uid: Number(m[3]), command: m[4] }
}

export function readBornRecord(configRoot) {
  try {
    const record = JSON.parse(readFileSync(join(configRoot, 'instance.json'), 'utf8'))
    if (!record?.pid || !record?.processStart) return null
    return { ...record, configRoot, recordedStartMs: Date.parse(record.processStart) }
  } catch { return null }
}

export async function waitBornRecord(configRoot, ms = 3000) {
  const end = Date.now() + ms
  while (Date.now() < end) { const record = readBornRecord(configRoot); if (record) return record; await new Promise((r) => setTimeout(r, 100)) }
  return null
}

/** Returns {owned:true} only when every recorded PID matches start/UID/argv/root/install/operation. */
export function verifyBornRecord(record, { cli, install, dataRoot, operation = 'start' }) {
  if (!record) return { owned: false, reason: 'record_missing' }
  const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && [a, a.replace(/^\/private/, ''), `/private${a}`].includes(b)
  if (record.state && !samePath(record.state, dataRoot)) return { owned: false, reason: 'root_mismatch', recorded: record.state, requested: dataRoot }
  const pids = [...new Set([record.pid, record.apiPid, record.consolePid].filter((value) => Number.isInteger(value) && value > 0))]
  if (pids.length === 0) return { owned: false, reason: 'pid_missing' }
  const checks = []
  for (const pid of pids) {
    const actual = ps(pid)
    if (actual === null) return { owned: false, reason: 'process_missing', pid, checks }
    const variants = (value) => [...new Set([value, value.replace(/^\/private/, ''), `/private${value}`, value.replace(/^\/private\/var\/folders/, '/var/folders'), value.replace(/^\/var\/folders/, '/private/var/folders')])]
    const includes = (value) => variants(value).some((candidate) => actual.command.includes(candidate))
    const startOk = Number.isFinite(record.recordedStartMs) && Math.abs(actual.startMs - record.recordedStartMs) <= 2000
    const uidOk = actual.uid === process.getuid()
    // The launcher must carry install/config/data/operation. A recorded API/console child is owned
    // only through its exact parent, start and UID plus the install/state paths it was born with.
    const isLauncher = pid === record.pid
    const argvOk = isLauncher ? includes(install) && includes(dataRoot) && includes(record.configRoot) && actual.command.includes(operation)
      : actual.ppid === record.pid && includes(install) && includes(dataRoot)
    checks.push({ pid, ppid: actual.ppid, startOk, uidOk, argvOk, isLauncher, command: actual.command.slice(0, 300) })
    if (!startOk || !uidOk || !argvOk) return { owned: false, reason: 'identity_mismatch', pid, checks }
  }
  return { owned: true, checks, operation, pids }
}

export async function cleanupBornResources({ cli, install, roots: { config, data }, records, args, env, operation = 'start', keepOnUnknown = true, allowDirectSignal = true }) {
  const report = { status: 'CLEAN', stopped: [], unknown: [], retained: false }
  for (const record of records.filter(Boolean)) {
    const proof = verifyBornRecord(record, { cli, install, dataRoot: data, operation })
    if (!proof.owned) {
      report.status = 'UNKNOWN'; report.unknown.push({ pid: record.pid ?? null, reason: proof.reason, detail: proof }); continue
    }
    const stop = spawnSync(cli, ['stop', '--json', ...args], { encoding: 'utf8', timeout: 60_000, env })
    let stopped = false
    const gone = () => proof.pids.every((pid) => ps(pid) === null)
    const waitGone = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (gone()) return true; await new Promise((r) => setTimeout(r, 150)) } return gone() }
    stopped = await waitGone(8000)
    let method = 'cli-stop'
    // The CLI may legitimately refuse a mode/record mismatch; after the complete born-identity proof
    // above, only these exact PIDs are signalled, and only then is the material considered cleanable.
    if (!stopped && proof.owned && allowDirectSignal) {
      method = 'proven-direct-signal'
      for (const pid of proof.pids) { try { process.kill(pid, 'SIGTERM') } catch {} }
      stopped = await waitGone(3000)
      if (!stopped) { for (const pid of proof.pids) { try { process.kill(pid, 'SIGKILL') } catch {} } stopped = await waitGone(1500) }
    }
    if (!stopped) { report.status = 'UNKNOWN'; report.unknown.push({ pid: record.pid, reason: 'stop_unconfirmed', stopStatus: stop.status, stdout: stop.stdout?.slice(0, 300), proof }); continue }
    report.stopped.push({ pid: record.pid, pids: proof.pids, operation, method })
  }
  if (report.unknown.length > 0 && keepOnUnknown) report.retained = true
  return report
}
