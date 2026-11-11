import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { digestOf } from './admission.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
// The real ledger has one fixed location. PA_PILOT_LEDGER exists only so the runner's own accounting
// can be exercised on a disposable ledger; it must never point at the committed ledger in a test.
const ledgerPath = process.env.PA_PILOT_LEDGER ? resolve(process.env.PA_PILOT_LEDGER) : join(here, 'ledger.json')

export const GRANT = Object.freeze({
  id: 'wave05-independent-review-pilot-01',
  maxTotalTurnStarts: 24,
  maxAuthorTurnStarts: 8,
  maxReviewTurnStarts: 16,
  maxTotalBillableTokens: 200000,
  maxTotalCostUSD: 5,
})
const LEDGER_SCHEMA = 'review-pilot-ledger/2'
const LEDGER_STATUSES = new Set([
  'NOT_STARTED',
  'IN_PROGRESS',
  'BLOCKED_PREFLIGHT',
  'BLOCKED_UNKNOWN_USAGE',
  'BLOCKED_BOUND_VIOLATION',
  'READY_NOT_EXECUTED',
  'READY_RESUME',
  'COMPLETED',
  'BLOCKED',
])
const RESERVATION_STATUSES = new Set(['in_flight', 'settled', 'unknown'])

const readJson = (path) => {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) }
  } catch (error) {
    return { ok: false, error: String(error.message ?? error) }
  }
}

function writeAtomic(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  renameSync(temporary, path)
}

/**
 * Serializes ledger mutations. A second writer that cannot take the lock refuses instead of
 * racing the first; the lock is a file next to the ledger so it also spans processes.
 */
function withLedgerLock(path, body) {
  const lockPath = `${path}.lock`
  let fd
  try {
    fd = openSync(lockPath, 'wx', 0o600)
  } catch {
    return { locked: true }
  }
  try {
    return { locked: false, value: body() }
  } finally {
    try { closeSync(fd) } catch { /* already closed */ }
    try { unlinkSync(lockPath) } catch { /* removed by cleanup */ }
  }
}

const capsFromGrant = () => ({
  maxTotalTurnStarts: GRANT.maxTotalTurnStarts,
  maxAuthorTurnStarts: GRANT.maxAuthorTurnStarts,
  maxReviewTurnStarts: GRANT.maxReviewTurnStarts,
  maxTotalBillableTokens: GRANT.maxTotalBillableTokens,
  maxTotalCostUSD: GRANT.maxTotalCostUSD,
})

function freshLedger() {
  return {
    schema: LEDGER_SCHEMA,
    grantId: GRANT.id,
    ledgerId: GRANT.id,
    historyComplete: true,
    createdAt: new Date().toISOString(),
    caps: capsFromGrant(),
    status: 'NOT_STARTED',
    reservation: { turns: 0, tokens: 0, unknownTurns: 0 },
    actual: { turns: 0, tokens: 0, costUSD: 0, unknownTurns: 0 },
    reservations: [],
    turns: [],
  }
}

const substantial = (value) => typeof value === 'string' && value.trim().length > 0
const intAtLeast = (value, minimum) => Number.isSafeInteger(value) && value >= minimum
const isFiniteNonNegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0

/**
 * Validates an existing ledger file. A damaged, truncated, mismatched or history-incomplete ledger
 * is never treated as an all-zero ledger; the caller must stop instead of creating usable budget.
 */
