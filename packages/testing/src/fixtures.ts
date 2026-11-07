/**
 * Frozen-shape fixtures for WP-03 tests. They are deliberately hand-written local fixtures shaped
 * against `packages/contracts`: when the contracts package is built and wired at integration, the
 * same objects must parse with the exported zod schemas. They are not a second contract source.
 */
import type {
  AttemptSpec,
  CriticalFact,
  ProgressUpdate,
  RunnerCommand,
  RuntimeFactKind,
} from '../../contracts/src/types.ts'

export const FIXTURE_DIGEST = 'a'.repeat(64)

export function makeAttemptSpec(overrides: Partial<AttemptSpec> = {}): AttemptSpec {
  const base: AttemptSpec = {
    ticketId: 'ticket-1',
    assignmentId: 'assignment-1',
    attemptId: 'attempt-1',
    fenceEpoch: 1,
    contract: { workId: 'work-1', revision: 1, digest: FIXTURE_DIGEST },
    profile: {
      id: 'profile-fake',
      revision: 1,
      driverId: 'fake-driver',
      driverApiMajor: 1,
      driverRelease: '0.0.0-g1',
      executable: '/usr/bin/false',
      argv: [],
      expectedVersion: '0.0.0',
      nativeConfigRef: 'config-1',
      permissionPolicyRevision: 'policy-1',
      requiredFeatures: [],
    },
    workspaceRef: 'workspace-1',
    resourceLeaseRef: 'lease-1',
    policySnapshotRef: 'policy-snapshot-1',
    budgetRef: 'budget-1',
  }
  return { ...base, ...overrides }
}

export function makeCommand(
  kind: RunnerCommand['kind'],
  overrides: Partial<RunnerCommand> = {},
): RunnerCommand {
  const base = {
    id: `cmd-${kind}`,
    ticketId: 'ticket-1',
    assignmentId: 'assignment-1',
    attemptId: 'attempt-1',
    fenceEpoch: 1,
    // AttemptRef requires the contract; a fixture without it cannot express a real RunnerCommand.
    contract: { workId: 'work-1', revision: 1, digest: FIXTURE_DIGEST },
  }
  switch (kind) {
    case 'begin':
      return { ...base, kind, inputRef: 'input-1', preparedPolicyRef: 'prepared-1', ...overrides } as RunnerCommand
    case 'deliver':
      return { ...base, kind, inputRef: 'input-2', ...overrides } as RunnerCommand
    case 'answer':
      return { ...base, kind, nativeBindingRef: 'binding-1', answerRef: 'answer-1', ...overrides } as RunnerCommand
    case 'cancel':
    case 'pause_at_boundary':
      return { ...base, kind, ...overrides } as RunnerCommand
  }
}

export function makeFact(
  kind: RuntimeFactKind,
  payloadRef = 'payload-1',
  overrides: Partial<CriticalFact> = {},
): CriticalFact {
  return {
    ticketId: 'ticket-1',
    assignmentId: 'assignment-1',
    attemptId: 'attempt-1',
    fenceEpoch: 1,
    contract: { workId: 'work-1', revision: 1, digest: FIXTURE_DIGEST },
    factId: `fact-${kind}`,
    source: 'fake-driver',
    kind,
    payloadRef,
    ...overrides,
  }
}

export function makeProgress(overrides: Partial<ProgressUpdate> = {}): ProgressUpdate {
  return {
    ticketId: 'ticket-1',
    assignmentId: 'assignment-1',
    attemptId: 'attempt-1',
    fenceEpoch: 1,
    contract: { workId: 'work-1', revision: 1, digest: FIXTURE_DIGEST },
    text: 'working',
    observedAt: '2026-11-07T00:00:00.000Z',
    ...overrides,
  }
}
