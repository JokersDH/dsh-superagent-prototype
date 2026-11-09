import { randomBytes } from 'node:crypto'
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import type { Stats } from 'node:fs'
import { join } from 'node:path'

export function localCredentials(state: string): (name: string) => string {
  mkdirSync(state, { recursive: true, mode: 0o700 })
  const owned = (stat: Stats) =>
    (!process.getuid || stat.uid === process.getuid()) && (stat.mode & 0o077) === 0 && !stat.isSymbolicLink()
  const directory = lstatSync(state)
  if (!directory.isDirectory() || !owned(directory)) throw new Error('HTTP state requires a private owned directory')
  return (name) => {
    if (!/^[a-z]+\.key$/.test(name)) throw new Error('Unrecognized local credential name')
    const path = join(state, name)
    try {
      const fd = openSync(path, 'wx', 0o600)
      try {
        const bytes = Buffer.from(randomBytes(32).toString('hex'))
        for (let offset = 0; offset < bytes.length; ) offset += writeSync(fd, bytes, offset)
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const stat = lstatSync(path)
    if (!stat.isFile() || !owned(stat) || stat.size !== 64) throw new Error('Invalid local credential file')
    const value = readFileSync(path, 'utf8')
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid local credential encoding')
    return value
  }
}