export function validateLedger(raw) {
  const issues = []
  const fail = (code, detail) => issues.push({ code, detail })
  if (!raw || typeof raw !== 'object') return { ok: false, issues: [{ code: 'ledger_invalid', detail: 'not an object' }] }
  if (raw.schema === 'review-pilot-ledger/1') {
    const issues = []
    if (raw.grantId !== GRANT.id) issues.push({ code: 'legacy_identity', detail: 'grant identity differs' })
    const caps = raw.caps ?? {}
    for (const [key, value] of Object.entries(capsFromGrant()))
      if (caps[key] !== value) issues.push({ code: 'legacy_caps', detail: `${key} is missing or differs` })
    const actual = raw.actual
    const reservation = raw.reservation
    if (!actual || !Number.isSafeInteger(actual.turns) || !Number.isSafeInteger(actual.tokens) ||
      !Number.isSafeInteger(actual.unknownTurns) || !(actual.costUSD === 0 || actual.costUSD === null))
      issues.push({ code: 'legacy_incomplete', detail: 'actual fields are missing or not provably empty' })
    else if (actual.turns !== 0 || actual.tokens !== 0 || actual.unknownTurns !== 0)
      issues.push({ code: 'legacy_history_unverifiable', detail: 'A v1 ledger with usage cannot be verified; do not rebuild it as zero' })
    if (!reservation || !Number.isSafeInteger(reservation.turns) || !Number.isSafeInteger(reservation.tokens) ||
      !Number.isSafeInteger(reservation.unknownTurns) || reservation.turns !== 0 || reservation.tokens !== 0 || reservation.unknownTurns !== 0)
      issues.push({ code: 'legacy_reservation_unverifiable', detail: 'A v1 ledger with reservations cannot be verified' })
    if (!Array.isArray(raw.reservations) || raw.reservations.length !== 0)
      issues.push({ code: 'legacy_reservation_unverifiable', detail: 'reservation history is missing or non-empty' })
    if (!Array.isArray(raw.turns) || raw.turns.length !== 0)
      issues.push({ code: 'legacy_history_unverifiable', detail: 'turn history is missing or non-empty' })
    if (raw.status === 'BLOCKED_UNKNOWN_USAGE')
      issues.push({ code: 'legacy_unknown_usage', detail: 'unknown usage cannot migrate into a fresh zero ledger' })
    if (!LEDGER_STATUSES.has(raw.status)) issues.push({ code: 'legacy_status', detail: String(raw.status) })
    if (issues.length > 0) return { ok: false, issues }
    return { ok: true, legacy: true, value: raw }
  }
  if (raw.schema !== LEDGER_SCHEMA) fail('ledger_schema', `expected ${LEDGER_SCHEMA}`)
  if (raw.grantId !== GRANT.id || raw.ledgerId !== GRANT.id) fail('ledger_identity', 'grant identity mismatch')
  if (raw.historyComplete !== true) fail('ledger_history_incomplete', 'historyComplete must be true')
  const caps = raw.caps ?? {}
  for (const [key, value] of Object.entries(capsFromGrant()))
    if (caps[key] !== value) fail('ledger_caps_mismatch', `${key} must be ${value}`)
  if (!LEDGER_STATUSES.has(raw.status)) fail('ledger_status', String(raw.status))
  const actual = raw.actual ?? {}
  if (!intAtLeast(actual.turns, 0) || !intAtLeast(actual.tokens, 0) || !intAtLeast(actual.unknownTurns, 0))
    fail('ledger_actual', 'turns/tokens/unknownTurns must be non-negative integers')
  if (actual.costUSD !== null && !isFiniteNonNegative(actual.costUSD)) fail('ledger_actual', 'costUSD must be finite or null')
  if (actual.costUSD === null && actual.turns !== 0) fail('ledger_actual', 'null cost is only valid before any turn')
  const reservation = raw.reservation ?? {}
  for (const key of ['turns', 'tokens', 'unknownTurns'])
    if (!intAtLeast(reservation[key], 0)) fail('ledger_reservation', `${key} must be a non-negative integer`)
  const reservations = raw.reservations
  const turns = raw.turns
  if (!Array.isArray(reservations)) fail('ledger_reservations', 'reservations must be an array')
  if (!Array.isArray(turns)) fail('ledger_turns', 'turns must be an array')
  if (Array.isArray(reservations)) {
    const ids = new Set()
    for (const item of reservations) {
      if (!item || typeof item !== 'object') { fail('ledger_reservation', 'entry is not an object'); continue }
      if (typeof item.turnId !== 'string' || item.turnId.length === 0) fail('ledger_reservation', 'turnId')
      else if (ids.has(item.turnId)) fail('ledger_reservation', `duplicate turnId ${item.turnId}`)
      else ids.add(item.turnId)
      if (!RESERVATION_STATUSES.has(item.status)) fail('ledger_reservation', `status ${item.status}`)
      if (!intAtLeast(item.upperTokens, 1)) fail('ledger_reservation', 'upperTokens must be a positive integer')
      if (!isFiniteNonNegative(item.upperUSD)) fail('ledger_reservation', 'upperUSD must be finite and non-negative')
    }
  }
  if (Array.isArray(turns)) {
    if (!Array.isArray(reservations) || turns.length !== actual.turns) fail('ledger_history_incomplete', 'turn history does not match actual.turns')
    const unknown = turns.filter((item) => item?.usage === null || item?.unknown === true).length
    if (unknown !== actual.unknownTurns) fail('ledger_history_incomplete', 'unknown turn count does not match history')
    const ids = new Set(Array.isArray(reservations) ? reservations.map((item) => item.turnId) : [])
    for (const item of turns) if (!ids.has(item?.turnId)) fail('ledger_history_incomplete', `turn ${item?.turnId} has no reservation`)
  }
  if (raw.integrity !== undefined) {
    const { integrity, ...body } = raw
    if (integrity !== digestOf(body)) fail('ledger_integrity', 'content digest mismatch')
  } else fail('ledger_integrity', 'missing content digest')
  return { ok: issues.length === 0, legacy: false, issues, value: raw }
}

