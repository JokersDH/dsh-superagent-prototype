/** Standard ACP v1 only. The official SDK owns parsing, IDs and request dispatch. */
import { ndJsonStream, type AnyMessage, type Stream } from '@agentclientprotocol/sdk'

export { PROTOCOL_VERSION as ACP_PROTOCOL_VERSION, methods } from '@agentclientprotocol/sdk'
export const ACP_SDK_VERSION = '2.12.0' as const
export const ACP_SDK_ENTRYPOINT = '@agentclientprotocol/sdk' as const

export class AcpProtocolError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.code = code; this.name = 'AcpProtocolError' }
}

export type AcpByteTransport = {
  /** Original owned-process resource, absent for controlled in-memory transports. */
  resourceRef?: string
  stdout: AsyncIterable<Uint8Array>
  write(bytes: Uint8Array): Promise<void>
  /** Normal EOF, when the original owned host exposes it. Never a signal or resource release. */
  closeInput?(): Promise<void>
}

/**
 * Adapt the existing owned process host to the SDK. Message taps observe SDK-owned objects, not a
 * second JSON-RPC decoder. The before-write tap is the last fresh authorization point for answers;
 * after-write runs only when the original host has accepted all bytes.
 */
export function acpStream(transport: AcpByteTransport, taps: {
  beforeWrite?(message: AnyMessage): Promise<void>
  /** Synchronous final check immediately before calling the original owned FD writer. */
  beforeBytesWrite?(message: AnyMessage): void
  afterWrite?(message: AnyMessage): void
} = {}): Stream {
  const iterator = transport.stdout[Symbol.asyncIterator]()
  let ended = false
  const input = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const value = await iterator.next()
        if (ended) return
        if (value.done) { ended = true; controller.close() }
        else controller.enqueue(value.value)
      } catch (error) { if (!ended) { ended = true; controller.error(error) } }
    },
    cancel() { ended = true },
  })
  let writing: AnyMessage | undefined
  const output = new WritableStream<Uint8Array>({ write: bytes => {
    if (!writing) throw new AcpProtocolError('unbound_write', 'ACP byte write has no SDK message identity')
    taps.beforeBytesWrite?.(writing)
    return transport.write(bytes)
  } })
  const stream = ndJsonStream(output, input, { maxMessageBytes: 8 * 1024 * 1024 })
  const writer = stream.writable.getWriter()
  return {
    readable: stream.readable,
    writable: new WritableStream<AnyMessage>({
      async write(message) {
        await taps.beforeWrite?.(message)
        writing = message
        try { await writer.write(message) } finally { writing = undefined }
        taps.afterWrite?.(message)
      },
      async close() { await writer.close() },
      async abort(reason) { await writer.abort(reason) },
    }),
  }
}

export function deadline<T>(work: Promise<T>, ms: number, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AcpProtocolError(code, 'ACP operation deadline exceeded; outcome requires reconciliation')), ms)
    work.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}
