import { chunk } from './index.js'

export function chunkString(text, size) {
  return chunk([...String(text)], size).map((items) => items.join(''))
}
