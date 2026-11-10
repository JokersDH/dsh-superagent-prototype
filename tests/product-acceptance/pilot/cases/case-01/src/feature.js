import { sumRange } from './index.js'

export function sumRangeStep(start, end, step) {
  let total = 0
  for (let value = start; value <= end; value += step) total += sumRange(value, value + 1)
  return total
}