/**
 * Returns the ledger view. `state` is NOT_CREATED only when no file exists; an existing but invalid
 * file is CORRUPT and carries the issues, never a zero-filled default.
 */
export function readLedgerView({ path = ledgerPath } = {}) {
  if (!existsSync(path)) return { state: 'NOT_CREATED', data: freshLedger(), issues: [], path }
  const parsed = readJson(path)
  if (!parsed.ok) return { state: 'CORRUPT', data: undefined, issues: [{ code: 'ledger_unparseable', detail: parsed.error }], path }
  const validation = validateLedger(parsed.value)
  if (!validation.ok) return { state: 'CORRUPT', data: undefined, issues: validation.issues, path }
  if (validation.legacy) {
    return {
      state: 'NOT_CREATED',
      data: { ...freshLedger(), migratedFrom: 'review-pilot-ledger/1', createdAt: parsed.value.createdAt ?? new Date().toISOString() },
      issues: [],
      legacy: true,
      path,
    }
  }
  return { state: 'OK', data: parsed.value, issues: [], path }
}

/** Compatibility helper for readers that only need the numbers; throws on a corrupt ledger. */
export function readLedger(options) {
  const view = readLedgerView(options)
  if (view.state === 'CORRUPT') {
    const error = new Error(`Ledger is corrupt: ${view.issues.map((item) => item.code).join(', ')}`)
    error.code = 'ledger_corrupt'
    throw error
  }
  return view.data
}

function sealedLedger(data, patch = {}) {
  const next = { ...data, ...patch, updatedAt: new Date().toISOString() }
  delete next.integrity
  return { ...next, integrity: digestOf(next) }
}

/** Annotates status fields only. A corrupt ledger is left byte-for-byte untouched. */
export function annotateLedger(patch, options) {
  const view = readLedgerView(options)
  if (view.state === 'CORRUPT') return { state: 'CORRUPT', skipped: true, issues: view.issues }
  const locked = withLedgerLock(view.path, () => {
    const current = readLedgerView(options)
    if (current.state === 'CORRUPT') return { state: 'CORRUPT', skipped: true, issues: current.issues }
    writeAtomic(current.path, sealedLedger(current.data, patch))
    return readLedgerView(options)
  })
  return locked.locked ? { state: 'LEDGER_LOCKED' } : locked.value
}

export function readPricing(path = join(here, 'pricing.json')) {
  if (!existsSync(path)) return undefined
  const parsed = readJson(path)
  if (!parsed.ok) return undefined
  const value = parsed.value
  if (
    typeof value.model === 'string' &&
    typeof value.inputPerMillion === 'number' &&
    typeof value.outputPerMillion === 'number' &&
    value.currency === 'USD' &&
    typeof value.source === 'string' &&
    typeof value.observedAt === 'string'
  )
    return value
  return undefined
}

