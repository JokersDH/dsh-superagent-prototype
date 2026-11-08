import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProductStore, canonicalDigest } from '@personal-agent/storage'
import type { CompletionVerifier, Ticket } from '@personal-agent/orchestrator-core'
import type {
  CandidateRef,
  CompletionProposal,
  ContractRef,
  Scope,
  TrustedActor,
  UserCommand,
  Verification,
} from '@personal-agent/contracts'
import { createProductApplication } from '@personal-agent/application'

export const actor: TrustedActor = { userId: 'local-user', authorityRef: 'local-authority', source: 'local_ui' }
export const scope: Scope = {
  projectId: 'project-atlas',
  allowedPaths: ['src/'],
  excludedPaths: ['src/private/'],
  externalActions: [],
}
export const contractRef = (ref: ContractRef): ContractRef => ({
  workId: ref.workId,
  revision: ref.revision,
  digest: ref.digest,
})
export const createCommand = (id = 'create-1'): Extract<UserCommand, { kind: 'create_work' }> => ({
  kind: 'create_work',
  commandId: id,
  conversationId: 'conversation-main',
  projectId: scope.projectId,
  goal: 'Implement the requested change',
  scope,
  criteria: [
    { id: 'unit', kind: 'machine', required: true, description: 'Unit checks pass', checkDefinitionRef: 'check:unit' },
  ],
  profileId: 'profile-codex-local',
})

export function fixture(t: { after(fn: () => void): void }) {
  const directory = mkdtempSync(join(tmpdir(), 'pa-application-'))
  let store = new ProductStore({ path: join(directory, 'state.sqlite'), artifactsRoot: join(directory, 'artifacts') })
  let current = true,
    now = '2026-11-08T10:00:00.000Z'
  const reviews = new Map<string, { proposal: CompletionProposal; verification: Verification; artifactIds: string[] }>()
  const verifier: CompletionVerifier = {
    resolve: (proposal) => {
      const review = reviews.get(proposal.verificationId)
      if (!review) return undefined
      const human = proposal.humanAcceptanceRef
        ? (store.commands.get(proposal.humanAcceptanceRef)?.result as
            | { id: string; candidate: CandidateRef; artifactDigest: string; criterionIds: string[] }
            | undefined)
        : undefined
      return {
        verification: review.verification,
        quiescence: { id: 'fixture-quiescence', candidate: { ...proposal }, artifactDigest: proposal.artifactDigest },
        ...(human ? { humanAcceptance: human } : {}),
      }
    },
  }
  const make = () =>
    createProductApplication({
      store,
      principal: actor,
      projects: [
        { id: scope.projectId, scope },
        { id: 'project-other', scope: { ...scope, projectId: 'project-other' } },
      ],
      profileIds: ['profile-codex-local'],
      registeredChecks: ['check:unit'],
      actionSecret: Buffer.alloc(32, 17),
      nativeFence: () => (current ? 'current' : 'stale'),
      now: () => now,
      completion: {
        verifier,
        current: (candidate) =>
          [...reviews.values()].find(
            (item) =>
              item.proposal.ticketId === candidate.ticketId &&
              item.proposal.candidateGeneration === candidate.candidateGeneration,
          ),
        accept: (proposal, _actor, criterionIds, id) => {
          const value = {
            id,
            candidate: { ...proposal },
            artifactDigest: proposal.artifactDigest,
            criterionIds: [...criterionIds],
          }
          store.commands.record(id, canonicalDigest(JSON.parse(JSON.stringify(value))), () => value)
        },
      },
    })
  let app = make()
  t.after(() => {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return {
    get store() {
      return store
    },
    get app() {
      return app
    },
    directory,
    reviews,
    setCurrent: (value: boolean) => {
      current = value
    },
    setNow: (value: string) => {
      now = value
    },
    reopen: () => {
      store.close()
      store = new ProductStore({ path: join(directory, 'state.sqlite'), artifactsRoot: join(directory, 'artifacts') })
      app = make()
    },
    start: async (workId: string) => {
      const view = (await app.inspect({ workId })).works[0]!,
        ref = view.actions.currentAssignment!
      app.core.assignmentStarted(ref.ticketId, ref.assignmentId)
      const ticket = store.domain.tickets.get<Ticket>(ref.ticketId)!
      app.core.inputsDelivered(ref.ticketId, ref.assignmentId, [...ticket.undelivered])
      app.core.inputsReadAssignment(
        ref.ticketId,
        ref.assignmentId,
        ticket.inputs.map((input) => input.id),
      )
      const binding = {
        ...ref,
        attemptId: `attempt-${ref.assignmentId}`,
        fenceEpoch: 1,
        runnerIdentityRef: 'runner-fixture',
        source: 'driver-fixture',
        state: 'active' as const,
        resources: [{ ref: `res-${ref.assignmentId}`, ownership: 'spawned_process' as const }],
      }
      store.uow.atomic(() => {
        store.bindings.record(binding)
        store.bindings.setCurrent(ref.ticketId, binding.attemptId)
      })
      return { ref, binding }
    },
  }
}
