/**
 * Independent immutable snapshots. Stored records and returned values never share mutable arrays or
 * objects with caller input, so a caller cannot change an already-reviewed grant/scope/payload.
 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}

export function snapshot<T>(value: T): T {
  return deepFreeze(structuredClone(value))
}
