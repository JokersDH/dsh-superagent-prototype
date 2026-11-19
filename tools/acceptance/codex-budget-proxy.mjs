// Transparent probe transport. Counts only turn/start bytes actually written to the real Codex CLI.
import { spawn } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'

const [executable, ledger, grant, limitText, taskId] = process.argv.slice(2)
const limit = Number(limitText)
if (!executable || !ledger || !grant || !taskId || !Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid explicit probe grant')
const log = (kind, detail = '') => appendFileSync(ledger, [new Date().toISOString(), grant, taskId, kind, detail].join('\t') + '\n', { mode: 0o600 })
const used = () => readFileSync(ledger, 'utf8').split('\n').filter(line => line.split('\t')[1] === grant && line.split('\t')[3] === 'SENT_TURN').length
const child = spawn(executable, ['app-server', '--disable', 'apps', '-c', 'mcp_servers={}'], { stdio: ['pipe', 'pipe', 'pipe'] })
log('CODEX_PROCESS', String(child.pid))
child.stdout.pipe(process.stdout)
child.stderr.pipe(process.stderr)
process.stdout.on('error', () => {})
let serverBuffer = ''
child.stdout.on('data', chunk => {
  serverBuffer += chunk.toString()
  for (;;) {
    const at = serverBuffer.indexOf('\n'); if (at < 0) break
    const line = serverBuffer.slice(0, at); serverBuffer = serverBuffer.slice(at + 1)
    try {
      const message = JSON.parse(line)
      if (message.method === 'item/tool/requestUserInput' || message.method?.endsWith('requestApproval')) log('NATIVE_REQUEST', message.method)
      if (message.method === 'turn/completed') log('TURN_COMPLETED', String(message.params?.turn?.status))
    } catch {}
  }
})
let buffer = '', sending = false
const pending = []
const drain = () => {
  if (sending || pending.length === 0) return
  sending = true
  const raw = pending.shift()
  let message
  try { message = JSON.parse(raw) } catch { sending = false; throw new Error('Probe received invalid protocol frame') }
  const isTurn = message.method === 'turn/start'
  if (isTurn && used() >= limit) { log('BUDGET_REFUSED'); process.stdin.pause(); child.stdin.end(); return }
  const bytes = raw + '\n'
  if (isTurn) log('TURN_WRITE_INTENT', String(message.id))
  child.stdin.write(bytes, error => {
    if (error) { log(isTurn ? 'UNKNOWN_TURN_WRITE' : 'WRITE_FAILED', String(error.code)); return }
    if (isTurn) log('SENT_TURN', String(message.id))
    else if (message.method === 'turn/steer' || message.method === 'turn/interrupt') log(message.method, String(message.id))
    else if (!message.method && message.id !== undefined && message.result) log('SERVER_REPLY', String(message.id))
    sending = false; drain()
  })
}
process.stdin.on('data', chunk => {
  buffer += chunk.toString()
  for (;;) { const at = buffer.indexOf('\n'); if (at < 0) break; pending.push(buffer.slice(0, at)); buffer = buffer.slice(at + 1) }
  drain()
})
process.stdin.on('end', () => child.stdin.end())
child.once('error', error => { log('SPAWN_FAILED', String(error.code)); process.exitCode = 1 })
child.once('exit', (code, signal) => { log('CODEX_EXIT', JSON.stringify({ code, signal })); process.stdin.destroy(); process.exit(code ?? 0) })
process.once('SIGTERM', () => { log('PROXY_TERM'); child.stdin.end() })
