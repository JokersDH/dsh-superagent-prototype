/**
 * Zero-model Codex app-server schema probe (Milestone 04).
 *
 * It runs only `--version` and `app-server generate-json-schema`; it never sends a prompt, starts a
 * model turn, reads credentials or mutates the account. The observed surface is parsed from the CLI's
 * own schema files and compared with the methods/fields/enums/notifications/request-id shapes the
 * Driver actually uses. A missing executable, timeout or parse failure is UNKNOWN, never compatible.
 */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ProtocolSurface, RequiredSurface, SurfaceObservation } from '../../../catalog/src/compatibility.ts'

const run = promisify(execFile)

/** Exactly the protocol facts the Codex Driver's code uses today. */
export function codexRequiredSurface(): RequiredSurface {
  return {
    wireVersion: 'codex-app-server-json-schema',
    methods: ['initialize', 'thread/start', 'turn/start', 'turn/steer', 'turn/interrupt'],
    requestFields: {
      initialize: ['clientInfo', 'capabilities'],
      'thread/start': ['model', 'approvalPolicy', 'sandbox'],
      'turn/start': ['threadId', 'input'],
      'turn/steer': ['threadId', 'expectedTurnId', 'input'],
      'turn/interrupt': ['threadId', 'turnId'],
    },
    enums: {
      'turn/completed': ['failed', 'interrupted', 'completed'],
      'item/started': ['text', 'reasoning', 'commandExecution', 'fileChange', 'mcpToolCall'],
    },
    // Required for a deliverable turn. `item/updated` and `config/changed` are handled defensively when
    // present but are not part of the pinned 0.164 protocol surface, so they are not required.
    notifications: ['item/started', 'item/completed', 'turn/completed', 'thread/tokenUsage/updated'],
    serverRequestPatterns: ['requestApproval', 'requestUserInput'],
    requestIdTypes: ['integer', 'string'],
    requiredFields: { initialize: ['clientInfo'], 'turn/start': ['threadId', 'input'], 'turn/steer': ['threadId', 'expectedTurnId', 'input'], 'turn/interrupt': ['threadId', 'turnId'] },
    fieldTypes: {
      initialize: { clientInfo: ['object'], capabilities: ['object'] },
      'thread/start': { model: ['string', 'null'], approvalPolicy: ['string', 'null'], sandbox: ['string', 'null'] },
      'turn/start': { threadId: ['string'], input: ['array'] },
      'turn/steer': { threadId: ['string'], expectedTurnId: ['string'], input: ['array'] },
      'turn/interrupt': { threadId: ['string'], turnId: ['string'] },
    },
  }
}

type Json = Record<string, unknown>
const asObject = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : []

function enumValues(node: unknown, definitions: Json, seen = new Set<string>()): string[] {
  if (!node || typeof node !== 'object') return []
  const value = node as Json
  const ref = typeof value.$ref === 'string' ? value.$ref.split('/').pop() : undefined
  if (ref && !seen.has(ref)) {
    seen.add(ref)
    return enumValues(definitions[ref], definitions, seen)
  }
  const found: string[] = []
  if (Array.isArray(value.enum)) for (const item of value.enum) if (typeof item === 'string') found.push(item)
  for (const key of ['properties', 'items', 'anyOf', 'oneOf', 'allOf']) {
    const child = value[key]
    if (Array.isArray(child)) for (const item of child) found.push(...enumValues(item, definitions, seen))
    else if (child && typeof child === 'object') {
      if (key === 'properties') for (const item of Object.values(child)) found.push(...enumValues(item, definitions, seen))
      else found.push(...enumValues(child, definitions, seen))
    }
  }
  return found
}

function typeValues(node: unknown, definitions: Json, seen = new Set<string>()): string[] {
  if (!node || typeof node !== 'object') return []
  const value = node as Json
  const ref = typeof value.$ref === 'string' ? value.$ref.split('/').pop() : undefined
  if (ref && !seen.has(ref)) {
    seen.add(ref)
    return typeValues(definitions[ref], definitions, seen)
  }
  const found: string[] = []
  if (typeof value.type === 'string') found.push(value.type)
  if (Array.isArray(value.type)) for (const type of value.type) if (typeof type === 'string') found.push(type)
  for (const key of ['anyOf', 'oneOf']) for (const item of asArray(value[key])) found.push(...typeValues(item, definitions, seen))
  return found
}

function definitionProperties(node: Json, definitions: Json): string[] {
  return Object.keys(definitionSchema(node, definitions).properties ?? {})
}
function definitionSchema(node: Json, definitions: Json): { properties: Json; required: string[] } {
  const ref = typeof node.$ref === 'string' ? node.$ref.split('/').pop() : undefined
  const target = ref ? asObject(definitions[ref]) : node
  return { properties: asObject(target.properties), required: asArray(target.required).filter(item => typeof item === 'string') as string[] }
}
function fieldTypesOf(node: Json, definitions: Json): Record<string, string[]> {
  const target = definitionSchema(node, definitions)
  return Object.fromEntries(Object.entries(target.properties).map(([name, schema]) => [name, [...new Set(typeValues(schema, definitions))].sort()]))
}

