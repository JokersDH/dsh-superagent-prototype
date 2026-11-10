import { clamp } from './index.js'

export function clampPercent(value) {
  return clamp(value, 0, 100)
}
