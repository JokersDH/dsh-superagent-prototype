/**
 * Shared fixtures for the pure catalog tests. They are plain data: an `ApplicationConfiguration`
 * projection shaped exactly like the public contract, and `project-facts/1` observations. Nothing
 * here reads a filesystem, spawns a process or grants authority.
 */
import type { ApplicationConfiguration } from '@personal-agent/contracts'
import type { ProjectFacts } from '../src/index.ts'

export const NOW = '2026-11-14T12:00:00.000Z'
export const CONFIG_REVISION = 'c'.repeat(64)
export const LOCK_DIGEST = 'd'.repeat(64)

export const alphaScope = {
  projectId: 'project-alpha',
  allowedPaths: ['src', 'test'],
  excludedPaths: ['src/generated'],
  externalActions: [],
} as const

export const alphaCriteria = [
  { id: 'tests', description: 'Registered project tests pass.', kind: 'machine' as const, required: true as const, checkDefinitionRef: 'check-node-test' },
  { id: 'review', description: 'User reviews the delivery.', kind: 'human' as const, required: true as const },
]

export const configuration: ApplicationConfiguration = {
  protocol: 'application-configuration/1',
  revision: CONFIG_REVISION,
  proposalsAvailable: true,
  executionAvailability: { state: 'available', kind: 'native' },
  projects: [
    {
      id: 'project-alpha',
      displayName: 'Alpha 服务',
      scope: alphaScope,
      profileIds: ['profile-native'],
      defaultProfileId: 'profile-native',
      defaultCriteria: alphaCriteria,
      dispatchAllowed: true,
    },
    {
      id: 'project-beta',
      displayName: 'Beta 工具',
      scope: { projectId: 'project-beta', allowedPaths: ['packages/core/src'], excludedPaths: [], externalActions: [] },
      profileIds: ['profile-native'],
      defaultProfileId: 'profile-native',
      defaultCriteria: [{ id: 'beta-tests', description: 'Beta package tests pass.', kind: 'machine', required: true, checkDefinitionRef: 'check-npm-test' }],
      dispatchAllowed: true,
    },
  ],
  profiles: [
    {
      id: 'profile-native',
      revision: 1,
      displayName: 'Native profile',
      driverId: 'codex',
      kind: 'native',
      readiness: 'native_test_passed',
      dispatchAllowed: true,
    },
  ],
  checks: [
    { id: 'check-node-test', revision: 4, displayName: 'node --test' },
    { id: 'check-npm-test', revision: 2, displayName: 'npm test' },
  ],
}

export const alphaFacts: ProjectFacts = {
  protocol: 'project-facts/1',
  projectId: 'project-alpha',
  observedAt: '2026-11-14T11:55:00.000Z',
  provenance: { source: 'injected', provider: 'test-fixture/1', authority: 'none', scope: 'package', inputs: [] },
  stack: { kind: 'node', packageManagerField: 'pnpm@11.7.0', enginesNode: '>=24' },
  manager: { kind: 'pnpm', declaredVersion: '11.7.0' },
  locks: [{ name: 'pnpm-lock.yaml', digest: LOCK_DIGEST }],
  workspace: { declaration: 'none' },
  scripts: ['build', 'test'],
  languages: ['node', 'typescript'],
  missing: [],
}

export const betaFacts: ProjectFacts = {
  protocol: 'project-facts/1',
  projectId: 'project-beta',
  observedAt: '2026-11-14T11:55:00.000Z',
  provenance: { source: 'authorized_metadata', provider: 'project-recipes-cli/1', authority: 'none', scope: 'workspace_member', inputs: ['e'.repeat(64)] },
  stack: { kind: 'node', packageManagerField: 'npm@11.6.0', enginesNode: '>=22' },
  manager: { kind: 'npm', declaredVersion: '11.6.0' },
  locks: [{ name: 'package-lock.json', digest: 'f'.repeat(64) }],
  workspace: { declaration: 'package_json_workspaces' },
  scripts: ['ci', 'test'],
  languages: ['node', 'javascript'],
  missing: [],
}

/** Clone with a shallow override of top-level keys, keeping the fixture immutable. */
export const withFacts = (overrides: Partial<ProjectFacts>): ProjectFacts => ({ ...alphaFacts, ...overrides })

export const withConfiguration = (overrides: Partial<ApplicationConfiguration>): ApplicationConfiguration => ({ ...configuration, ...overrides })
