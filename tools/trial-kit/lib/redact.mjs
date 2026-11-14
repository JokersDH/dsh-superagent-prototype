/**
 * Report redaction. Trial evidence must be reproducible by a colleague without exporting the
 * operator's home layout or any credential value:
 *   - the operator's home prefix becomes `~`,
 *   - known secret values (tokens, keys) become `<redacted:token>`,
 *   - secret-looking object keys are replaced wholesale.
 * Inputs the caller named explicitly keep their relative identity (`~/pa-artifacts/...`) so a
 * reproduction command still resolves.
 */
import { homedir } from 'node:os'

const SECRET_KEY = /(?:^|_)(?:token|secret|password|passwd|authorization|apikey|api_key|cookie|credential)(?:$|_)/i
const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g,
  /\b[A-Fa-f0-9]{64}\b(?=\s*(?:$|["',]))/g,
]

export function homeDir() {
  return homedir()
}

export function redactPath(value, home = homeDir()) {
  if (typeof value !== 'string') return value
  if (!home || home.length < 2) return value
  if (value === home) return '~'
  if (value.startsWith(`${home}/`)) return `~${value.slice(home.length)}`
  return value
}

export function redactText(value, { home = homeDir(), secrets = [] } = {}) {
  if (typeof value !== 'string') return value
  let text = value
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 8) text = text.split(secret).join('<redacted:token>')
  }
  text = redactPath(text, home)
  for (const pattern of SECRET_PATTERNS) {
    if (pattern === SECRET_PATTERNS[1]) continue // bare digests are evidence, only redact bearer values
    text = text.replace(pattern, '<redacted:bearer>')
  }
  return text
}

export function redactValue(value, options) {
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, options))
  if (value && typeof value === 'object') {
    const result = {}
    for (const [key, entry] of Object.entries(value)) {
      result[key] = SECRET_KEY.test(key) && typeof entry === 'string' ? '<redacted>' : redactValue(entry, options)
    }
    return result
  }
  return redactText(value, options)
}

/** True when none of the known secret values appears in the serialized report. */
export function assertNoSecrets(serialized, secrets) {
  return secrets.every((secret) => typeof secret !== 'string' || secret.length < 8 || !serialized.includes(secret))
}
