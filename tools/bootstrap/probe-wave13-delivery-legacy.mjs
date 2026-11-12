import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const candidate=resolve(process.argv[2]??'')
if(!process.argv[2]||process.argv.length!==3)throw new Error('Usage: node tools/bootstrap/probe-wave13-delivery-legacy.mjs <D-root>')
const source=execFileSync('git',['rev-parse','HEAD'],{cwd:candidate,encoding:'utf8'}).trim()
const {stopInstance}=await import(pathToFileURL(join(candidate,'apps/launcher/lib/stop.mjs')).href)
const {captureProcessFacts,processAlive,processStart}=await import(pathToFileURL(join(candidate,'apps/launcher/lib/instance.mjs')).href)
const root=realpathSync(mkdtempSync('/tmp/pa-wave13-legacy-'))
const base = join(root, 'legacy-copy')
const install = join(base, 'install')
const script = join(install, 'apps/coordinator/product/demo.ts')
const roots = { install, config: join(base, 'copied-config'), data: join(base, 'original-data') }
for (const dir of [join(install, 'apps/coordinator/product'), roots.config, roots.data]) { mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700) }
writeFileSync(script, 'import {createServer} from "node:http"; const s=createServer((q,r)=>r.end("owned")); s.listen(0,"127.0.0.1",()=>process.send({port:s.address().port}));')
const argv = [script, '--state', roots.data]
const child = spawn(process.execPath, argv, { cwd: install, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
const [{ port }] = await once(child, 'message')
const facts = await captureProcessFacts(child.pid)
const dead = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
await once(dead, 'exit')
try {
  const legacyRecord = { protocol: 'personal-product-instance/1', pid: dead.pid, processStart: 'exited-owned-launcher', apiPid: child.pid, consolePid: dead.pid,
    state: roots.data, install, apiURL: `http://127.0.0.1:${port}`, consoleURL: 'http://127.0.0.1:65001', mode: 'fixture', access: 'local-development', buildId: 'owned-legacy-probe',
    apiArgv: [process.execPath, ...argv], apiProcessStart: facts.processStart, apiUid: facts.uid, startedAt: new Date().toISOString() }
  assert(!('configRoot' in legacyRecord))
  writeFileSync(join(roots.config, 'instance.json'), JSON.stringify(legacyRecord), { mode: 0o600 })
  writeFileSync(join(roots.config, 'launcher.json'), JSON.stringify({ roots: { config: roots.config } }), { mode: 0o600 })
  const result = await stopInstance({ roots, timeoutMs: 2000 })
  const report = { id: 'COPIED_LEGACY_RECORD_SELF_CONSISTENT_CONFIG', code: result.code ?? null, status: result.status, apiAlive: await processAlive(child.pid),
    legacyConfigEvidence: 'Only a launcher.json whose roots.config equals the copying config root', expected: 'Refuse legacy unknown ownership before signals', modelCalls: 0, nativeTurns: 0 }
  report.source=source; report.verdict=report.apiAlive?'PASS':'FAIL'
  const output=process.env.PA_ADMISSION_REPORT?resolve(process.env.PA_ADMISSION_REPORT):join(resolve(dirname(fileURLToPath(import.meta.url)),'../..'),'reports/releases/wave13-admission/delivery-legacy.json')
  mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');process.exitCode=report.apiAlive?0:1
  console.log(JSON.stringify(report, null, 2))
} finally {
  if (child.exitCode === null && child.signalCode === null && await processStart(child.pid) === facts.processStart) {
    const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit
  }
  rmSync(root,{recursive:true,force:true})
}
