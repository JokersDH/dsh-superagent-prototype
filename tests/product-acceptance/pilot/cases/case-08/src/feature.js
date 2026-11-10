import { formatBytes } from './index.js'

export function formatBytesRange(from, to) {
  return `${formatBytes(from)} – ${formatBytes(to)}`
}
