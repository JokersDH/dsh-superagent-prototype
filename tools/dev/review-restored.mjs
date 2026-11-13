import { closeSync, fsyncSync, openSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'
import { PRODUCT_SCHEMA_VERSION, ProductStore, verifyDatabase } from '../../packages/storage/dist/index.js'
import { localCredentials } from '../../apps/coordinator/http/local-state.ts'
import { prepareRestoredReview } from '../../apps/coordinator/product/restored-review.ts'

const { values } = parseArgs({ options: { state: { type: 'string' }, project: { type: 'string' },
  'allow-path': { type: 'string', multiple: true }, 'exclude-path': { type: 'string', multiple: true }, output: { type: 'string' } } })
if (!values.state || !values.project || !values['allow-path']?.length || !values.output)
  throw new Error('Usage: node tools/dev/review-restored.mjs --state <restored-root> --project <historical-id> --allow-path <scope> [--allow-path <scope>] --output <new-private-file>')
const state = resolve(values.state), output = resolve(values.output), database = join(state, 'state.sqlite')
const verified = verifyDatabase(database)
if (verified.productSchema !== PRODUCT_SCHEMA_VERSION || verified.integrity !== 'ok' || verified.foreignKeyViolations)
  throw new Error('Review preparation requires a verified current restored database; it does not upgrade old data')
const credential = localCredentials(state), secret = Buffer.from(credential('action.key'), 'hex')
const store = new ProductStore({ path: database })
try {
  const file = prepareRestoredReview(store, state, { userId: 'local-demo-user', authorityRef: 'local-demo-authority' },
    [{ projectId: values.project, allowedPaths: values['allow-path'], excludedPaths: values['exclude-path'] ?? ['.git'] }], secret)
  const fd = openSync(output, 'wx', 0o600)
  try { writeFileSync(fd, JSON.stringify(file, null, 2) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
  process.stdout.write(JSON.stringify({ status: 'prepared', projects: file.payload.projects.map(project => project.projectId),
    expiresAt: file.payload.expiresAt, access: file.payload.access, startupAvailable: false, output }) + '\n')
} finally { store.close() }
