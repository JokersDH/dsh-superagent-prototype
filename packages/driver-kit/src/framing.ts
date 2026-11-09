/**
 * Bounded JSON-lines framing for the local Runner <-> Driver <-> native-agent transport.
 *
 * Design points required by WP-03 / REL-07:
 * - a frame is one UTF-8 JSON object per line; a chunk may split or merge frames;
 * - a UTF-8 sequence split across chunks is never decoded piecewise: bytes are buffered until a
 *   complete line is available and only then decoded with `fatal: true`;
 * - oversized frames and oversized buffers fail with a stable DriverError instead of growing;
 * - CRLF is accepted, blank lines are ignored, a trailing partial frame at EOF is an explicit error;
 * - decoding never decides business meaning: unknown objects are returned as-is for the caller.
 *
 * This is a local transport, not a product wire schema: message *bodies* remain the frozen
 * contracts' `RunnerCommand` / fact payloads, which this module does not redefine.
 */
import { Buffer } from 'node:buffer'
import { FramingError } from './errors.ts'

export type JsonLineDecoderOptions = {
  parse?: (text: string) => unknown
  /** Maximum bytes in one line, excluding the newline. Default 1 MiB. */
  maxFrameBytes?: number
  /** Maximum bytes buffered while waiting for a newline. Default 4 MiB. */
  maxBufferedBytes?: number
}

export type DecodedFrame = {
  /** 1-based order among decoded frames in this decoder. */
  seq: number
  /** Bytes of the line, excluding the newline. */
  bytes: number
  /** Parsed JSON value; the caller is responsible for contract validation. */
  value: unknown
}

export type DecoderStats = {
  frames: number
  blankLines: number
  bytes: number
  bufferedBytes: number
}

const DEFAULTS = { maxFrameBytes: 1024 * 1024, maxBufferedBytes: 4 * 1024 * 1024 }

export class JsonLineDecoder {
  #buffer: Buffer = Buffer.alloc(0)
  #seq = 0
  #stats: DecoderStats = { frames: 0, blankLines: 0, bytes: 0, bufferedBytes: 0 }
  readonly #maxFrameBytes: number
  readonly #maxBufferedBytes: number
  readonly #parse: (text: string) => unknown

  constructor(options: JsonLineDecoderOptions = {}) {
    this.#parse = options.parse ?? JSON.parse
    this.#maxFrameBytes = positiveInteger(options.maxFrameBytes, DEFAULTS.maxFrameBytes, 'maxFrameBytes')
    this.#maxBufferedBytes = positiveInteger(options.maxBufferedBytes, DEFAULTS.maxBufferedBytes, 'maxBufferedBytes')
  }

  /** Feed one chunk and return every frame completed by it, in order. */
  push(chunk: Uint8Array): DecodedFrame[] {
    if (!(chunk instanceof Uint8Array)) throw new FramingError('invalid_json', 'Chunk must be a Uint8Array')
    this.#buffer = this.#buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.#buffer, Buffer.from(chunk)])
    this.#stats.bytes += chunk.byteLength

    const frames: DecodedFrame[] = []
    let newline = this.#buffer.indexOf(0x0a)
    while (newline !== -1) {
      const raw = this.#buffer.subarray(0, newline)
      this.#buffer = this.#buffer.subarray(newline + 1)
      const line = raw.length > 0 && raw[raw.length - 1] === 0x0d ? raw.subarray(0, raw.length - 1) : raw
      if (line.length > this.#maxFrameBytes) {
        throw new FramingError('frame_too_large', `Frame of ${line.length} bytes exceeds ${this.#maxFrameBytes}`, {
          limit: this.#maxFrameBytes,
          observed: line.length,
        })
      }
      if (isBlank(line)) {
        this.#stats.blankLines += 1
      } else {
        frames.push({ seq: ++this.#seq, bytes: line.length, value: decodeJson(line, this.#parse) })
        this.#stats.frames += 1
      }
      newline = this.#buffer.indexOf(0x0a)
    }

    if (this.#buffer.length > this.#maxBufferedBytes) {
      throw new FramingError('buffer_limit', `Buffered ${this.#buffer.length} bytes exceeds ${this.#maxBufferedBytes}`, {
        limit: this.#maxBufferedBytes,
        observed: this.#buffer.length,
      })
    }
    this.#stats.bufferedBytes = this.#buffer.length
    return frames
  }

  /** Assert the stream ended on a frame boundary. */
  end(): DecoderStats {
    const leftover = this.#buffer.toString('utf8').trim()
    if (leftover.length > 0) {
      throw new FramingError('trailing_partial_frame', 'Stream ended with a partial frame', {
        bufferedBytes: this.#buffer.length,
      })
    }
    this.#buffer = Buffer.alloc(0)
    this.#stats.bufferedBytes = 0
    return this.stats()
  }

  stats(): DecoderStats {
    return { ...this.#stats }
  }
}

/** Encode one JSON value as a single newline-terminated frame with the same size bound. */
export function encodeFrame(value: unknown, options: { maxFrameBytes?: number } = {}): Uint8Array {
  const maxFrameBytes = positiveInteger(options.maxFrameBytes, DEFAULTS.maxFrameBytes, 'maxFrameBytes')
  let text: string
  try {
    const json = JSON.stringify(value)
    if (json === undefined) throw new Error('value is not JSON serializable')
    text = json
  } catch (error) {
    throw new FramingError('invalid_json', `Value cannot be serialized: ${(error as Error).message}`)
  }
  const line = Buffer.from(`${text}\n`, 'utf8')
  if (line.length - 1 > maxFrameBytes) {
    throw new FramingError('frame_too_large', `Encoded frame of ${line.length - 1} bytes exceeds ${maxFrameBytes}`, {
      limit: maxFrameBytes,
      observed: line.length - 1,
    })
  }
  return line
}

/** Iterate frames from a byte stream; framing errors are stable DriverErrors. */
export async function* decodeJsonLines(
  stream: AsyncIterable<Uint8Array>,
  options: JsonLineDecoderOptions = {},
): AsyncGenerator<DecodedFrame, void, void> {
  const decoder = new JsonLineDecoder(options)
  for await (const chunk of stream) {
    for (const frame of decoder.push(chunk)) yield frame
  }
  decoder.end()
}

function decodeJson(line: Buffer, parse: (text: string) => unknown): unknown {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(line)
  } catch {
    throw new FramingError('invalid_utf8', 'Frame is not valid UTF-8', { bytes: line.length })
  }
  try {
    return parse(text)
  } catch (error) {
    throw new FramingError('invalid_json', `Frame is not valid JSON: ${(error as Error).message}`, {
      bytes: line.length,
      preview: text.slice(0, 80),
    })
  }
}

function isBlank(line: Buffer): boolean {
  for (const byte of line) {
    if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0d) return false
  }
  return true
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`)
  return value
}
