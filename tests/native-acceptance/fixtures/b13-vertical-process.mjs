#!/usr/bin/env node
/**
 * B13 vertical-path process fixture (wave-13 B1).
 *
 * One short-lived process running the REAL product path: createControlledProduct, create_work, the
 * child Runner, the QuestionBroker question. Modes either stop after the question is registered and
 * kill themselves with SIGKILL, or recover from the same store in a fresh process.
 *
 * Usage: node b13-vertical-process.mjs <root> <mode>
 * Modes: question | recover
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/src/index.ts'
import { createControlledProduct, FIXTURE_CHECK } from '../../../apps/coordinator/product/runtime.ts'

const [root, mode] = process.argv.slice(2)
const stateRoot = join(root, 'state')
const scratchProject = join(root, 'project')
mkdirSync(stateRoot, { recursive: true, mode: 0o700 })
mkdirSync(scratchProject, { recursive: true, mode: 0o700 })

const principal = { userId: 'local-product-user', authorityRef: 'local-product-authority' }
const actor = { ...principal, source: 'local_cli' }
const scope = { projectId: 'project-scratch', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const criteria = [{ id: 'criterion-output', kind: 'machine', required: true, description: 'Fixed output matches', checkDefinitionRef: FIXTURE_CHECK }]

const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
const count = name => { try { return Number(store.db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n) } catch { return null } }
const tables = () => ({
  works: count('works'), tickets: count('ticket'), questions: count('user_questions'),
  deliveries: count('answer_deliveries'), facts: count('fact_receipts'), dispatch: count('dispatch_receipts'),
})
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`)

let product
try {
  product = createControlledProduct({
    store, principal, projects: [{ id: scope.projectId, scope }],
    actionSecret: Buffer.alloc(32, 1), stateRoot, scratchProject,
  })
  product.start()
  let seq = 0
  const command = value => product.application.dispatch(
    { commandId: `w13-child-${++seq}`, conversationId: 'conversation-product', ...value }, actor)

  if (mode === 'question') {
    // The scratch repo must exist before create_work; the driver always prepares it first.
    gitInit()
    const created = await command({ kind: 'create_work', projectId: scope.projectId, goal: 'Produce the controlled scratch artifact', profileId: 'profile-fixture-question', scope, criteria })
    const deadline = Date.now() + 20_000
    let snapshot
    while (Date.now() < deadline) {
      snapshot = { ...(await product.application.inspect({})), tables: tables() }
      if (snapshot.questions.length >= 1) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    emit({ workId: created.workId, questions: snapshot?.questions?.length ?? 0, tables: snapshot?.tables })
    // Kill AFTER the question is durable, so recovery must not re-begin or re-ask.
    process.kill(process.pid, 'SIGKILL')
    await new Promise(() => {})
  } else if (mode === 'recover') {
    // A genuinely fresh process: reopen the same store and report what the product recorded.
    emit({ tables: tables(), questions: (await product.application.inspect({})).questions.length })
  } else {
    throw new Error(`unknown mode ${mode}`)
  }
} finally {
  try { await product?.close() } catch {}
  try { store.close() } catch {}
}

function gitInit() {
  const git = args => execFileSync('git', args, { cwd: scratchProject, stdio: 'pipe' })
  try { git(['init', '-q']) } catch { return }
  mkdirSync(join(scratchProject, 'src'), { recursive: true })
  writeFileSync(join(scratchProject, 'src', '.gitkeep'), '')
  git(['add', 'src/.gitkeep'])
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'base'])
}
