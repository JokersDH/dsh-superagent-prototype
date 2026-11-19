import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { IdSchema } from '@personal-agent/contracts'
import type { AttemptSpec, RunnerCommand } from '../../../packages/contracts/src/types.ts'
import { createRunnerCredential, serveRunnerRecovery } from '../../../packages/execution/src/recovery-transport.ts'
import type { RunnerControlAuth, RunnerFinalizeConfirmation, RunnerFinalizeResult, RunnerInspection, RunnerState } from '../../../packages/execution/src/recovery-transport.ts'

export type { RunnerInspection }
export type RunnerResourceState = RunnerState['resources'][number]
export type RecoveryEndpointOptions = {
  directory: string
  spec: AttemptSpec
  runnerIdentityRef: string
  source: string
  resources: () => RunnerResourceState[]
  state: () => 'serving' | 'terminated' | 'unknown'
  cancel: (command: Extract<RunnerCommand, { kind: 'cancel' }>, auth?: RunnerControlAuth) => Promise<void>
  /** Durable business facts this Runner already recorded, for attach replay. */
  facts?: (since: number, maxBytes: number) => Promise<{ frames: unknown[]; next: number; done: boolean }>
  payload?: (ref: string, offset: number, length: number) => Promise<{ total: number; digest: string; base64: string }>
  channelState?: (producer: unknown) => Promise<{ generation: number }>
  channelNext?: (producer: unknown, leaseId: string, expectedGeneration: number) => Promise<{ generation: number; request: unknown } | null>
  channelReply?: (producer: unknown, reply: unknown, leaseId: string) => Promise<{ accepted: boolean; generation: number }>
  /** Business command intake for an attached client; applied to the same attempt and child. */
  command?: (command: RunnerCommand, auth?: RunnerControlAuth) => Promise<void>
  /** Optional postcommit finalize; only a terminal, fully quiescent Runner accepts it. */
  finalize?: (auth: RunnerControlAuth, confirmation: RunnerFinalizeConfirmation) => Promise<RunnerFinalizeResult>
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
    cancel: async (command, auth) => {
      // A refused cancel (foreign producer / old lease) must not mutate admission: close it only after
      // the original cancel actually succeeded.
      await options.cancel(command, auth)
      admission = 'closed'
      return state()
    },
    ...(options.facts ? { facts: options.facts } : {}),
    ...(options.payload ? { payload: options.payload } : {}),
    ...(options.channelState ? { channelState: options.channelState } : {}),
    ...(options.channelNext ? { channelNext: options.channelNext } : {}),
    ...(options.channelReply ? { channelReply: options.channelReply } : {}),
    ...(options.command ? { command: async (command, auth) => { await options.command!(command, auth); return state() } } : {}),
    ...(options.finalize ? { finalize: options.finalize } : {}),
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
      // A closed endpoint returns EVERY resource it created. The socket file and the credential used to
      // survive a normal close, so a stopped Runner left both behind; only the short-path case cleaned up.
      const ignoreMissing = (error: unknown): void => {
        const code = (error as NodeJS.ErrnoException).code ?? ''
        if (!['ENOENT', 'ENOTEMPTY'].includes(code)) throw error
      }
      shortDirectories.delete(options.directory)
      try { unlinkSync(socketPath) } catch (error) { ignoreMissing(error) }
      try { unlinkSync(credentialPath) } catch (error) { ignoreMissing(error) }
      try { rmdirSync(options.directory) } catch (error) { ignoreMissing(error) }
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
