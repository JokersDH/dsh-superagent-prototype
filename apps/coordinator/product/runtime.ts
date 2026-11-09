import { join } from 'node:path'
import { createProductApplication } from '@personal-agent/application'
import type { ApplicationOptions } from '@personal-agent/application'
import type { NativeQuestionBinding, Scope } from '@personal-agent/contracts'
import { key } from '@personal-agent/orchestrator-core'
import type { Ticket } from '@personal-agent/orchestrator-core'
import { CheckRegistry } from '@personal-agent/verification'
import { WorkspaceManager } from '@personal-agent/workspaces'
import { scopeWithin } from '@personal-agent/questions'
import type { LocalHttpOptions } from '../http/app.ts'
import { ProductCompletion } from './completion.ts'
import { FIXTURE_PROFILES, ProductExecution } from './execution.ts'
import { applicationConfiguration } from './configuration.ts'

export const FIXTURE_CHECK = 'check-fixture-output'
/** Operator-selected fixed executable/argv; contract or user text can only reference its registered ID. */
export function createControlledProduct(
  options: Omit<ApplicationOptions, 'completion' | 'nativeFence' | 'profileIds' | 'registeredChecks'> & {
    stateRoot: string
    scratchProject: string
  },
) {
  options = {
    ...options,
    principal: structuredClone(options.principal),
    projects: options.projects.map((project) => {
      const grant = structuredClone(project.scope)
      const scope: Scope = {
        projectId: project.id,
        allowedPaths: ['src/'],
        excludedPaths: [],
        externalActions: [],
        ...(grant.expiresAt ? { expiresAt: grant.expiresAt } : {}),
      }
      if (!scopeWithin(scope, grant))
        throw new TypeError('Controlled fixture projects require the fixed src/ scratch grant')
      return { ...project, scope }
    }),
  }
  const workspaces = new WorkspaceManager(join(options.stateRoot, 'workspaces'))
  const checks = new CheckRegistry()
  checks.register({
    id: FIXTURE_CHECK,
    revision: 1,
    executable: process.execPath,
    argv: [
      '--input-type=module',
      '-e',
      "import {readFileSync} from 'node:fs';process.exit(readFileSync('src/product-output.txt','utf8')==='approved product output\\n'?0:1)",
    ],
    deadlineMs: 2000,
    outputLimitBytes: 64 * 1024,
  })
  const completion = new ProductCompletion(options.store, workspaces, checks)
  let execution: ProductExecution | undefined
  const application = createProductApplication({
    ...options,
    profileIds: FIXTURE_PROFILES,
    registeredChecks: checks.ids(),
    completion,
    nativeFence: (target: NativeQuestionBinding) => execution?.nativeFence(target) ?? 'unknown',
  })
  execution = new ProductExecution(
    options.store,
    application,
    workspaces,
    completion,
    options.scratchProject,
    options.stateRoot,
    options.principal,
  )
  const { store } = options
  const read: NonNullable<LocalHttpOptions['read']> = {
    configuration: async () =>
      applicationConfiguration({
        projects: options.projects.map((project) => ({
          ...project,
          defaultCriteria: [
            {
              id: 'fixed-output',
              kind: 'machine',
              required: true,
              description: 'Output matches the registered check',
              checkDefinitionRef: FIXTURE_CHECK,
            },
            { id: 'review-output', kind: 'human', required: true, description: 'Review the frozen output' },
          ],
        })),
        profiles: FIXTURE_PROFILES.map((id) => ({
          id,
          revision: 1,
          displayName: `Controlled Fixture: ${id.slice('profile-fixture-'.length)}`,
          driverId: 'controlled-product-fixture',
          kind: 'controlled_fixture',
          readiness: 'fixture_ready',
        })),
        checks: [{ id: FIXTURE_CHECK, revision: 1, displayName: 'Controlled output content' }],
        enabledProfileIds: FIXTURE_PROFILES,
      }),
    deliveries: async (id) => application.questions.currentDeliveries(id),
    verification: async (id) => {
      for (const ticket of store.domain.tickets.list<Ticket>()) {
        const candidate = ticket.completion?.candidate ?? ticket.completion?.confirmed?.proposal
        const review = candidate && store.uow.atomic(() => completion.current(candidate))
        if (review?.verification.id === id) return review.verification
      }
      return undefined
    },
    artifact: async (id) => {
      // Only artifact IDs explicitly published by the trusted product review are downloadable.
      const visible = options.projects.some((project) =>
        store.product.works
          .listByProject(project.id, { limit: 200 })
          .some((work) => !!store.commands.get(key('product-artifact', id, work.id))),
      )
      if (!visible) return undefined
      const artifact = store.artifacts.read(id)
      if (!artifact) return undefined
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(artifact.data)
            controller.close()
          },
        }),
        contentType: 'text/plain; charset=utf-8',
      }
    },
  }
  return {
    application,
    execution,
    completion,
    workspaces,
    checks,
    read,
    start: () => execution!.start(),
    close: () => execution!.close(),
  }
}
