export function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('bytes must be non-negative')
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let amount = value
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  return unit === 0 ? `${amount} B` : `${amount.toFixed(1)} ${units[unit]}`
}
