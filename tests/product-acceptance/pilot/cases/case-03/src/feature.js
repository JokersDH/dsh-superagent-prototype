import { parsePort } from './index.js'

export function parsePorts(list) {
  return String(list)
    .split(',')
    .map((item) => parsePort(item.trim()))
}
