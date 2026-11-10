import { slugify } from './index.js'

export function slugifyPath(path) {
  return String(path)
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => slugify(segment))
    .join('/')
}