const CAP_REASONS = new Set([
  'one_turn_in_flight',
  'turn_cap',
  'author_turn_cap',
  'review_turn_cap',
  'budget_ceiling',
  'unknown_usage_unresolved',
  'bound_violation_unresolved',
  'duplicate_turn_identity',
])

/**
 * Reserves the admitted whole-turn bound before a send. The bound comes from the adapter descriptor
 * and is used in full: no byte estimate, no fixed padding and no `Math.min` clipping may authorize.
 * Returns `{ ok:false, reason, blockers }` without any write when the ledger or admission is not
 * sound; a replay of the same case/arm/admission returns the existing in-flight reservation.
 */
export function reserveTurn(args = {}) {
  const view = readLedgerView(args.options)
  const locked = withLedgerLock(view.path, () => reserveTurnUnlocked(args))
  return locked.locked ? { ok: false, reason: 'ledger_locked' } : locked.value
}

function reserveTurnUnlocked({ caseId, arm, admission, options } = {}) {
  const view = readLedgerView(options)
  if (view.state === 'CORRUPT')
    return { ok: false, reason: 'ledger_corrupt', blockers: view.issues }
  if (!admission?.ok)
    return { ok: false, reason: 'admission_blocked', blockers: admission?.blockers ?? [{ code: 'adapter_missing', detail: 'no admission' }] }
  const bound = admission.bound
  if (!bound || !intAtLeast(bound.tokens, 1) || !isFiniteNonNegative(bound.usd) || bound.usd <= 0)
    return { ok: false, reason: 'bound_unavailable', blockers: [{ code: 'whole_turn_bound_unavailable', detail: 'admission has no positive bound' }] }

  const ledger = view.data
  if (ledger.status === 'BLOCKED_UNKNOWN_USAGE') return { ok: false, reason: 'unknown_usage_unresolved' }
  if (ledger.status === 'BLOCKED_BOUND_VIOLATION') return { ok: false, reason: 'bound_violation_unresolved' }
  const inFlight = (ledger.reservations ?? []).filter((item) => item.status === 'in_flight')
  const admissionDigest = digestOf(admission.facts ?? {})
  const replay = inFlight.find((item) => item.caseId === caseId && item.arm === arm && item.admissionDigest === admissionDigest)
  if (replay) return { ok: true, reservation: replay, replayed: true }
  if (inFlight.length > 0) return { ok: false, reason: 'one_turn_in_flight' }

  const usedTurns = ledger.actual.turns
  if (usedTurns >= GRANT.maxTotalTurnStarts) return { ok: false, reason: 'turn_cap' }
  const authorTurns = (ledger.reservations ?? []).filter((item) => item.arm === 'author').length
  const reviewTurns = (ledger.reservations ?? []).filter((item) => item.arm !== 'author').length
  if (arm === 'author' && authorTurns >= GRANT.maxAuthorTurnStarts) return { ok: false, reason: 'author_turn_cap' }
  if (arm !== 'author' && reviewTurns >= GRANT.maxReviewTurnStarts) return { ok: false, reason: 'review_turn_cap' }

  const reservedTokens = inFlight.reduce((total, item) => total + item.upperTokens, 0)
  const reservedUSD = inFlight.reduce((total, item) => total + item.upperUSD, 0)
  const spentTokens = ledger.actual.tokens
  const spentUSD = ledger.actual.costUSD ?? 0
  if (spentTokens + reservedTokens + bound.tokens > GRANT.maxTotalBillableTokens) return { ok: false, reason: 'budget_ceiling' }
  if (spentUSD + reservedUSD + bound.usd > GRANT.maxTotalCostUSD) return { ok: false, reason: 'budget_ceiling' }

  const reservation = {
    turnId: `turn-${randomUUID()}`,
    caseId,
    arm,
    upperTokens: bound.tokens,
    upperUSD: bound.usd,
    admissionDigest,
    boundComponents: bound.components ?? null,
    status: 'in_flight',
    reservedAt: new Date().toISOString(),
  }
  const next = sealedLedger(ledger, {
    status: 'IN_PROGRESS',
    reservation: { turns: inFlight.length + 1, tokens: reservedTokens + bound.tokens, unknownTurns: ledger.reservation.unknownTurns },
    reservations: [...ledger.reservations, reservation],
    ...(ledger.migratedFrom ? { migratedFrom: ledger.migratedFrom } : {}),
  })
  writeAtomic(view.path, next)
  return { ok: true, reservation }
}

