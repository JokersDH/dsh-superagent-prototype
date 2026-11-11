import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Admission for the independent-review pilot's one real adapter.
 *
 * The wave-07 packet forbids treating a price file, a byte-per-token estimate or a missing adapter
 * as permission to send. This module evaluates a single adapter descriptor and returns the exact
 * blockers; only a descriptor that positively bounds every billed component, proves isolation and
 * carries a current main admission can authorize a reservation. There is no fallback path: a
 * missing or drifted descriptor is BLOCKED, never "use the CLI because it is installed".
 */
const here = fileURLToPath(new URL('.', import.meta.url))
export const ADAPTER_PATH = resolve(here, '../../../tools/experiments/review-pilot-01/runtime-interface.json')
export const ADAPTER_SCHEMA = 'review-pilot-adapter/1'
export const PRICE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
export const ADMISSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const EVIDENCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const HEX64 = /^[a-f0-9]{64}$/
const substantial = (value) => typeof value === 'string' && value.trim().length > 0
const finitePositive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0
const safePositiveInt = (value) => Number.isSafeInteger(value) && value > 0
const safeNonNegative = (value) => Number.isSafeInteger(value) && value >= 0
const fresh = (at, now, maxAge) => {
  const time = Date.parse(String(at ?? ''))
  return Number.isFinite(time) && now - time <= maxAge && time <= now + 60_000
}
const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]))
  return value
}
// Digest the JSON representation that is actually persisted, so an undefined field in memory can
// never produce a digest that the file cannot reproduce.
const canonical = (value) => JSON.stringify(sortKeys(JSON.parse(JSON.stringify(value))))
export const digestOf = (value) => createHash('sha256').update(canonical(value)).digest('hex')

/** Reads the descriptor without ever substituting a default adapter. */
export function readAdapterDescriptor(path = ADAPTER_PATH) {
  if (!existsSync(path)) return { state: 'missing', path }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    return { state: 'present', path, adapter: raw }
  } catch (error) {
    return { state: 'invalid', path, error: String(error.message ?? error) }
  }
}

function probeVersion(executable) {
  if (!substantial(executable) || !executable.startsWith('/') || !existsSync(executable)) return { ok: false, reason: 'not_executable' }
  try {
    const output = execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    return { ok: true, version: output }
  } catch (error) {
    return { ok: false, reason: String(error.message ?? error).slice(0, 200) }
  }
}

const BILLED_TOKENS = ['maxInputTokens', 'maxCachedInputTokens', 'maxCacheWriteInputTokens', 'maxOutputTokens', 'maxReasoningOutputTokens']
const PRICE_KEYS = {
  maxInputTokens: 'inputPerMillion',
  maxCachedInputTokens: 'cachedInputPerMillion',
  maxCacheWriteInputTokens: 'cacheWriteInputPerMillion',
  maxOutputTokens: 'outputPerMillion',
  maxReasoningOutputTokens: 'reasoningOutputPerMillion',
}

/**
 * Positive evaluation. Every blocker is named separately so a consumer cannot fix one facet and
 * assume the rest. Returns the declared whole-turn bound in tokens and USD when, and only when,
 * every billed component is bounded and priced.
 */
