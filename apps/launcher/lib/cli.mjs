/** Small CLI primitives shared by every launcher command: argument parsing, stable exit codes, JSON output. */

export const EXIT = Object.freeze({ OK: 0, DEGRADED: 1, BLOCKED: 2, USAGE: 3 })

export class UsageError extends Error {
  constructor(message, detail = {}) {
    super(message)
    this.name = 'UsageError'
    this.exitCode = EXIT.USAGE
    this.detail = detail
  }
}

/** Parse `--name value` / `--name=value` / boolean flags without a dependency. */
export function parseArgs(argv, spec) {
  const values = {}
  const positionals = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--') {
      positionals.push(...argv.slice(index + 1))
      break
    }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=')
      const name = eq === -1 ? token.slice(2) : token.slice(2, eq)
      const inline = eq === -1 ? undefined : token.slice(eq + 1)
      const kind = spec[name]
      if (kind === undefined) throw new UsageError(`Unknown option --${name}`)
      if (kind === 'boolean') {
        if (inline !== undefined) throw new UsageError(`Option --${name} is a boolean and takes no value`)
        values[name] = true
      } else if (kind === 'list') {
        if (inline !== undefined) {
          values[name] = [...(values[name] ?? []), inline]
        } else {
          const next = argv[index + 1]
          if (next === undefined || next.startsWith('--')) throw new UsageError(`Option --${name} needs a value`)
          values[name] = [...(values[name] ?? []), next]
          index += 1
        }
      } else {
        const next = inline !== undefined ? inline : argv[index + 1]
        if (inline === undefined) {
          if (next === undefined || next.startsWith('--')) throw new UsageError(`Option --${name} needs a value`)
          index += 1
        }
        values[name] = next
      }
      continue
    }
    positionals.push(token)
  }
  return { values, positionals }
}

export function intOption(values, name, { min, max, fallback }) {
  if (values[name] === undefined) return fallback
  const value = Number(values[name])
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new UsageError(`Option --${name} must be an integer from ${min} to ${max}`)
  return value
}

/** Only stable, non-secret fields are printed. */
export function printResult({ json, human }) {
  if (json) process.stdout.write(`${JSON.stringify(json, null, 2)}\n`)
  else if (human) process.stdout.write(`${human.endsWith('\n') ? human : `${human}\n`}`)
}

export function fail({ json, code, message, detail, exitCode = EXIT.BLOCKED, hint }) {
  if (json) process.stdout.write(`${JSON.stringify({ status: 'BLOCKED', code, message, ...(detail ? { detail } : {}), ...(hint ? { hint } : {}) }, null, 2)}\n`)
  else {
    process.stderr.write(`BLOCKED ${code}: ${message}\n`)
    for (const [key, value] of Object.entries(detail ?? {})) process.stderr.write(`  ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}\n`)
    if (hint) process.stderr.write(`  hint: ${hint}\n`)
  }
  return exitCode
}