/**
 * Settles exactly once. A repeated settlement of the same turn is a replay and changes nothing. A
 * missing/unverifiable usage is charged at the reservation bound and blocks further sends; a
 * measured overrun also blocks instead of being treated as covered.
 */
export function settleTurn(args = {}, options) {
  const view = readLedgerView(options)
  const locked = withLedgerLock(view.path, () => settleTurnUnlocked(args))
  return locked.locked ? { state: 'LEDGER_LOCKED' } : locked.value
}

function settleTurnUnlocked({ turnId, usage, costUSD, sessionId, startedAt, endedAt, exit }, options) {
  const view = readLedgerView(options)
  if (view.state === 'CORRUPT') return { state: 'CORRUPT', issues: view.issues }
  const ledger = view.data
  const existing = ledger.reservations.find((item) => item.turnId === turnId)
  if (!existing) return { state: 'UNKNOWN_TURN', reason: 'no_reservation' }
  if (existing.status !== 'in_flight') return { state: 'REPLAYED', data: ledger, replayed: true }

  // A partial usage report (for example totalTokens only) is not enough to price a turn. Treat it
  // as unknown instead of computing a cheap total from missing components.
  const usageValid =
    usage &&
    intAtLeast(usage.totalTokens, 0) &&
    ['inputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'outputTokens', 'reasoningOutputTokens'].every(
      (component) => intAtLeast(usage[component], 0),
    )
  // A usable settlement needs a measured cost. Absent/NaN/Infinite cost is unknown, not free: the
  // reservation stays charged at its bound and sends stop.
  const costValid = typeof costUSD === 'number' && Number.isFinite(costUSD) && costUSD >= 0
  const measurable = usageValid && costValid
  const overrun =
    measurable &&
    (usage.totalTokens > existing.upperTokens || (costUSD ?? 0) > existing.upperUSD * (1 + 1e-6))

  const reservations = ledger.reservations.map((item) =>
    item.turnId === turnId
      ? {
          ...item,
          status: measurable ? 'settled' : 'unknown',
          settledAt: new Date().toISOString(),
          ...(measurable ? { actualTokens: usage.totalTokens, actualUSD: costUSD ?? 0 } : { chargedAtBound: true }),
        }
      : item,
  )
  const chargedTokens = measurable ? usage.totalTokens : existing.upperTokens
  const chargedUSD = measurable ? (costUSD ?? 0) : existing.upperUSD
  const actual = {
    turns: ledger.actual.turns + 1,
    tokens: ledger.actual.tokens + chargedTokens,
    costUSD: (ledger.actual.costUSD ?? 0) + chargedUSD,
    unknownTurns: ledger.actual.unknownTurns + (measurable ? 0 : 1),
  }
  const status = overrun ? 'BLOCKED_BOUND_VIOLATION' : measurable ? ledger.status : 'BLOCKED_UNKNOWN_USAGE'
  const inFlight = reservations.filter((item) => item.status === 'in_flight')
  const next = sealedLedger(ledger, {
    status,
    actual,
    reservation: {
      turns: inFlight.length,
      tokens: inFlight.reduce((total, item) => total + item.upperTokens, 0),
      unknownTurns: ledger.reservation.unknownTurns + (measurable ? 0 : 1),
    },
    reservations,
    turns: [
      ...ledger.turns,
      {
        turnId,
        sessionId: sessionId ?? null,
        startedAt,
        endedAt,
        usage: measurable ? usage : null,
        unknown: !measurable,
        ...(overrun ? { boundViolation: { measuredTokens: usage.totalTokens, measuredUSD: costUSD ?? 0, boundTokens: existing.upperTokens, boundUSD: existing.upperUSD } } : {}),
        exit,
      },
    ],
    ...(overrun ? { boundViolations: [...(ledger.boundViolations ?? []), { turnId, measuredTokens: usage.totalTokens, measuredUSD: costUSD ?? 0 }] } : {}),
  })
  writeAtomic(view.path, next)
  return { state: overrun ? 'BOUND_VIOLATION' : measurable ? 'SETTLED' : 'UNKNOWN_USAGE', data: next, overrun }
}

