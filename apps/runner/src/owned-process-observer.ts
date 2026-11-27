/** Read-only, bounded observations of an ORIGINAL known PID/group. Never global discovery. */
import { execFileSync } from 'node:child_process'
import { readFileSync, readlinkSync } from 'node:fs'

export type ProcessSnapshot = {
  pid: number; parentPid: number; groupId: number; uid: number
  startMarker: string; executable: string; argv0: string; argv: readonly string[]; cwd: string; state: string
}
export type ProcessObservation = { kind: 'observed'; process: ProcessSnapshot } | { kind: 'unknown'; reason: string }
export type GroupObservation = { kind: 'observed'; pids: readonly number[] } | { kind: 'unknown'; reason: string }
export type OwnedProcessObserver = {
  process(pid: number): ProcessObservation
  group(groupId: number): GroupObservation
}
export type ObservationCommandResult = { status: number | null; stdout: Uint8Array; stderr: Uint8Array; failed?: boolean }
export type ObservationCommand = (executable: string, argv: readonly string[], limits?: { timeoutMs: number }) => ObservationCommandResult

const validPid = (pid: number) => Number.isSafeInteger(pid) && pid > 1
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes)
const unknown = (reason: string): ProcessObservation => ({ kind: 'unknown', reason })

function execute(executable: string, argv: readonly string[], limits?: { timeoutMs: number }): ObservationCommandResult {
  try {
    const stdout = execFileSync(executable, [...argv], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024, timeout: Math.max(1, Math.min(1200, limits?.timeoutMs ?? 1200)),
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', LC_ALL: 'C' } })
    return { status: 0, stdout, stderr: new Uint8Array() }
  } catch (error) {
    return failedObservationCommand(error)
  }
}
/** Normal exit-status errors have signal:null; that is distinct from timeout/spawn failure. */
export function failedObservationCommand(error: unknown): ObservationCommandResult {
  const failure = error as { status?: number | null; stdout?: Uint8Array; stderr?: Uint8Array; code?: string; signal?: string | null }
  return { status: failure.status ?? null, stdout: failure.stdout ?? new Uint8Array(), stderr: failure.stderr ?? new Uint8Array(),
    failed: failure.signal != null || (failure.code !== undefined && failure.status == null) }
}

/** KERN_PROCARGS2 includes environment bytes; the fixed reader emits ONLY argc argv/executable. */
export const MAC_PROCESS_ARGUMENTS_READER = String.raw`import ctypes, json, struct, sys
pid = int(sys.argv[1])
if pid <= 1: raise SystemExit(2)
lib = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
mib = (ctypes.c_int * 3)(1, 49, pid)
size = ctypes.c_size_t(0)
if lib.sysctl(mib, 3, None, ctypes.byref(size), None, 0) != 0: raise SystemExit(3)
if size.value < 5 or size.value > 8 * 1024 * 1024: raise SystemExit(4)
buf = ctypes.create_string_buffer(size.value)
if lib.sysctl(mib, 3, buf, ctypes.byref(size), None, 0) != 0: raise SystemExit(5)
raw = buf.raw[:size.value]
argc = struct.unpack_from('=i', raw, 0)[0]
if argc < 1 or argc > 1024: raise SystemExit(6)
pos = raw.find(b'\0', 4)
if pos < 5: raise SystemExit(7)
executable = raw[4:pos].decode('utf-8', 'strict')
pos += 1
while pos < len(raw) and raw[pos] == 0: pos += 1
args = []
for _ in range(argc):
    end = raw.find(b'\0', pos)
    if end < 0: raise SystemExit(8)
    args.append(raw[pos:end].decode('utf-8', 'strict'))
    pos = end + 1
print(json.dumps({'executable': executable, 'argv0': args[0], 'argv': args[1:]}, ensure_ascii=True))
`

function macMeta(pid: number, command: ObservationCommand): Omit<ProcessSnapshot, 'executable' | 'argv0' | 'argv' | 'cwd'> | undefined {
  const result = command('/bin/ps', ['-p', String(pid), '-o', 'pid=,ppid=,pgid=,uid=,lstart=,stat='])
  if (result.status !== 0 || result.failed) return undefined
  const text = decode(result.stdout)
  const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s*$/u.exec(text)
  if (!match || Number(match[1]) !== pid) return undefined
  return { pid, parentPid: Number(match[2]), groupId: Number(match[3]), uid: Number(match[4]),
    startMarker: match[5]!.replace(/\s+/gu, ' '), state: match[6]! }
}
function macArguments(pid: number, command: ObservationCommand): Pick<ProcessSnapshot, 'executable' | 'argv0' | 'argv'> | undefined {
  const result = command('/usr/bin/python3', ['-c', MAC_PROCESS_ARGUMENTS_READER, String(pid)])
  if (result.status !== 0 || result.failed) return undefined
  const value = JSON.parse(decode(result.stdout)) as Record<string, unknown>
  if (typeof value.executable !== 'string' || !value.executable.startsWith('/') || typeof value.argv0 !== 'string' ||
      !Array.isArray(value.argv) || value.argv.length > 1024 || value.argv.some(item => typeof item !== 'string' || item.includes('\0')))
    return undefined
  return { executable: value.executable, argv0: value.argv0, argv: value.argv as string[] }
}
function macCwd(pid: number, command: ObservationCommand): string | undefined {
  const result = command('/usr/sbin/lsof', ['-nP', '-a', '-p', String(pid), '-d', 'cwd', '-F0pfn'])
  if (result.status !== 0 || result.failed) return undefined
  const fields = decode(result.stdout).split('\0').map(field => field.replace(/^\n+/u, '')).filter(Boolean)
  const pids = fields.filter(field => field.startsWith('p')).map(field => Number(field.slice(1)))
  const files = fields.filter(field => field.startsWith('f'))
  const names = fields.filter(field => field.startsWith('n')).map(field => field.slice(1))
  if (pids.length !== 1 || pids[0] !== pid || files.length !== 1 || files[0] !== 'fcwd' || names.length !== 1 || !names[0]!.startsWith('/')) return undefined
  return names[0]
}
function sameMeta(left: NonNullable<ReturnType<typeof macMeta>>, right: NonNullable<ReturnType<typeof macMeta>>): boolean {
  return left.pid === right.pid && left.parentPid === right.parentPid && left.groupId === right.groupId && left.uid === right.uid && left.startMarker === right.startMarker
}
function macProcess(pid: number, command: ObservationCommand): ProcessObservation {
  try {
    const before = macMeta(pid, command), args = macArguments(pid, command), cwd = macCwd(pid, command)
    const middle = macMeta(pid, command), againArgs = macArguments(pid, command), againCwd = macCwd(pid, command), after = macMeta(pid, command)
    if (!before || !middle || !after || !args || !againArgs || cwd === undefined || againCwd === undefined) return unknown('pid_identity_unobserved')
    if (!sameMeta(before, middle) || !sameMeta(middle, after) || JSON.stringify(args) !== JSON.stringify(againArgs) || cwd !== againCwd) return unknown('pid_identity_changed_during_observation')
    return { kind: 'observed', process: { ...after, ...againArgs, cwd: againCwd } }
  } catch { return unknown('pid_identity_observation_failed') }
}
function linuxProcess(pid: number): ProcessObservation {
  try {
    const snapshot = (): ProcessSnapshot => {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'), close = stat.lastIndexOf(')')
      if (close < 0 || Number(stat.slice(0, stat.indexOf(' '))) !== pid) throw new Error('invalid_proc_stat')
      const fields = stat.slice(close + 2).trim().split(/\s+/u)
      const uid = /^Uid:\s+\d+\s+(\d+)/mu.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))
      const raw = decode(readFileSync(`/proc/${pid}/cmdline`)), argv = raw.split('\0')
      if (!raw.endsWith('\0') || !uid || !fields[19]) throw new Error('incomplete_proc_identity')
      argv.pop()
      if (argv.length === 0 || argv.length > 1025) throw new Error('invalid_proc_argv')
      return { pid, parentPid: Number(fields[1]), groupId: Number(fields[2]), uid: Number(uid[1]), state: fields[0]!,
        startMarker: `linux-start:${fields[19]}`, executable: readlinkSync(`/proc/${pid}/exe`), argv0: argv[0]!, argv: argv.slice(1), cwd: readlinkSync(`/proc/${pid}/cwd`) }
    }
    const first = snapshot(), second = snapshot()
    const { state: _a, ...a } = first, { state: _b, ...b } = second
    return JSON.stringify(a) === JSON.stringify(b) ? { kind: 'observed', process: second } : unknown('pid_identity_changed_during_observation')
  } catch { return unknown('pid_identity_unobserved') }
}

