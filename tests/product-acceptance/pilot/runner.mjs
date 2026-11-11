import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
// The real ledger has one fixed location. PA_PILOT_LEDGER exists only so the runner's own accounting
// can be exercised on a disposable ledger; it must never point at the committed ledger in a test.
const ledgerPath = process.env.PA_PILOT_LEDGER ? resolve(process.env.PA_PILOT_LEDGER) : join(here, 'ledger.json')
const codexExecutable = process.env.PA_PILOT_CODEX ?? 'codex'

export const GRANT = Object.freeze({
  id: 'wave05-independent-review-pilot-01',
  maxTotalTurnStarts: 24,
  maxAuthorTurnStarts: 8,
  maxReviewTurnStarts: 16,
  maxTotalBillableTokens: 200000,
  maxTotalCostUSD: 5,
})

const readJson = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

function writeAtomic(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  renameSync(temporary, path)
}

export function readLedger() {
  return readJson(ledgerPath, {
    schema: 'review-pilot-ledger/1',
    grantId: GRANT.id,
    caps: {
      maxTotalTurnStarts: GRANT.maxTotalTurnStarts,
      maxAuthorTurnStarts: GRANT.maxAuthorTurnStarts,
      maxReviewTurnStarts: GRANT.maxReviewTurnStarts,
      maxTotalBillableTokens: GRANT.maxTotalBillableTokens,
      maxTotalCostUSD: GRANT.maxTotalCostUSD,
    },
    status: 'NOT_STARTED',
    reservation: { turns: 0, tokens: 0, unknownTurns: 0 },
    actual: { turns: 0, tokens: 0, costUSD: 0, unknownTurns: 0 },
    reservations: [],
    turns: [],
  })
}

/** Never resets an existing ledger: only status/annotation fields are replaced. */
export function annotateLedger(patch) {
  const ledger = readLedger()
  writeAtomic(ledgerPath, { ...ledger, ...patch, updatedAt: new Date().toISOString() })
  return readLedger()
}

export function readPricing() {
  const path = join(here, 'pricing.json')
  if (!existsSync(path)) return undefined
  try {
    const value = readJson(path)
    if (
      typeof value.model === 'string' &&
      typeof value.inputPerMillion === 'number' &&
      typeof value.outputPerMillion === 'number' &&
      value.currency === 'USD' &&
      typeof value.source === 'string' &&
      typeof value.observedAt === 'string'
    )
      return value
  } catch {
    /* invalid price schedule is treated as absent */
  }
  return undefined
}

/** Optional B producer. When absent, the installed Codex CLI is the bounded runtime adapter. */
export function readRuntimeInterface() {
  const path = join(root, 'tools/experiments/review-pilot-01/runtime-interface.json')
  if (!existsSync(path)) return undefined
  try {
    return readJson(path)
  } catch {
    return undefined
  }
}

const estimateTokens = (text) => Math.ceil(Buffer.byteLength(text) / 4)

/**
 * Reserves a conservative upper bound before any send. Returns undefined when the remaining grant
 * cannot cover the bound or one turn is already in flight.
 */
export function reserveTurn({ caseId, arm, prompt, maxOutputTokens = 4096, pricing }) {
  const ledger = readLedger()
  if (ledger.status === 'BLOCKED_UNKNOWN_USAGE')
    return { ok: false, reason: 'unknown_usage_unresolved' }
  const inFlight = (ledger.reservations ?? []).some((item) => item.status === 'in_flight')
  if (inFlight) return { ok: false, reason: 'one_turn_in_flight' }
  const usedTurns = Number(ledger.actual?.turns ?? 0)
  if (usedTurns >= GRANT.maxTotalTurnStarts) return { ok: false, reason: 'turn_cap' }
  const authorTurns = (ledger.reservations ?? []).filter((item) => item.arm === 'author').length
  const reviewTurns = (ledger.reservations ?? []).filter((item) => item.arm !== 'author').length
  if (arm === 'author' && authorTurns >= GRANT.maxAuthorTurnStarts) return { ok: false, reason: 'author_turn_cap' }
  if (arm !== 'author' && reviewTurns >= GRANT.maxReviewTurnStarts) return { ok: false, reason: 'review_turn_cap' }

  const promptTokens = estimateTokens(prompt) + 6000
  const upperTokens = Math.min(20000, promptTokens + maxOutputTokens)
  const upperUSD = pricing
    ? (promptTokens * pricing.inputPerMillion + maxOutputTokens * pricing.outputPerMillion) / 1_000_000
    : null
  if (!pricing || upperUSD === null) return { ok: false, reason: 'pricing_unavailable' }
  const reservedTokens = (ledger.reservations ?? [])
    .filter((item) => item.status === 'in_flight')
    .reduce((total, item) => total + Number(item.upperTokens ?? 0), 0)
  const reservedUSD = (ledger.reservations ?? [])
    .filter((item) => item.status === 'in_flight')
    .reduce((total, item) => total + Number(item.upperUSD ?? 0), 0)
  if (
    Number(ledger.actual?.tokens ?? 0) + reservedTokens + upperTokens > GRANT.maxTotalBillableTokens ||
    Number(ledger.actual?.costUSD ?? 0) + reservedUSD + upperUSD > GRANT.maxTotalCostUSD
  )
    return { ok: false, reason: 'budget_ceiling' }

  const reservation = {
    turnId: `turn-${randomUUID()}`,
    caseId,
    arm,
    upperTokens,
    upperUSD,
    status: 'in_flight',
    reservedAt: new Date().toISOString(),
  }
  writeAtomic(ledgerPath, {
    ...ledger,
    status: 'IN_PROGRESS',
    reservation: {
      turns: (ledger.reservation?.turns ?? 0) + 1,
      tokens: reservedTokens + upperTokens,
      unknownTurns: ledger.reservation?.unknownTurns ?? 0,
    },
    reservations: [...(ledger.reservations ?? []), reservation],
    updatedAt: new Date().toISOString(),
  })
  return { ok: true, reservation }
}

