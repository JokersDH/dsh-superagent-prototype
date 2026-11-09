import { createHash } from 'node:crypto'
import type { Json } from './types.ts'

export function canonicalJson(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
    .join(',')}}`
}
export const canonicalDigest = (value: Json): string => createHash('sha256').update(canonicalJson(value)).digest('hex')
