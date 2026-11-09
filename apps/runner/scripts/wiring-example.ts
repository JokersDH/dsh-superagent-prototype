/**
 * Runtime wiring example (wave-02 item 1).
 *
 * A runnable, main-consumable demonstration of the stable runtime surface:
 *
 *   launchAttempt()  -> spawn -> bootstrap -> ready -> resources registered -> begin
 *   inspect/cancel   -> authenticated recovery endpoint
 *   shutdown         -> complete resource inventory + stop barrier evidence
 *
 * The production coordinator adapter is main's; this file shows exactly which calls and which order
 * the adapter must perform, and is executable so the order can be regression-tested.
 *
 *   node apps/runner/scripts/wiring-example.ts
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RunnerLink, serveRecoveryEndpoint, endpointDirectory } from '../src/index.ts'
import { makeAttemptSpec, makeCommand } from '../../../packages/testing/src/index.ts'

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url))

export type LaunchResult = {
  attemptId: string
  pid: number
  stateRoot: string
  /** Order the launcher performed, in the sequence the contract requires. */
  order: string[]
}

/**
 * The canonical launch sequence.
 *
 * 1. resolve the spec (main-owned: profile/policy/lease selection);
 * 2. spawn the per-attempt Runner process — one endpoint, one credential, one attempt;
 * 3. wait for `ready` (the Runner has opened its journal and payload area);
 * 4. register the owned resources (the Runner's own process group) with the composition root;
 * 5. only then send `begin`, exactly once.
 *
 * Business `begin` is never sent before step 3/4: a fact produced before the inventory exists could
 * not be attributed to a resource the barrier knows about.
 */
export async function launchAttempt(options: {
  spec: ReturnType<typeof makeAttemptSpec>
  scenario: string
  stateRoot: string
  onRegister: (inventory: { ref: string; ownership: 'spawned_process'; writer: 'active'; evidence: string[] }[]) => void
}): Promise<{ launched: LaunchResult; runner: Awaited<ReturnType<RunnerLink['spawnAttempt']>> }> {
  const order: string[] = []
  order.push('spec-resolved')

  const link = new RunnerLink({
    executable: process.execPath,
    entry: here('../src/runner-service-entry.ts'),
    args: [options.scenario],
    stateRoot: options.stateRoot,
  })
  const runner = await link.spawnAttempt(options.spec, async fact => ({ factId: fact.factId, persisted: true as const, seq: 1 }))
  order.push('spawned')
  order.push('ready')

  // Register before business work: the inventory is what the barrier will later prove quiescent.
  options.onRegister([
    { ref: `pid-${runner.pid}`, ownership: 'spawned_process', writer: 'active', evidence: ['spawn-observed', 'ready-observed'] },
  ])
  order.push('resources-registered')

  await runner.command(makeCommand('begin', { inputRef: 'input-1', preparedPolicyRef: 'prepared-1' }))
  order.push('begun')

  return { launched: { attemptId: options.spec.attemptId, pid: runner.pid, stateRoot: options.stateRoot, order }, runner }
}

/** Serve the recovery endpoint for a launched attempt and return its inspection. */
export async function exposeRecovery(options: {
  spec: ReturnType<typeof makeAttemptSpec>
  stateRoot: string
  resources: () => Array<{ ref: string; ownership: 'spawned_process'; writer: 'active' | 'quiescent' | 'indeterminate'; evidence: string[] }>
  state: () => 'serving' | 'terminated' | 'unknown'
  onCancel: () => Promise<void>
}) {
  return serveRecoveryEndpoint({
    directory: endpointDirectory(options.stateRoot, 'recovery'),
    spec: options.spec,
    runnerIdentityRef: `runner-${options.spec.attemptId}`,
    source: 'attempt-runner',
    resources: options.resources,
    state: options.state,
    cancel: options.onCancel,
  })
}

// --- runnable demonstration --------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const stateRoot = mkdtempSync(join(tmpdir(), 'wave02-wiring-'))
  const spec = makeAttemptSpec()
  let registered: Array<{ ref: string }> = []

  process.stdout.write(`stateRoot=${stateRoot}\n`)
  const { launched, runner } = await launchAttempt({
    spec,
    scenario: 'happy',
    stateRoot: join(stateRoot, 'attempt'),
    onRegister: inventory => {
      registered = inventory
    },
  })
  process.stdout.write(`launch order: ${launched.order.join(' -> ')}\n`)
  process.stdout.write(`registered resources: ${registered.map(item => item.ref).join(', ')}\n`)

  const endpoint = await exposeRecovery({
    spec,
    stateRoot: join(stateRoot, 'attempt'),
    resources: () => registered.map(item => ({ ref: item.ref, ownership: 'spawned_process' as const, writer: 'active' as const, evidence: ['spawn-observed'] })),
    state: () => 'serving',
    onCancel: async () => {
      await runner.close()
    },
  })
  process.stdout.write(`inspection: admission=${endpoint.inspection().admission} coverage=${endpoint.inspection().coverage} resources=${endpoint.inspection().resources.length}\n`)

  const exit = await runner.waitExit()
  process.stdout.write(`attempt exit: ${exit.exit.reason}\n`)
  await endpoint.close()
  await runner.close()
  process.stdout.write('WIRING EXAMPLE DONE\n')
}