export function evaluateAdapter(adapter, { now = Date.now(), probe = probeVersion } = {}) {
  const blockers = []
  const add = (code, detail) => blockers.push({ code, detail })
  if (!adapter || typeof adapter !== 'object') {
    add('adapter_missing', 'No admitted adapter descriptor was supplied')
    return { ok: false, blockers, facts: null, bound: null }
  }
  if (adapter.schema !== ADAPTER_SCHEMA) add('adapter_invalid', `schema must be ${ADAPTER_SCHEMA}`)
  if (!substantial(adapter.adapterId)) add('adapter_invalid', 'adapterId')
  if (!substantial(adapter.executable) || !adapter.executable.startsWith('/')) add('adapter_invalid', 'executable must be an absolute path')
  if (adapter.fallbackExecutable !== undefined || adapter.fallback !== undefined)
    add('adapter_invalid', 'a fallback adapter path is not admissible')

  if (!substantial(adapter.model) || ['default', 'auto', 'alias', 'unknown'].includes(String(adapter.model).toLowerCase()))
    add('adapter_invalid', 'a concrete model identity is required')
  if (!substantial(adapter.provider) || ['default', 'auto', 'alias', 'unknown'].includes(String(adapter.provider).toLowerCase()))
    add('adapter_invalid', 'a concrete provider identity is required')

  const entry = adapter.entry ?? {}
  if (entry.owner !== 'b') add('adapter_invalid', 'the single send entry must be owned by B')
  if (entry.kind !== 'b-sender') add('adapter_invalid', 'entry.kind must be the B-owned sender, not a command')
  // E may not spawn a command from a descriptor. It imports the B sender module that owns the
  // transport, reservation identity and isolation; a missing module is BLOCKED.
  if (!substantial(entry.module) || !String(entry.module).startsWith('/')) add('adapter_invalid', 'entry.module must be an absolute B sender module')
  if (!substantial(entry.export ?? 'send')) add('adapter_invalid', 'entry.export')
  if (substantial(entry.module) && String(entry.module).startsWith('/') && !existsSync(entry.module))
    add('b_sender_unavailable', 'the admitted B sender module is not present')
  if (!substantial(entry.protocolVersion)) add('adapter_invalid', 'entry.protocolVersion')
  if (entry.fallbackCommand !== undefined || entry.fallback !== undefined || entry.command !== undefined)
    add('adapter_invalid', 'a fallback command or command list is not admissible')

  const version = probe(adapter.executable)
  if (!version.ok) add('adapter_invalid', `executable probe failed: ${version.reason}`)
  else if (!substantial(adapter.version) || !version.version.includes(adapter.version))
    add('adapter_version_drift', `declared ${adapter.version ?? 'none'} but the executable reports ${version.version}`)

  const pricing = adapter.pricing ?? {}
  if (pricing.currency !== 'USD') add('price_basis_incomplete', 'currency must be USD')
  if (pricing.unit !== 'per_million_tokens') add('price_basis_incomplete', 'unit must be per_million_tokens')
  if (!substantial(pricing.source)) add('price_basis_incomplete', 'price source')
  if (!fresh(pricing.observedAt, now, PRICE_MAX_AGE_MS)) add('price_basis_incomplete', 'price observedAt is missing or stale')
  for (const key of Object.values(PRICE_KEYS))
    if (!finitePositive(pricing[key])) add('price_basis_incomplete', `${key} must be a positive finite number`)
  if (pricing.toolRoundUSD !== undefined && !finitePositive(pricing.toolRoundUSD))
    add('price_basis_incomplete', 'toolRoundUSD must be positive when supplied')

  const bound = adapter.bound ?? {}
  for (const key of BILLED_TOKENS) if (!safePositiveInt(bound[key])) add('whole_turn_bound_unavailable', `${key} must be a positive integer`)
  if (!safePositiveInt(bound.maxTurns)) add('whole_turn_bound_unavailable', 'maxTurns must be a positive integer')
  if (!safeNonNegative(bound.maxToolRounds)) add('whole_turn_bound_unavailable', 'maxToolRounds must be a non-negative integer')
  if (bound.enforcedBeforeSend !== true) add('whole_turn_bound_unavailable', 'the runtime must enforce the bound before send')
  if (bound.usageBeforeCompletion !== true && bound.enforcedPostTurnCap !== true)
    add('whole_turn_bound_unavailable', 'usage that arrives only after the turn cannot bound it')
  if (!Array.isArray(bound.enforcementEvidence) || bound.enforcementEvidence.length === 0)
    add('whole_turn_bound_unavailable', 'enforcementEvidence')
  if (!fresh(bound.observedAt, now, EVIDENCE_MAX_AGE_MS)) add('whole_turn_bound_unavailable', 'bound observation is missing or stale')

  const isolation = adapter.isolation ?? {}
  if (isolation.proven !== true) add('isolation_unproven', 'isolation is not proven')
  for (const scope of ['author_credential', 'author_material', 'network_egress'])
    if (!Array.isArray(isolation.covers) || !isolation.covers.includes(scope)) add('isolation_unproven', `does not cover ${scope}`)
  if (!HEX64.test(String(isolation.evidenceDigest ?? ''))) add('isolation_unproven', 'evidenceDigest')
  if (!fresh(isolation.observedAt, now, EVIDENCE_MAX_AGE_MS)) add('isolation_unproven', 'isolation evidence is missing or stale')

  const session = adapter.session ?? {}
  if (session.resumeSupported !== true) add('session_evidence_missing', 'resume was not proven')
  if (session.freshThreadSupported !== true) add('session_evidence_missing', 'a fresh independent thread was not proven')
  if (!substantial(session.identityField)) add('session_evidence_missing', 'identityField')
  if (!fresh(session.observedAt, now, EVIDENCE_MAX_AGE_MS)) add('session_evidence_missing', 'session evidence is missing or stale')

  const material = adapter.material ?? {}
  if (material.sealedCopy !== true) add('material_evidence_missing', 'sealed copy was not proven')
  if (material.candidateFreeze !== true) add('material_evidence_missing', 'candidate freeze was not proven')
  if (!fresh(material.observedAt, now, EVIDENCE_MAX_AGE_MS)) add('material_evidence_missing', 'material evidence is missing or stale')

  const admission = adapter.admission ?? {}
  if (admission.by !== 'main') add('main_admission_missing', 'only a main admission can authorize the pilot')
  if (!substantial(admission.decisionRef)) add('main_admission_missing', 'decisionRef')
  if (!fresh(admission.decidedAt, now, ADMISSION_MAX_AGE_MS)) add('main_admission_missing', 'admission is missing or stale')
  if (!Array.isArray(admission.scope) || !admission.scope.includes('review-pilot-01')) add('main_admission_missing', 'scope')
  if (!HEX64.test(String(adapter.protocolDigest ?? ''))) add('main_admission_missing', 'protocolDigest must bind the frozen protocol')

  let turnsBound = null
  if (blockers.length === 0) {
    const perTurnTokens = BILLED_TOKENS.reduce((total, key) => total + bound[key], 0)
    const requestMultiplier = bound.maxTurns * (bound.maxToolRounds + 1)
    const totalTokens = perTurnTokens * requestMultiplier
    const perMillion = BILLED_TOKENS.reduce((total, key) => total + bound[key] * pricing[PRICE_KEYS[key]], 0)
    const toolUSD = (pricing.toolRoundUSD ?? 0) * bound.maxTurns * bound.maxToolRounds
    const totalUSD = (perMillion * requestMultiplier) / 1_000_000 + toolUSD
    if (!Number.isSafeInteger(totalTokens) || totalTokens <= 0) add('whole_turn_bound_unavailable', 'computed token bound is not a positive safe integer')
    if (!Number.isFinite(totalUSD) || totalUSD <= 0) add('price_basis_incomplete', 'computed USD bound is not positive and finite')
    turnsBound = { tokens: totalTokens, usd: totalUSD, perTurnTokens, requestMultiplier, components: BILLED_TOKENS.reduce((all, key) => ({ ...all, [key]: bound[key] }), {}) }
  }

  return {
    ok: blockers.length === 0,
    blockers,
    bound: turnsBound,
    facts: {
      adapterId: adapter.adapterId ?? null,
      executable: adapter.executable ?? null,
      version: adapter.version ?? null,
      observedVersion: version.ok ? version.version : null,
      model: adapter.model ?? null,
      provider: adapter.provider ?? null,
      entry: {
        owner: entry.owner ?? null,
        kind: entry.kind ?? null,
        module: entry.module ?? null,
        export: entry.export ?? 'send',
        protocolVersion: entry.protocolVersion ?? null,
      },
      pricing: adapter.pricing ? { ...adapter.pricing } : null,
      protocolDigest: adapter.protocolDigest ?? null,
      bound: turnsBound,
      admissionRef: admission.decisionRef ?? null,
    },
  }
}

