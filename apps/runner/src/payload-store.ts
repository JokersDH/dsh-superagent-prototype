import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { JsonSchema, IdSchema } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import type { Json } from '@personal-agent/contracts'

export class LocalPayloadMissing extends Error {}

/** Durable content-addressed payloads, with the same identity as the coordinator store. No SQLite writer. */
export class RunnerPayloadStore {
  private readonly root: string
  constructor(root: string) {
    this.root = root
    mkdirSync(root, { recursive: true, mode: 0o700 })
  }
  read(reference: string): Json {
    const path = join(this.root, `${IdSchema.parse(reference)}.json`)
    let stat
    try {
      stat = lstatSync(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new LocalPayloadMissing('Payload is not local')
      throw error
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
      throw new Error('Unsafe Runner payload file')
    const record = JSON.parse(readFileSync(path, 'utf8'))
    const payload = JsonSchema.parse(record.payload)
    if (reference !== `payload:${canonicalDigest(payload)}`) throw new Error('Runner payload integrity mismatch')
    return payload
  }
  write(payload: Json, classification: 'critical' | 'diagnostic'): string {
    const reference = `payload:${canonicalDigest(payload)}`
    const path = join(this.root, `${reference}.json`)
    if (existsSync(path)) {
      this.read(reference)
      return reference
    }
    const bytes = Buffer.from(JSON.stringify({ classification, payload }))
    if (bytes.length > 1024 * 1024) throw new Error('Runner payload exceeds its bound')
    const fd = openSync(path, 'wx', 0o600)
    try {
      for (let offset = 0; offset < bytes.length; ) offset += writeSync(fd, bytes, offset)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    const directory = openSync(this.root, 'r')
    try {
      fsyncSync(directory)
    } finally {
      closeSync(directory)
    }
    return reference
  }
}
