/** Minimal deterministic argument parsing with explicit unknown-flag refusal. */
export class UsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UsageError'
    this.code = 'invalid_argument'
  }
}

export function parseArguments(argv, spec) {
  const values = {}
  const errors = []
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (!token.startsWith('--')) { errors.push(`Unexpected argument: ${token}`); continue }
    const equals = token.indexOf('=')
    const name = equals === -1 ? token.slice(2) : token.slice(2, equals)
    const declared = spec[name]
    if (!declared) { errors.push(`Unknown option: --${name}`); continue }
    if (declared.type === 'boolean') {
      const inline = equals === -1 ? undefined : token.slice(equals + 1)
      if (inline !== undefined && !['true', 'false'].includes(inline)) { errors.push(`--${name} expects true or false`); continue }
      values[name] = inline === undefined ? true : inline === 'true'
      continue
    }
    const value = equals === -1 ? argv[++index] : token.slice(equals + 1)
    if (value === undefined || value.startsWith('--')) { errors.push(`--${name} expects a value`); continue }
    if (declared.type === 'list') {
      const list = values[name] ?? []
      list.push(value)
      values[name] = list
    } else values[name] = value
  }
  if (errors.length) throw new UsageError(errors.join('; '))
  return values
}

export function positiveInteger(raw, name, fallback) {
  if (raw === undefined) return fallback
  if (!/^[1-9][0-9]*$/.test(raw)) throw new UsageError(`--${name} must be a positive integer`)
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) throw new UsageError(`--${name} must be a safe integer`)
  return value
}

export function requiredString(raw, name) {
  if (typeof raw !== 'string' || raw.length === 0) throw new UsageError(`--${name} is required`)
  return raw
}

export function timestamp(raw, name) {
  if (typeof raw !== 'string') throw new UsageError(`--${name} must be an ISO timestamp`)
  const parsed = Date.parse(raw)
  if (!Number.isFinite(parsed)) throw new UsageError(`--${name} must be an ISO timestamp`)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw)) throw new UsageError(`--${name} must be an RFC 3339 UTC timestamp`)
  return raw
}
