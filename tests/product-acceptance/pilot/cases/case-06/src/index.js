export function chunk(values, size) {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('size must be a positive integer')
  const result = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}
