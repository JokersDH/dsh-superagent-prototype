import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { IdSchema } from '@personal-agent/contracts'
import type { AttemptSpec, RunnerCommand } from '../../../packages/contracts/src/types.ts'
import { createRunnerCredential, serveRunnerRecovery } from '../../../packages/execution/src/recovery-transport.ts'
import type { RunnerInspection, RunnerState } from '../../../packages/execution/src/recovery-transport.ts'

export type { RunnerInspection }
export type RunnerResourceState = RunnerState['resources'][number]
export type RecoveryEndpointOptions = {
  directory: string
  spec: AttemptSpec
  runnerIdentityRef: string
  source: string
  resources: () => RunnerResourceState[]
  state: () => 'serving' | 'terminated' | 'unknown'
  cancel: (command: Extract<RunnerCommand, { kind: 'cancel' }>) => Promise<void>
  /** Durable business facts this Runner already recorded, for attach replay. */
  facts?: (since: number, maxBytes: number) => Promise<{ frames: unknown[]; next: number; done: boolean }>
  /** Business command intake for an attached client; applied to the same attempt and child. */
  command?: (command: RunnerCommand) => Promise<void>
  now?: () => string
}
export const CREDENTIAL_FILE = 'runner.credential'
export const SOCKET_FILE = 'runner.sock'
const shortDirectories = new Set<string>()
export type RecoveryEndpoint = {
  socketPath: string
  credentialPath: string
  inspection(): RunnerInspection
  close(): Promise<void>
  readonly closed: boolean
}

/** Uses the same protocol-v1 implementation as the coordinator; admission is shared with the pump. */
export async function serveRecoveryEndpoint(options: RecoveryEndpointOptions): Promise<RecoveryEndpoint> {
  mkdirSync(options.directory, { recursive: true, mode: 0o700 })
  const socketPath = `${options.directory}/${SOCKET_FILE}`
  const credentialPath = `${options.directory}/${CREDENTIAL_FILE}`
  if (existsSync(socketPath)) throw new Error('A recovery socket already exists for this endpoint')
  createRunnerCredential(credentialPath)
  let closed = false,
    admission: 'open' | 'closed' = 'open'
  const state = (): RunnerState => ({
    state: options.state(),
    admission,
    coverage: 'complete_owned_resources',
    resources: options.resources(),
    evidence: [`admission:${admission}`, 'owned-process-host-inventory'],
  })
  const producer = {
    attempt: {
      ticketId: options.spec.ticketId,
      assignmentId: options.spec.assignmentId,
      attemptId: options.spec.attemptId,
      fenceEpoch: options.spec.fenceEpoch,
      contract: options.spec.contract,
    },
    runnerIdentityRef: options.runnerIdentityRef,
    source: options.source,
  }
  const server = await serveRunnerRecovery({ socketPath, credentialPath }, producer, {
    inspect: async () => state(),
    cancel: async (command) => {
      admission = 'closed'
      await options.cancel(command)
      return state()
    },
    ...(options.facts ? { facts: options.facts } : {}),
    ...(options.command ? { command: async (command) => { await options.command!(command); return state() } } : {}),
  })
  return {
    socketPath,
    credentialPath,
    inspection: () => ({
      ...producer,
      ...state(),
      protocol: 1,
      observedAt: (options.now ?? (() => new Date().toISOString()))(),
    }),
    get closed() {
      return closed
    },
    close: async () => {
      if (closed) return
      closed = true
      admission = 'closed'
      await server.close()
      if (shortDirectories.delete(options.directory)) {
        try {
          unlinkSync(credentialPath)
          rmdirSync(options.directory)
        } catch (error) {
          if (!['ENOENT', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        }
      }
    },
  }
}
export function credentialDigest(credentialPath: string, token: string): string {
  return createHash('sha256').update(`${credentialPath}\u0000${token}`).digest('hex')
}
export function endpointDirectory(root: string, attemptId: string): string {
  const directory = `${root.replace(/\/+$/, '')}/${IdSchema.parse(attemptId)}`
  if (Buffer.byteLength(`${directory}/${SOCKET_FILE}`) <= 90) return directory
  const short = `/tmp/pa-runner-${process.getuid?.() ?? 0}-${createHash('sha256').update(directory).digest('hex').slice(0, 32)}`
  shortDirectories.add(short)
  return short
}