export function createTargetedProcessObserver(options: { platform?: string; command?: ObservationCommand } = {}): OwnedProcessObserver {
  const platform = options.platform ?? process.platform, command = options.command ?? execute
  return {
    process(pid) {
      if (!validPid(pid)) return unknown('invalid_original_pid')
      if (platform === 'darwin') {
        const deadline = Date.now() + 2000
        return macProcess(pid, (executable, argv) => {
          const remaining = deadline - Date.now()
          return remaining > 0 ? command(executable, argv, { timeoutMs: remaining })
            : { status: null, stdout: new Uint8Array(), stderr: new Uint8Array(), failed: true }
        })
      }
      if (platform === 'linux') return linuxProcess(pid)
      return unknown('platform_identity_unavailable')
    },
    group(groupId) {
      if (!validPid(groupId)) return { kind: 'unknown', reason: 'invalid_original_group' }
      try {
        const result = command('/usr/bin/pgrep', ['-g', String(groupId)])
        // Fixed pgrep's documented status 1 means no matches, not an arbitrary command failure.
        if (result.status === 1 && !result.failed && result.stdout.length === 0 && result.stderr.length === 0)
          return { kind: 'observed', pids: [] }
        if (result.status !== 0 || result.failed || result.stdout.length > 64 * 1024) return { kind: 'unknown', reason: 'group_query_failed' }
        const lines = decode(result.stdout).trim().split('\n')
        if (lines.length === 0 || lines.length > 1024 || lines.some(line => !/^\d+$/u.test(line))) return { kind: 'unknown', reason: 'group_query_malformed' }
        const pids = lines.map(Number)
        if (pids.some(pid => !validPid(pid)) || new Set(pids).size !== pids.length) return { kind: 'unknown', reason: 'group_query_malformed' }
        return { kind: 'observed', pids: pids.sort((a, b) => a - b) }
      } catch { return { kind: 'unknown', reason: 'group_query_unobserved' } }
    },
  }
}
