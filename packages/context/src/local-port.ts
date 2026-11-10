import { createHash } from 'node:crypto'
import { lstat, open, readFile, readdir, realpath } from 'node:fs/promises'
import { basename, join, sep } from 'node:path'
import { ContextSourceAccessError } from './errors.ts'
import { sha256Bytes } from './digest.ts'
import { isDeniedPath, pathWithin } from './paths.ts'
import type { ContextMediaType, ContextReadPort, ContextSourceDescriptor, ContextSourceKind } from './types.ts'

const HASH_LIMIT = 1024 * 1024
const SNIFF_LIMIT = 8192
const BINARY_EXTENSION = /\.(?:png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tgz|bz2|xz|7z|tar|woff2?|ttf|otf|eot|mp3|mp4|mov|avi|wasm|node|so|dylib|dll|exe|bin|class|jar|lockb)$/i
const DOCUMENT_EXTENSION = /\.(?:md|markdown|txt|rst|adoc|json|ya?ml|toml|ini|csv)$/i

export interface LocalProjectSourcePortOptions {
  /** Absolute project root. It never appears in descriptors or errors. */
  readonly rootDir: string
  readonly projectId: string
  readonly baseline: { readonly commit?: string; readonly capturedAt?: string }
  readonly now?: () => Date
  readonly maxScanFiles?: number
  readonly maxDepth?: number
}

function kindOf(path: string): Extract<ContextSourceKind, 'document' | 'source_file'> {
  return DOCUMENT_EXTENSION.test(path) ? 'document' : 'source_file'
}

function mediaTypeOf(path: string): ContextMediaType {
  if (/\.(?:md|markdown)$/i.test(path)) return 'markdown'
  if (/\.json$/i.test(path)) return 'json'
  if (DOCUMENT_EXTENSION.test(path)) return 'text'
  return 'source'
}

/**
 * Read-only local project reader for a temporary Git/file fixture and for a registered project root.
 *
 * It walks only allowed project-relative roots, refuses symlinks and denied account/credential/binary
 * paths, hashes files for provenance and never writes, fetches or executes project code.
 */
export class LocalProjectSourcePort implements ContextReadPort {
  private readonly options: LocalProjectSourcePortOptions
  private rootReal: string | undefined
  constructor(options: LocalProjectSourcePortOptions) {
    this.options = options
  }

  async projectBaseline(projectId: string): Promise<{ commit?: string; capturedAt: string } | undefined> {
    if (projectId !== this.options.projectId) return undefined
    const capturedAt = this.options.baseline.capturedAt ?? (this.options.now?.() ?? new Date()).toISOString()
    return this.options.baseline.commit === undefined
      ? { capturedAt }
      : { commit: this.options.baseline.commit, capturedAt }
  }

  async listSources(input: {
    readonly projectId: string
    readonly kinds: readonly ContextSourceKind[]
    readonly allowedPaths: readonly string[]
    readonly excludedPaths: readonly string[]
    readonly limit: number
  }): Promise<readonly ContextSourceDescriptor[]> {
    if (input.projectId !== this.options.projectId) return []
    const wanted = new Set(input.kinds)
    if (!wanted.has('document') && !wanted.has('source_file')) return []
    const maxScanFiles = this.options.maxScanFiles ?? 2000
    const maxDepth = this.options.maxDepth ?? 16
    const descriptors: ContextSourceDescriptor[] = []
    const seen = new Set<string>()

    const add = async (relativePath: string, absolutePath: string): Promise<void> => {
      if (descriptors.length >= Math.min(input.limit, maxScanFiles)) return
      if (seen.has(relativePath)) return
      if (isDeniedPath(relativePath)) return
      if (input.excludedPaths.some((root) => pathWithin(relativePath, root))) return
      const kind = kindOf(relativePath)
      if (!wanted.has(kind)) return
      const info = await lstat(absolutePath)
      if (!info.isFile()) return
      const binary = BINARY_EXTENSION.test(relativePath) || (await this.hasNulByte(absolutePath))
      const digest = await this.digestFile(absolutePath, info.size)
      seen.add(relativePath)
      descriptors.push({
        sourceId: `file-${sha256Bytes(Buffer.from(`${this.options.projectId}\0${relativePath}`)).slice(0, 32)}`,
        projectId: this.options.projectId,
        kind,
        path: relativePath,
        title: basename(relativePath),
        bytes: info.size,
        mediaType: binary ? 'binary' : mediaTypeOf(relativePath),
        baseline: {
          ...(this.options.baseline.commit === undefined ? {} : { commit: this.options.baseline.commit }),
          contentDigest: digest.digest,
          digestScope: digest.scope,
          capturedAt: this.options.baseline.capturedAt ?? (this.options.now?.() ?? new Date()).toISOString(),
        },
        validity: 'current',
      })
    }

    const walk = async (relativePath: string, absolutePath: string, depth: number): Promise<void> => {
      if (depth > maxDepth || descriptors.length >= Math.min(input.limit, maxScanFiles)) return
      const info = await lstat(absolutePath)
      if (info.isSymbolicLink()) return
      if (info.isFile()) {
        await add(relativePath, absolutePath)
        return
      }
      if (!info.isDirectory()) return
      const entries = await readdir(absolutePath, { withFileTypes: true })
      entries.sort((left, right) => left.name.localeCompare(right.name))
      for (const entry of entries) {
        const childRelative = relativePath.length === 0 ? entry.name : `${relativePath}/${entry.name}`
        if (isDeniedPath(childRelative)) continue
        await walk(childRelative, join(absolutePath, entry.name), depth + 1)
        if (descriptors.length >= Math.min(input.limit, maxScanFiles)) return
      }
    }

    for (const root of input.allowedPaths) {
      if (isDeniedPath(root)) continue
      const absolute = await this.resolveInside(root)
      if (!absolute) continue
      await walk(root, absolute, 0)
      if (descriptors.length >= Math.min(input.limit, maxScanFiles)) break
    }
    descriptors.sort((left, right) => left.path.localeCompare(right.path))
    return descriptors
  }