function parseEvents(text) {
  const events = []
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      events.push(JSON.parse(trimmed))
    } catch {
      /* non-JSON diagnostic line */
    }
  }
  return events
}

function usageOf(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const info = events[index]?.info ?? events[index]
    const total = info?.total_token_usage ?? info?.totalTokenUsage
    if (total && Number.isSafeInteger(total.total_tokens)) {
      return {
        totalTokens: total.total_tokens,
        inputTokens: total.input_tokens ?? null,
        cachedInputTokens: total.cached_input_tokens ?? null,
        outputTokens: total.output_tokens ?? null,
        reasoningOutputTokens: total.reasoning_output_tokens ?? null,
      }
    }
  }
  return null
}

function sessionOf(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    const value =
      event?.session_id ?? event?.sessionId ?? event?.thread_id ?? event?.threadId ?? event?.conversation_id ?? event?.conversationId
    if (typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value)) return value
  }
  return null
}

/**
 * Sends one turn through B's own sender module. E does not spawn a command, does not know a
 * transport, and has no fallback: the admitted descriptor names a module/export owned by B, and the
 * sender must echo the reservation identity it was given. A missing/mismatched sender is refused.
 */
export async function guardedSend({ admission, reservationId, ...turn }) {
  if (!admission?.ok) return { ok: false, reason: 'admission_blocked', blockers: admission?.blockers ?? [{ code: 'adapter_missing', detail: 'no admission' }] }
  if (!substantial(reservationId)) return { ok: false, reason: 'reservation_missing' }
  const entry = admission.facts?.entry
  if (!entry?.module) return { ok: false, reason: 'b_sender_unavailable' }
  let module
  try {
    module = await import(pathToFileURL(entry.module).href)
  } catch (error) {
    return { ok: false, reason: 'b_sender_unavailable', detail: String(error?.message ?? error).slice(0, 300) }
  }
  const send = module[entry.export ?? 'send']
  if (typeof send !== 'function') return { ok: false, reason: 'b_sender_unavailable', detail: 'missing export' }
  let result
  try {
    result = await send({ protocolVersion: entry.protocolVersion, reservationId, ...turn })
  } catch (error) {
    return { ok: false, reason: 'b_sender_failed', detail: String(error?.message ?? error).slice(0, 300) }
  }
  if (!result || typeof result !== 'object') return { ok: false, reason: 'b_sender_invalid_result' }
  if (result.reservationId !== reservationId) return { ok: false, reason: 'reservation_identity_mismatch', result }
  return { ok: true, result }
}

const BILLED_COMPONENTS = ['inputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'outputTokens', 'reasoningOutputTokens']
const PRICE_FOR = {
  inputTokens: 'inputPerMillion',
  cachedInputTokens: 'cachedInputPerMillion',
  cacheWriteInputTokens: 'cacheWriteInputPerMillion',
  outputTokens: 'outputPerMillion',
  reasoningOutputTokens: 'reasoningOutputPerMillion',
}

export function costOf(usage, pricing) {
  if (!usage || !pricing) return undefined
  // Every billed component and its rate must be measured. A missing component is not free; it makes
  // the whole cost unknown so the caller keeps the reservation bound and blocks further sends.
  for (const component of BILLED_COMPONENTS) {
    if (!Number.isSafeInteger(usage[component]) || usage[component] < 0) return undefined
    const price = pricing[PRICE_FOR[component]]
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return undefined
  }
  const total = BILLED_COMPONENTS.reduce((sum, component) => sum + usage[component] * pricing[PRICE_FOR[component]], 0)
  return total / 1_000_000
}

export { digestOf as digest }