/** Parse the generated Codex schema files into the shared ProtocolSurface. */
export function observeCodexSchema(files: {
  clientRequest: unknown
  serverRequest: unknown
  serverNotification: unknown
  requestId: unknown
}): ProtocolSurface {
  const client = asObject(files.clientRequest)
  const definitions = asObject(client.definitions)
  const methods: string[] = []
  const requestFields: Record<string, string[]> = {}
  const fieldTypes: Record<string, Record<string, string[]>> = {}
  const requiredFields: Record<string, string[]> = {}
  const enums: Record<string, string[]> = {}
  for (const entry of asArray(client.oneOf)) {
    const request = asObject(entry)
    const properties = asObject(request.properties)
    const method = asArray(asObject(properties.method).enum).find(value => typeof value === 'string') as string | undefined
    if (!method) continue
    methods.push(method)
    requestFields[method] = definitionProperties(asObject(properties.params), definitions).sort()
    fieldTypes[method] = fieldTypesOf(asObject(properties.params), definitions)
    requiredFields[method] = [...definitionSchema(asObject(properties.params), definitions).required].sort()
    enums[method] = [...new Set(enumValues(properties.params, definitions))].sort()
  }
  const notifications: string[] = []
  const notificationDefs = asObject(asObject(files.serverNotification).definitions)
  for (const entry of asArray(asObject(files.serverNotification).oneOf)) {
    const properties = asObject(asObject(entry).properties)
    const method = asArray(asObject(properties.method).enum).find(value => typeof value === 'string') as string | undefined
    if (!method) continue
    notifications.push(method)
    enums[method] = [...new Set([...(enums[method] ?? []), ...enumValues(properties.params, notificationDefs)])].sort()
    requestFields[method] = [...new Set([...(requestFields[method] ?? []), ...definitionProperties(asObject(properties.params), notificationDefs)])].sort()
    fieldTypes[method] = { ...(fieldTypes[method] ?? {}), ...fieldTypesOf(asObject(properties.params), notificationDefs) }
    requiredFields[method] = [...new Set([...(requiredFields[method] ?? []), ...definitionSchema(asObject(properties.params), notificationDefs).required])].sort()
  }
  const serverRequests: string[] = []
  const serverDefs = asObject(asObject(files.serverRequest).definitions)
  for (const entry of asArray(asObject(files.serverRequest).oneOf)) {
    const properties = asObject(asObject(entry).properties)
    const method = asArray(asObject(properties.method).enum).find(value => typeof value === 'string') as string | undefined
    if (method) serverRequests.push(method)
  }
  const requestIdTypes = [...new Set(typeValues(files.requestId, asObject(asObject(files.requestId).definitions)))].sort()
  const canonical = {
    wireVersion: 'codex-app-server-json-schema',
    methods: [...methods].sort(), requestFields: Object.fromEntries(Object.entries(requestFields).sort(([a], [b]) => a < b ? -1 : 1)),
    enums: Object.fromEntries(Object.entries(enums).sort(([a], [b]) => a < b ? -1 : 1)),
    fieldTypes: Object.fromEntries(Object.entries(fieldTypes).sort(([a], [b]) => a < b ? -1 : 1)),
    requiredFields: Object.fromEntries(Object.entries(requiredFields).sort(([a], [b]) => a < b ? -1 : 1)),
    notifications: [...notifications].sort(), serverRequests: [...serverRequests].sort(), requestIdTypes,
  }
  return { ...canonical, schemaDigest: createHash('sha256').update(JSON.stringify(canonical)).digest('hex') }
}

export type CodexSurfaceProbeOptions = { executable: string; argv?: readonly string[]; timeoutMs?: number; version?: string }

/**
 * Run the zero-model probe against one installed Codex. Returns observed facts or an explicit
 * missing/failed/timeout observation; it never guesses compatibility.
 */
export async function probeCodexSurface(options: CodexSurfaceProbeOptions): Promise<SurfaceObservation> {
  const evidence: string[] = []
  let version = options.version
  try {
    if (version === undefined) {
      const result = await run(options.executable, ['--version'], { timeout: options.timeoutMs ?? 15000, maxBuffer: 64 * 1024, encoding: 'utf8' })
      version = String(result.stdout).trim().split('\n').pop()?.trim().replace(/^codex-cli\s+/i, '')
      if (!version) return { status: 'failed', reason: 'version_unreadable', evidenceRefs: evidence }
    }
    evidence.push(`codex-version:${version}`)
    const dir = await mkdtemp(join(tmpdir(), 'pa-codex-schema-'))
    try {
      const argv = [...(options.argv ?? [])]
      const command = argv.includes('app-server')
        ? [...argv, 'generate-json-schema', '--out', dir]
        : [...argv, 'app-server', 'generate-json-schema', '--out', dir]
      await run(options.executable, command, { timeout: options.timeoutMs ?? 15000, maxBuffer: 256 * 1024, encoding: 'utf8' })
      const read = async (name: string): Promise<unknown> => JSON.parse(await readFile(join(dir, name), 'utf8'))
      const surface = observeCodexSchema({
        clientRequest: await read('ClientRequest.json'),
        serverRequest: await read('ServerRequest.json'),
        serverNotification: await read('ServerNotification.json'),
        requestId: await read('RequestId.json'),
      })
      evidence.push(`codex-schema:${surface.schemaDigest}`)
      return { status: 'observed', surface, evidenceRefs: evidence }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  } catch (error) {
    const failed = error as { code?: string; killed?: boolean; signal?: string; message?: string }
    const status = failed.killed || failed.signal === 'SIGTERM' ? 'timeout' : failed.code === 'ENOENT' ? 'missing' : 'failed'
    return { status, reason: `${status}:${String(failed.message ?? error).slice(0, 160)}`, evidenceRefs: evidence }
  }
}
