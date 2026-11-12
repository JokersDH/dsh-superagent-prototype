import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createServer as portServer } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'

export async function availablePort() {
  const socket = portServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening')
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port
}
export async function waitUntil(read, limit = 15000) {
  const deadline = Date.now() + limit
  while (Date.now() < deadline) { const value = await read(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 30)) }
  throw new Error('Personal startup condition timed out')
}
export async function personalCase({ mode = 'missing', workbench = false, noSystemPath = false, assistant = true } = {}) {
  const root = mkdtempSync('/tmp/pa-personal-startup-'), state = join(root, 'state'), bin = join(root, 'private bin'), modelDir = join(root, 'model')
  for (const dir of [state, bin, modelDir]) mkdirSync(dir, { mode: 0o700 })
  const modelRequests = [], versionLog = join(root, 'version.log'), launchLog = join(root, 'native-launch.log'), whichLog = join(root, 'which.log')
  const codex = join(bin, 'codex')
  writeFileSync(join(bin, 'which'), `#!${process.execPath}\nconst fs=require('node:fs');if(process.argv[2]!=='codex')process.exit(1);fs.appendFileSync(${JSON.stringify(whichLog)},'which\\n');${mode === 'missing' ? 'process.exit(1)' : `console.log(${JSON.stringify(codex)})`}\n`, { mode: 0o700 })
  writeFileSync(codex, `#!${process.execPath}\nconst fs=require('node:fs');if(process.argv[2]==='--version'){fs.appendFileSync(${JSON.stringify(versionLog)},'version\\n');${mode === 'probe_error' ? 'process.exit(3)' : `console.log('fixture-private-version '+__filename)`}}else{fs.appendFileSync(${JSON.stringify(launchLog)},process.argv.join(' ')+'\\n');process.exit(98)}\n`, { mode: 0o700 })
  const mock = createServer(async (req, res) => {
    let text = ''; for await (const bytes of req) text += bytes
    modelRequests.push(JSON.parse(text))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '可以继续讨论需求。' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
  })
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening')
  const config = join(modelDir, 'model.json')
  writeFileSync(config, JSON.stringify({ baseURL: `http://127.0.0.1:${mock.address().port}/v1`, apiKey: 'fixture-readiness-key', model: 'readiness-mock',
    allowedModels: ['readiness-mock'], allowInsecureHttp: true, maxOutputTokens: 64 }), { mode: 0o600 })
  const apiPort = await availablePort(), consolePort = workbench ? await availablePort() : undefined
  let child, output = '', stopped = false
  const apiURL = `http://127.0.0.1:${apiPort}`, consoleURL = consolePort ? `http://127.0.0.1:${consolePort}` : undefined
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit'), timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }, 8000)
    child.kill('SIGTERM'); try { await exited } finally { clearTimeout(timer) }
  }
  const start = async (extra = []) => {
    const args = workbench
      ? ['tools/dev/workbench.mjs', '--port', String(consolePort), '--api-port', String(apiPort), '--state', state, ...(mode === 'operator' ? ['--discussion-only'] : []), ...extra]
      : ['apps/coordinator/product/demo.ts', '--port', String(apiPort), '--state', state, ...(mode === 'operator' ? ['--discussion-only'] : ['--native']),
        ...(assistant ? ['--assistant'] : []), ...extra]
    child = spawn(process.execPath, args, { cwd: resolve('.'), env: { ...process.env, PA_MODEL_CONFIG: config,
      PATH: [bin, ...(noSystemPath ? [] : [process.env.PATH ?? ''])].join(delimiter) }, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', bytes => { output += bytes }); child.stderr.on('data', bytes => { output += bytes })
    await waitUntil(async () => {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Personal process exited: ${output.slice(-2000)}`)
      try {
        const health = await fetch(`${apiURL}/v1/health`, { signal: AbortSignal.timeout(300) })
        return health.ok && (!workbench || ((await fetch(consoleURL, { signal: AbortSignal.timeout(300) })).ok && existsSync(join(state, 'workbench.json'))))
      } catch { return false }
    })
    return child
  }
  const request = (path, body) => fetch(`${apiURL}${path}`, { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    headers: { authorization: `Bearer ${readFileSync(join(state, 'api.key'), 'utf8').trim()}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, signal: AbortSignal.timeout(5000) })
  const json = async (path, body) => { const response = await request(path, body); return { status: response.status, value: await response.json() } }
  return { root, state, apiPort, consolePort, apiURL, consoleURL, modelRequests, config, versionLog, launchLog, whichLog,
    start, stop, request, json, get child() { return child }, get output() { return output },
    expectedReason: mode === 'operator' ? 'operator_disabled' : process.platform !== 'darwin' || process.arch !== 'arm64' ? 'unsupported_platform'
      : mode === 'missing' ? 'not_installed' : mode === 'probe_error' ? 'probe_failed' : 'incompatible_version',
    close: async () => { if (stopped) return; stopped = true; await stop(); mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve)); rmSync(root, { recursive: true, force: true }) },
  }
}