/** The current honest answer: the committed descriptor is absent, so no send is admitted. */
export function currentAdmission(options = {}) {
  const view = readAdapterDescriptor(options.path)
  if (view.state === 'missing') {
    return {
      ok: false,
      blockers: [{ code: 'adapter_missing', detail: `No admitted adapter descriptor at ${view.path}` }],
      facts: null,
      bound: null,
      descriptor: { state: 'missing', path: view.path },
    }
  }
  if (view.state === 'invalid') {
    return {
      ok: false,
      blockers: [{ code: 'adapter_invalid', detail: view.error }],
      facts: null,
      bound: null,
      descriptor: { state: 'invalid', path: view.path },
    }
  }
  const evaluated = evaluateAdapter(view.adapter, options)
  return { ...evaluated, descriptor: { state: 'present', path: view.path } }
}

/**
 * A synthetic descriptor used only by the acceptance selftest. It is never read by preflight; the
 * test calls evaluateAdapter directly so no repository file can accidentally admit a send.
 */
export function makeTestAdapter({ executable, version = 'fake-cli 1.0.0', now = Date.now(), overrides = {} } = {}) {
  const at = new Date(now).toISOString()
  return {
    schema: ADAPTER_SCHEMA,
    adapterId: 'test-adapter',
    executable,
    version,
    model: 'test-model',
    provider: 'test-provider',
    entry: { owner: 'b', kind: 'b-sender', module: executable, export: 'send', protocolVersion: 'selftest/1' },
    protocolDigest: 'a'.repeat(64),
    pricing: {
      currency: 'USD',
      unit: 'per_million_tokens',
      source: 'selftest schedule',
      observedAt: at,
      inputPerMillion: 1,
      cachedInputPerMillion: 0.5,
      cacheWriteInputPerMillion: 1,
      outputPerMillion: 2,
      reasoningOutputPerMillion: 2,
      toolRoundUSD: 0.0001,
    },
    bound: {
      maxInputTokens: 10000,
      maxCachedInputTokens: 4000,
      maxCacheWriteInputTokens: 2000,
      maxOutputTokens: 4000,
      maxReasoningOutputTokens: 4000,
      maxTurns: 2,
      maxToolRounds: 2,
      enforcedBeforeSend: true,
      usageBeforeCompletion: true,
      enforcementEvidence: ['selftest-bound'],
      observedAt: at,
    },
    isolation: { proven: true, covers: ['author_credential', 'author_material', 'network_egress'], evidenceDigest: 'b'.repeat(64), observedAt: at },
    session: { resumeSupported: true, freshThreadSupported: true, identityField: 'thread_id', observedAt: at },
    material: { sealedCopy: true, candidateFreeze: true, observedAt: at },
    admission: { by: 'main', decisionRef: 'selftest-decision', decidedAt: at, scope: ['review-pilot-01'] },
    ...overrides,
  }
}
