import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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
    const zero =
      raw.actual?.turns === 0 &&
      raw.actual?.tokens === 0 &&
      (raw.actual?.costUSD === 0 || raw.actual?.costUSD === null) &&
      (raw.reservations?.length ?? 0) === 0 &&
      (raw.turns?.length ?? 0) === 0
    if (!zero)
      return {
        ok: false,
        issues: [{ code: 'legacy_history_unverifiable', detail: 'A v1 ledger with usage cannot be verified; do not rebuild it as zero' }],
      }
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

  const usageValid =
    usage &&
    intAtLeast(usage.totalTokens, 0) &&
    (usage.inputTokens === null || intAtLeast(usage.inputTokens, 0)) &&
    (usage.outputTokens === null || intAtLeast(usage.outputTokens, 0))
  const costValid = costUSD === undefined || isFiniteNonNegative(costUSD)
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
 * Runs one bounded turn through the executable named by the admitted adapter. There is no PATH
 * lookup and no default: an absent or relative executable is refused before spawning.
 */
export function runCodexTurn({
  executable,
  prompt,
  cwd,
  sandbox = 'read-only',
  resumeSessionId,
  outputSchemaPath,
  lastMessagePath,
  timeoutMs = 180000,
  model,
}) {
  return new Promise((resolvePromise) => {
    if (typeof executable !== 'string' || !isAbsolute(executable) || !existsSync(executable)) {
      resolvePromise({ refused: 'executable_missing_or_relative', exit: null, usage: null, sessionId: null, events: 0 })
      return
    }
    const startedAt = new Date().toISOString()
    const args = ['exec']
    if (resumeSessionId) args.push('resume', resumeSessionId)
    args.push('--json', '--skip-git-repo-check', '--color', 'never', '--sandbox', sandbox, '-C', cwd)
    if (model) args.push('-m', model)
    if (outputSchemaPath) args.push('--output-schema', outputSchemaPath)
    if (lastMessagePath) args.push('-o', lastMessagePath)
    args.push(prompt)
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (exit) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const events = parseEvents(stdout)
      resolvePromise({
        exit,
        startedAt,
        endedAt: new Date().toISOString(),
        usage: usageOf(events),
        sessionId: sessionOf(events),
        stderrTail: stderr.slice(-2000),
        events: events.length,
      })
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 3000)
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      appendFileSync(join(here, 'reports', 'codex-turns.log'), chunk.toString())
    })
    child.once('error', (error) => finish({ error: String(error?.message ?? error) }))
    child.once('exit', (code, signal) => finish({ code, signal }))
  })
}

/**
 * The only send entry point. It refuses before spawning unless the adapter admission passed, so a
 * missing descriptor can never degrade into "just use the installed CLI".
 */
export async function guardedSend({ admission, ...turn }) {
  if (!admission?.ok) return { ok: false, reason: 'admission_blocked', blockers: admission?.blockers ?? [{ code: 'adapter_missing', detail: 'no admission' }] }
  const executable = admission.facts?.executable
  const result = await runCodexTurn({ executable, ...turn })
  if (result.refused) return { ok: false, reason: result.refused }
  return { ok: true, result }
}

export function costOf(usage, pricing) {
  if (!usage || !pricing) return undefined
  const priced =
    (usage.inputTokens ?? 0) * (pricing.inputPerMillion ?? 0) +
    (usage.cachedInputTokens ?? 0) * (pricing.cachedInputPerMillion ?? pricing.inputPerMillion ?? 0) +
    (usage.cacheWriteInputTokens ?? 0) * (pricing.cacheWriteInputPerMillion ?? pricing.inputPerMillion ?? 0) +
    (usage.outputTokens ?? 0) * (pricing.outputPerMillion ?? 0) +
    (usage.reasoningOutputTokens ?? 0) * (pricing.reasoningOutputPerMillion ?? pricing.outputPerMillion ?? 0)
  return priced / 1_000_000
}

export { digestOf as digest }
