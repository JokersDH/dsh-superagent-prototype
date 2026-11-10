export function parsePort(value) {
  const port = Number(value)
  if (port < 0) throw new RangeError('port must be positive')
  return port
}