/**
 * Settles one reservation. Missing usage keeps the reservation as unknown and marks the pilot
 * BLOCKED; it is never refunded as if the send had not happened.
 */
export function settleTurn({ turnId, usage, costUSD, sessionId, startedAt, endedAt, exit }) {
  const ledger = readLedger()
  const reservations = (ledger.reservations ?? []).map((item) =>
    item.turnId === turnId
      ? {
          ...item,
          status: usage ? 'settled' : 'unknown',
          settledAt: new Date().toISOString(),
          ...(usage ? { actualTokens: usage.totalTokens } : {}),
          ...(costUSD !== undefined ? { actualUSD: costUSD } : {}),
        }
      : item,
  )
  const settled = reservations.find((item) => item.turnId === turnId)
  const actual = { ...(ledger.actual ?? { turns: 0, tokens: 0, costUSD: 0, unknownTurns: 0 }) }
  actual.turns = Number(actual.turns ?? 0) + 1
  // An unknown send is charged at its conservative reservation bound, never refunded as if it had
  // not happened. A later reconciliation may only replace it with measured usage plus a new receipt.
  actual.tokens = Number(actual.tokens ?? 0) + (usage ? usage.totalTokens : Number(settled?.upperTokens ?? 0))
  actual.costUSD = Number(actual.costUSD ?? 0) + (costUSD ?? (usage ? 0 : Number(settled?.upperUSD ?? 0)))
  actual.unknownTurns = Number(actual.unknownTurns ?? 0) + (usage ? 0 : 1)
  writeAtomic(ledgerPath, {
    ...ledger,
    status: usage ? ledger.status : 'BLOCKED_UNKNOWN_USAGE',
    reservation: {
      turns: Math.max(0, (ledger.reservation?.turns ?? 1) - 1),
      tokens: Math.max(0, Number(ledger.reservation?.tokens ?? 0) - Number(reservations.find((i) => i.turnId === turnId)?.upperTokens ?? 0)),
      unknownTurns: Number(ledger.reservation?.unknownTurns ?? 0) + (usage ? 0 : 1),
    },
    reservations,
    actual,
    turns: [
      ...(ledger.turns ?? []),
      {
        turnId,
        sessionId: sessionId ?? null,
        startedAt,
        endedAt,
        usage: usage ?? null,
        unknown: usage === null,
        exit,
      },
    ],
    updatedAt: new Date().toISOString(),
  })
  return readLedger()
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
 * Runs one bounded turn through the installed Codex CLI (the same existing runtime B owns). The B
 * runtime-interface.json is used when published; otherwise the CLI adapter enforces cwd, sandbox,
 * timeout and usage capture itself.
 */
export function runCodexTurn({
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
    const startedAt = new Date().toISOString()
    const args = ['exec']
    if (resumeSessionId) args.push('resume', resumeSessionId)
    args.push('--json', '--skip-git-repo-check', '--color', 'never', '--sandbox', sandbox, '-C', cwd)
    if (model) args.push('-m', model)
    if (outputSchemaPath) args.push('--output-schema', outputSchemaPath)
    if (lastMessagePath) args.push('-o', lastMessagePath)
    args.push(prompt)
    const child = spawn(codexExecutable, args, {
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

export function costOf(usage, pricing) {
  if (!usage || !pricing) return undefined
  const input = Number(usage.inputTokens ?? 0) + Number(usage.cachedInputTokens ?? 0)
  const output = Number(usage.outputTokens ?? 0) + Number(usage.reasoningOutputTokens ?? 0)
  return (input * pricing.inputPerMillion + output * pricing.outputPerMillion) / 1_000_000
}

export function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
}
