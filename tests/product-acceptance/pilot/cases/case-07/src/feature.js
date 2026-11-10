import { retryDelay } from './index.js'

export function retryPlan(attempts) {
  return Array.from({ length: attempts }, (_, index) => retryDelay(index + 1))
}
