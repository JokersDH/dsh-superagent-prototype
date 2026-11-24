// Acceptance-only transparent stdio observer. No Driver, policy, business command or reply is added.
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'

export function runForwarder(configPath, argv) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  if (!config.executable || !config.ledger || !config.activeTask || !config.grant || config.cap !== 2)
    throw new Error('Invalid explicit acceptance grant')
  if (argv[0] !== 'app-server') {
    if (!(argv.length === 1 && argv[0] === '--version') && !(argv.length === 2 && argv[0] === 'login' && argv[1] === 'status'))
      throw new Error('Only the original version/login inspections and app-server are admitted')
    const result = spawnSync(config.executable, argv, { stdio: 'inherit' })
    process.exit(result.status ?? 1)
  }
  const task = JSON.parse(readFileSync(config.activeTask, 'utf8'))
  if (!['approval', 'steer-stop'].includes(task.id)) throw new Error('No selected acceptance task')
  const log = (kind, fields = {}) => appendFileSync(config.ledger,
    JSON.stringify({ at: new Date().toISOString(), grant: config.grant, task: task.id, kind, ...fields }) + '\n', { mode: 0o600 })
  const entries = () => readFileSync(config.ledger, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
  const occupancy = () => {
    const selected = entries().filter(row => row.grant === config.grant)
    const keys = new Set(selected.filter(row => ['TURN_WRITE_INTENT', 'SENT_TURN', 'UNKNOWN_TURN_WRITE'].includes(row.kind)).map(row => row.key))
    return keys.size
  }
  const child = spawn(config.executable, argv, { stdio: ['pipe', 'pipe', 'pipe'] })
  let birth = null
  try {
    const value = spawnSync('ps', ['-ww', '-p', String(child.pid), '-o', 'lstart=,uid=,args='], { encoding: 'utf8' })
    if (value.status === 0) birth = value.stdout.trim()
  } catch {}
  log('CODEX_BIRTH', { pid: child.pid, uid: process.getuid?.(), executable: config.executable, argv, cwd: process.cwd(), birth })
  child.stdout.pipe(process.stdout)
  child.stderr.pipe(process.stderr)
  process.stdout.on('error', () => {})
  const requests = new Map()
  let serverBuffer = Buffer.alloc(0)
  child.stdout.on('data', chunk => {
    serverBuffer = Buffer.concat([serverBuffer, chunk])
    let at
    while ((at = serverBuffer.indexOf(10)) >= 0) {
      const line = serverBuffer.subarray(0, at); serverBuffer = serverBuffer.subarray(at + 1)
      try {
        const message = JSON.parse(line.toString('utf8'))
        if (message.method?.endsWith('requestApproval') || message.method === 'item/tool/requestUserInput')
          log('NATIVE_REQUEST', { method: message.method, id: message.id })
        if (message.method === 'turn/completed') log('TURN_COMPLETED', { turn: message.params?.turn?.id, status: message.params?.turn?.status })
        if (message.method === 'item/started' || message.method === 'item/completed')
          log(message.method, { type: message.params?.item?.type, id: message.params?.item?.id })
        const request = requests.get(String(message.id))
        if (request && !message.method) {
          if (request === 'turn/start') log('TURN_START_ACK', { id: message.id, turn: message.result?.turn?.id, error: !!message.error })
          if (request === 'turn/steer') log('STEER_ACK', { id: message.id, error: !!message.error })
        }
      } catch {}
    }
  })
  let clientBuffer = Buffer.alloc(0), sending = false
  const queue = []
  const send = () => {
    if (sending || !queue.length) return
    sending = true
    const raw = queue.shift(), message = JSON.parse(raw.toString('utf8'))
    const method = message.method
    if (method) requests.set(String(message.id), method)
    const key = task.id + ':' + String(child.pid) + ':' + String(message.id)
    let lock, identity
    if (method === 'turn/start') {
      const path = config.ledger + '.lock'
      try {
        lock = openSync(path, 'wx', 0o600); identity = fstatSync(lock)
        if (occupancy() >= config.cap) {
          log('BUDGET_REFUSED', { key })
          closeSync(lock); unlinkSync(path); process.stdin.pause(); child.stdin.end(); return
        }
        writeFileSync(lock, JSON.stringify({ key, pid: process.pid }))
        log('TURN_WRITE_INTENT', { key, id: message.id })
      } catch (error) {
        log('GUARD_REFUSED', { code: error.code ?? 'guard_error' }); process.stdin.pause(); child.stdin.end(); return
      }
    }
    child.stdin.write(Buffer.concat([raw, Buffer.from('\n')]), error => {
      if (method === 'turn/start') {
        log(error ? 'UNKNOWN_TURN_WRITE' : 'SENT_TURN', { key, id: message.id, code: error?.code })
        closeSync(lock)
        const path = config.ledger + '.lock'
        const current = existsSync(path) ? lstatSync(path) : null
        if (current && current.dev === identity.dev && current.ino === identity.ino) unlinkSync(path)
      } else if (method === 'turn/steer') log(error ? 'STEER_WRITE_UNKNOWN' : 'STEER_WRITTEN', { id: message.id })
      else if (!method && message.id !== undefined) log(error ? 'NATIVE_REPLY_UNKNOWN' : 'NATIVE_REPLY_WRITTEN', { id: message.id })
      if (error) { log('WRITE_FAILED', { code: error.code }); return }
      sending = false; send()
    })
  }
  process.stdin.on('data', chunk => {
    clientBuffer = Buffer.concat([clientBuffer, chunk])
    let at
    while ((at = clientBuffer.indexOf(10)) >= 0) {
      queue.push(clientBuffer.subarray(0, at)); clientBuffer = clientBuffer.subarray(at + 1)
    }
    send()
  })
  process.stdin.on('end', () => child.stdin.end())
  child.stdin.on('error', error => log('CHILD_STDIN_ERROR', { code: error.code }))
  child.once('error', error => { log('SPAWN_FAILED', { code: error.code }); process.exitCode = 1 })
  child.once('exit', (code, signal) => {
    log('CODEX_EXIT', { pid: child.pid, code, signal })
    process.stdin.destroy()
    process.exit(code ?? 1)
  })
  process.once('SIGTERM', () => { log('FORWARDER_STOP'); child.stdin.end() })
}
