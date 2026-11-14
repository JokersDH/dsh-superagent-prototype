/**
 * Strict option parsing. Unknown or repeated options are refused: a typo must never silently change
 * which package, root or credential a trial command reads.
 */
import { TrialKitError } from './output.mjs'

export function parseOptions(argv, spec) {
  const values = {}
  const seen = new Set()
  const unknown = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      unknown.push(token)
      continue
    }
    const body = token.slice(2)
    const equals = body.indexOf('=')
    const name = equals === -1 ? body : body.slice(0, equals)
    const kind = spec[name]
    if (kind === undefined) {
      unknown.push(token)
      continue
    }
    if (seen.has(name)) throw new TrialKitError('usage', `Option --${name} was given more than once`)
    seen.add(name)
    if (kind === 'boolean') {
      if (equals !== -1) throw new TrialKitError('usage', `Option --${name} takes no value`)
      values[name] = true
      continue
    }
    let value
    if (equals !== -1) value = body.slice(equals + 1)
    else {
      index += 1
      value = argv[index]
    }
    if (value === undefined || value.length === 0) throw new TrialKitError('usage', `Option --${name} needs a value`)
    if (kind === 'number') {
      if (!/^\d+$/.test(value)) throw new TrialKitError('usage', `Option --${name} needs a non-negative integer`)
      values[name] = Number(value)
      continue
    }
    if (kind === 'enum') throw new TrialKitError('internal', `Option --${name} needs an enum list`)
    values[name] = value
  }
  if (unknown.length > 0) throw new TrialKitError('usage', 'Unknown arguments were refused', { arguments: unknown.slice(0, 8) })
  return values
}

export function requireOneOf(values, names, message) {
  const present = names.filter((name) => values[name] !== undefined)
  if (present.length !== 1) throw new TrialKitError('usage', message, { present })
  return present[0]
}

export function requireEnum(values, name, allowed, fallback) {
  const value = values[name] ?? fallback
  if (!allowed.includes(value)) throw new TrialKitError('usage', `--${name} must be one of ${allowed.join(', ')}`)
  return value
}

export function requireString(values, name, message) {
  const value = values[name]
  if (typeof value !== 'string' || value.length === 0) throw new TrialKitError('usage', message)
  return value
}
