import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serveRunner } from '../../src/runner-service.ts'
import { RunnerCommandProcess } from '../../src/command-process.ts'
import { encodeFrame } from '../../../../packages/driver-kit/src/index.ts'
import { prepareRunnerEnvironment } from '../../src/environment-preparation.ts'

const workspace = process.env.PA_PREPARATION_WORKSPACE!
const mode = process.argv[2]
const handle = await serveRunner({
  input: process.stdin,
  write: frame => { process.stdout.write(encodeFrame(frame)) },
  payloads: { read: async () => null },
  eagerPrepare: true,
  recoveryRoot: process.env.PA_PREPARATION_RECOVERY!,
  prepare: async (spec, { io, processHost, signal }) => {
    if (mode === 'environment') {
      await prepareRunnerEnvironment(process.env.PA_PREPARATION_PLAN!, spec, { io, processHost, signal })
      return
    }
    await io.payloads.read(spec.policySnapshotRef)
    const port = new RunnerCommandProcess(processHost)
    const result = await port.run(process.execPath, ['-e', mode === 'long'
      ? 'require("fs").writeFileSync("installer.pid",String(process.pid));setInterval(()=>require("fs").appendFileSync("heartbeat","x"),10)'
      : 'require("fs").writeFileSync("prepared","yes")'], {
      cwd: workspace, env: { PATH: process.env.PATH ?? '' }, signal,
      timeoutMs: 10000, maxOutputBytes: 1024,
    })
    if (result.quiescence !== 'confirmed' || result.cancelled || result.timedOut || result.code !== 0)
      throw new Error('Preparation did not establish a usable environment')
  },
  createDriver: () => ({
    inspect: async () => { throw new Error('test only') },
    reconcile: async () => { throw new Error('test only') },
    serve: async () => {
      writeFileSync(join(workspace, 'native-started'), 'yes')
      return { reason: 'terminal', evidenceRefs: ['preparation-test'] }
    },
  }),
})
await handle.done
await handle.shutdown()
