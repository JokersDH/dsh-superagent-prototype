import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sha256 } from './evidence.mjs'

export const FIXTURE_PROTOCOL = 'acceptance-fixture/1'
export const BUNDLE_CHECKLIST_PROTOCOL = 'acceptance-bundle-checklist/1'

const HEX = /^[a-f0-9]{64}$/
const ID = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/
const relative = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 256 &&
  !value.startsWith('/') &&
  !/^[A-Za-z]:/.test(value) &&
  !value.includes('\\') &&
  !value.includes('\0') &&
  !value.split('/').includes('..')

const exactKeys = (object, keys, label) => {
  const unknown = Object.keys(object).filter((key) => !keys.includes(key))
  const missing = keys.filter((key) => !(key in object))
  if (unknown.length) throw new Error(`${label} has unknown fields: ${unknown.join(',')}`)
  if (missing.length) throw new Error(`${label} is missing fields: ${missing.join(',')}`)
}

function validateScopeOutOfGrant(data) {
  exactKeys(data, ['projectId', 'scope'], 'scope-outside-grant.data')
  if (!ID.test(data.projectId)) throw new Error('scope-outside-grant needs a valid projectId')
  const scope = data.scope
  if (!scope || typeof scope !== 'object') throw new Error('scope-outside-grant needs a scope object')
  if (!Array.isArray(scope.allowedPaths) || scope.allowedPaths.length === 0)
    throw new Error('scope-outside-grant needs allowedPaths')
  if (scope.allowedPaths.some((path) => !relative(path)))
    throw new Error('scope-outside-grant paths must be project-relative')
  if (scope.allowedPaths.every((path) => path.startsWith('src/') || path === 'src'))
    throw new Error('scope-outside-grant must actually exceed the controlled src/ grant')
}

function validateCommand(data) {
  exactKeys(data, ['command', 'expect'], 'command.data')
  const command = data.command
  if (!command || typeof command !== 'object') throw new Error('command fixture needs a command object')
  for (const key of ['commandId', 'conversationId', 'kind'])
    if (typeof command[key] !== 'string' || !command[key]) throw new Error(`command fixture is missing ${key}`)
  if (!['http_status', 'receipt_status', 'error_code'].includes(data.expect))
    throw new Error('command.expect must be http_status, receipt_status or error_code')
}

function validateBundleChecklist(data) {
  exactKeys(data, ['version', 'files', 'rollback'], 'portability.data')
  if (typeof data.version !== 'string' || !data.version) throw new Error('Portability checklist needs a version')
  if (!Array.isArray(data.files) || data.files.length === 0)
    throw new Error('Portability checklist needs a file list')
  const paths = new Set()
  for (const file of data.files) {
    if (!file || typeof file !== 'object') throw new Error('Portability file entry must be an object')
    exactKeys(file, ['path', 'sha256', 'bytes'], 'portability.files[]')
    if (!relative(file.path)) throw new Error(`Portability path is not bundle-relative: ${String(file.path)}`)
    if (paths.has(file.path)) throw new Error(`Duplicate bundle path: ${file.path}`)
    paths.add(file.path)
    if (!HEX.test(file.sha256)) throw new Error(`Bad digest for ${file.path}`)
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) throw new Error(`Bad byte count for ${file.path}`)
  }
  const rollback = data.rollback
  if (!rollback || typeof rollback !== 'object') throw new Error('Portability checklist needs a rollback record')
  exactKeys(rollback, ['supported', 'restoresVersion'], 'portability.rollback')
  if (typeof rollback.supported !== 'boolean') throw new Error('rollback.supported must be boolean')
  if (rollback.restoresVersion !== null && !VERSION.test(String(rollback.restoresVersion)))
    throw new Error('rollback.restoresVersion must be null or a version identity')
}

const VALIDATORS = {
  'scope-outside-grant': validateScopeOutOfGrant,
  command: validateCommand,
  'portability-checklist': validateBundleChecklist,
  'bundle-checklist': validateBundleChecklist,
}

/**
 * Loads one acceptance-owned fixture by absolute path. The caller supplies the expected type; a
 * fixture claiming another type, carrying unknown fields, or failing its validator is illegal and
 * throws. Fixture bytes are digested so a later run can prove the same input was used.
 */
export function loadFixture(path, expectedType, options = {}) {
  const absolute = resolve(path)
  const bytes = readFileSync(absolute)
  let document
  try {
    document = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new Error(`Fixture is not JSON: ${error.message}`)
  }
  if (!document || typeof document !== 'object' || Array.isArray(document))
    throw new Error('Fixture must be a JSON object')
  exactKeys(document, ['protocol', 'id', 'type', 'data'], 'fixture')
  if (document.protocol !== FIXTURE_PROTOCOL)
    throw new Error(`Fixture protocol must be ${FIXTURE_PROTOCOL}, got ${String(document.protocol)}`)
  if (!ID.test(document.id)) throw new Error(`Fixture id is invalid: ${String(document.id)}`)
  if (document.type !== expectedType)
    throw new Error(`Fixture declares ${String(document.type)} but ${expectedType} was requested`)
  if (options.id && options.id !== document.id)
    throw new Error(`Fixture id ${document.id} does not match the expected ${options.id}`)
  const validator = VALIDATORS[document.type]
  if (!validator) throw new Error(`Unknown fixture type: ${String(document.type)}`)
  validator(document.data)
  return {
    id: document.id,
    type: document.type,
    path: absolute,
    sha256: sha256(bytes),
    data: document.data,
  }
}

export function resolveFixtureDigest(fixture) {
  if (!fixture || typeof fixture.path !== 'string') throw new Error('Fixture reference has no path')
  return sha256(readFileSync(fixture.path))
}