  async readSource(input: {
    readonly source: ContextSourceDescriptor
    readonly maxBytes: number
  }): Promise<{ content: string; bytes: number; digest: string }> {
    const { source } = input
    if (source.projectId !== this.options.projectId) {
      throw new ContextSourceAccessError('cross_project', 'Source belongs to another project')
    }
    if (isDeniedPath(source.path)) throw new ContextSourceAccessError('denied_path', 'Source path is denied')
    if (source.mediaType === 'binary') throw new ContextSourceAccessError('binary', 'Binary sources are not readable')
    if (source.bytes > input.maxBytes) throw new ContextSourceAccessError('oversized', 'Source exceeds the read budget')
    const absolute = await this.resolveInside(source.path)
    if (!absolute) throw new ContextSourceAccessError('missing', 'Source is unavailable or outside the root')
    let bytes: Buffer
    try {
      bytes = await readFile(absolute)
    } catch {
      throw new ContextSourceAccessError('missing', 'Source disappeared')
    }
    if (bytes.includes(0)) throw new ContextSourceAccessError('binary', 'Binary sources are not readable')
    let content: string
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new ContextSourceAccessError('binary', 'Source is not valid UTF-8 text')
    }
    if (bytes.byteLength > input.maxBytes) {
      throw new ContextSourceAccessError('oversized', 'Source exceeds the read budget')
    }
    return { content, bytes: bytes.byteLength, digest: sha256Bytes(bytes) }
  }

  private async ensureRoot(): Promise<string> {
    this.rootReal ??= await realpath(this.options.rootDir)
    return this.rootReal
  }

  private async resolveInside(relativePath: string): Promise<string | undefined> {
    if (isDeniedPath(relativePath)) return undefined
    const rootReal = await this.ensureRoot()
    const absolute = join(this.options.rootDir, ...relativePath.split('/'))
    try {
      const real = await realpath(absolute)
      if (real !== rootReal && !real.startsWith(`${rootReal}${sep}`)) return undefined
      return real
    } catch {
      return undefined
    }
  }

  private async hasNulByte(absolutePath: string): Promise<boolean> {
    const handle = await open(absolutePath, 'r')
    try {
      const buffer = Buffer.alloc(SNIFF_LIMIT)
      const { bytesRead } = await handle.read(buffer, 0, SNIFF_LIMIT, 0)
      return buffer.subarray(0, bytesRead).includes(0)
    } finally {
      await handle.close()
    }
  }

  private async digestFile(
    absolutePath: string,
    size: number,
  ): Promise<{ digest: string; scope: 'content' | 'prefix' }> {
    const hash = createHash('sha256')
    const handle = await open(absolutePath, 'r')
    try {
      const chunk = Buffer.alloc(64 * 1024)
      let offset = 0
      const limit = Math.min(size, HASH_LIMIT)
      while (offset < limit) {
        const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, limit - offset), offset)
        if (bytesRead === 0) break
        hash.update(chunk.subarray(0, bytesRead))
        offset += bytesRead
      }
    } finally {
      await handle.close()
    }
    if (size > HASH_LIMIT) {
      hash.update(`\0size:${size}`)
      return { digest: hash.digest('hex'), scope: 'prefix' }
    }
    return { digest: hash.digest('hex'), scope: 'content' }
  }
}
