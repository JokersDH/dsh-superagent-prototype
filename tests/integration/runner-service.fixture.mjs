import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProcessHost } from '../../apps/runner/src/process-host.ts'
import { serveRunnerRecovery } from '../../apps/coordinator/runner-link.ts'
import { producer } from './runtime-ingress-fixture.ts'

const directory = process.argv[2]
const host = new ProcessHost({ killGraceMs: 500, resolveCwd: () => directory })
process.once('SIGTERM', () => { void host.stopAll(500).finally(() => process.exit(1)) })
const owned = await host.spawn({ executable: process.execPath, cwdRef: 'fixture-cwd', environmentRef: 'fixture-env', argv: ['-e', `
  const fs = require('node:fs');
  fs.appendFileSync(process.argv[1], 'begin\\n');
  setInterval(() => fs.appendFileSync(process.argv[2], 'tick\\n'), 20);
`, join(directory, 'starts.log'), join(directory, 'ticks.log')] })
// These streams must be consumed even though this fixture child normally emits no output.
void (async () => { for await (const _ of owned.stdout) {} })()
void (async () => { for await (const _ of owned.stderr) {} })()
let state = 'serving', admission = 'open', writer = 'active', evidence = ['owned-process-started']
const inspect = async () => ({ state, admission, coverage: 'complete_owned_resources', evidence: ['fixture-single-owned-process-inventory'], resources: [{ ref: owned.resourceRef, ownership: 'spawned_process', writer, evidence }] })
const service = await serveRunnerRecovery({ socketPath: join(directory, 'runner.sock'), credentialPath: join(directory, 'runner.key') }, producer, {
  inspect,
  cancel: async () => {
    admission = 'closed'
    appendFileSync(join(directory, 'cancels.log'), 'cancel\n')
    const result = await host.stopAll(100)
    evidence = [...result.evidenceRefs]
    writer = result.quiescence === 'confirmed' ? 'quiescent' : 'indeterminate'
    state = result.quiescence === 'confirmed' ? 'terminated' : 'unknown'
    return inspect()
  },
})
process.send({ endpoint: service.endpoint, resourceRef: owned.resourceRef, processIdentity: owned.identity })
process.once('message', async message => {
  if (message !== 'shutdown') return
  const stopped = await host.stopAll(500)
  await service.close()
  if (stopped.quiescence !== 'confirmed') process.exitCode = 1
  process.disconnect()
})
