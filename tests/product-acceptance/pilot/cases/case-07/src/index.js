export function retryDelay(attempt) {
  if (attempt < 1) throw new RangeError('attempt must be positive')
  return 1000 * attempt
}
