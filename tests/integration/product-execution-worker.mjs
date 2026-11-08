import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createControlledProduct, FIXTURE_CHECK } from '../../apps/coordinator/product/runtime.ts'
import { loadRecoveryRunner } from '../../apps/coordinator/runner-registry.ts'

const [stateRoot, scratchProject, readyPath] = process.argv.slice(2)
const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
const principal = { userId: 'local-product-user', authorityRef: 'local-product-authority' }
const scope = { projectId: 'project-scratch', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const product = createControlledProduct({
  store,
  principal,
  projects: [{ id: scope.projectId, scope }],
  actionSecret: Buffer.alloc(32, 1),
  stateRoot,
  scratchProject,
})
product.start()
const receipt = await product.application.dispatch(
  {
    commandId: 'crash-create',
    conversationId: 'conversation-product',
    kind: 'create_work',
    projectId: scope.projectId,
    goal: 'Controlled crash operation',
    profileId: 'profile-fixture-question',
    scope,
    criteria: [
      {
        id: 'criterion-output',
        kind: 'machine',
        required: true,
        description: 'Fixed output matches',
        checkDefinitionRef: FIXTURE_CHECK,
      },
    ],
  },
  { ...principal, source: 'local_cli' },
)
const deadline = Date.now() + 7000
while (Date.now() < deadline) {
  const snapshot = await product.application.inspect({ workId: receipt.workId })
  if (snapshot.questions.length) {
    writeFileSync(
      readyPath,
      JSON.stringify({
        workId: receipt.workId,
        assignment: snapshot.works[0].actions.currentAssignment,
        recoveryRoot: dirname(
          loadRecoveryRunner(store, snapshot.questions[0].targets[0].attemptId).body.endpoint.socketPath,
        ),
      }),
      { mode: 0o600 },
    )
    break
  }
  await new Promise((resolve) => setTimeout(resolve, 20))
}
setInterval(() => {}, 1000)
