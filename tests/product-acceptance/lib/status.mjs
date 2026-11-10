/** Precise case status. Only PASS satisfies a requirement; every other value is a visible gap. */
export const STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  SKIPPED: 'SKIPPED',
  NOT_TESTED: 'NOT_TESTED',
  BLOCKED: 'BLOCKED',
  UNKNOWN: 'UNKNOWN',
})

export const LAYERS = Object.freeze({
  CONTROLLED: 'controlled-fixture',
  SDK_MOCK: 'sdk-mock',
  READONLY: 'readonly',
  NATIVE: 'actual-native',
  NOT_TESTED: 'not-tested',
})

const STATUS_VALUES = new Set(Object.values(STATUS))
const LAYER_VALUES = new Set(Object.values(LAYERS))

export function assertStatus(value) {
  if (!STATUS_VALUES.has(value)) throw new TypeError(`Unknown case status: ${String(value)}`)
  return value
}

export function assertLayer(value) {
  if (!LAYER_VALUES.has(value)) throw new TypeError(`Unknown evidence layer: ${String(value)}`)
  return value
}

/**
 * One case result. `assertions` must be non-empty for a PASS: a case that asserted nothing is not
 * evidence, and the release gate rejects it as vacuous.
 */
export function caseResult({
  id,
  title,
  layer,
  status,
  assertions = [],
  evidence = {},
  limitations = [],
  reason,
  startedAt,
  finishedAt,
}) {
  assertStatus(status)
  assertLayer(layer)
  if (typeof id !== 'string' || !/^[A-Z][A-Z0-9-]{2,63}$/.test(id))
    throw new TypeError(`Case id must be an upper-case token: ${String(id)}`)
  if (status === STATUS.PASS && assertions.length === 0)
    throw new TypeError(`Case ${id} cannot PASS without assertions`)
  return {
    id,
    title: title ?? id,
    layer,
    status,
    ...(reason ? { reason } : {}),
    assertions: assertions.map(({ id: assertionId, ok, detail }) => ({
      id: assertionId,
      ok: ok === true,
      ...(detail === undefined ? {} : { detail: String(detail).slice(0, 400) }),
    })),
    evidence,
    limitations,
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    ...(startedAt && finishedAt ? { durationMs: Date.parse(finishedAt) - Date.parse(startedAt) } : {}),
  }
}

/** Runs one case body, converting a thrown error into a FAIL with the message as its reason. */
export async function runCase(definition, body) {
  const startedAt = new Date().toISOString()
  const assertions = []
  const limitations = [...(definition.limitations ?? [])]
  try {
    await body({
      assert(id, ok, detail) {
        assertions.push({ id, ok, detail })
        if (!ok) throw new Error(`${id}${detail ? `: ${detail}` : ''}`)
      },
      note(text) {
        limitations.push(String(text))
      },
      evidence: definition.evidence ?? {},
    })
    return caseResult({
      ...definition,
      status: STATUS.PASS,
      assertions,
      limitations,
      startedAt,
      finishedAt: new Date().toISOString(),
    })
  } catch (error) {
    return caseResult({
      ...definition,
      status: STATUS.FAIL,
      assertions: assertions.length ? assertions : [{ id: 'THREW', ok: false, detail: error?.message }],
      limitations,
      reason: String(error?.message ?? error).slice(0, 1200),
      startedAt,
      finishedAt: new Date().toISOString(),
    })
  }
}

export function notTested(definition, reason) {
  return caseResult({ ...definition, status: STATUS.NOT_TESTED, assertions: [], reason })
}

export function blocked(definition, reason) {
  return caseResult({ ...definition, status: STATUS.BLOCKED, assertions: [], reason })
}
