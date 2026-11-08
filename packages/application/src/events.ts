import type { Change } from '@personal-agent/contracts'
import type { ProductStore } from '@personal-agent/storage'
import { ApplicationFault } from './errors.ts'

/** Public notifications never expose raw runtime facts, private command results or credential references. */
export function changes(
  store: Pick<ProductStore, 'uow' | 'events'>,
  after: number,
  pollMs = 100,
): AsyncIterable<Change> {
  if (!Number.isSafeInteger(after) || after < 0) throw new ApplicationFault('invalid_request', 'Invalid event cursor')
  const check = (cursor: number) => {
    if (cursor > store.events.cursor())
      throw new ApplicationFault('cursor_expired', 'Event cursor is outside the current history', 'safe')
    const next = store.events.after(cursor, 1)[0]
    if (next && next.seq !== cursor + 1)
      throw new ApplicationFault('cursor_expired', 'Event history has a gap; reload the snapshot', 'safe')
  }
  store.uow.atomic(() => check(after))
  return {
    [Symbol.asyncIterator]() {
      let cursor = after,
        closed = false,
        wake: (() => void) | undefined
      const pending: Change[] = []
      return {
        async next(): Promise<IteratorResult<Change>> {
          while (!closed) {
            const ready = pending.shift()
            if (ready) return { done: false, value: ready }
            store.uow.atomic(() => {
              check(cursor)
              for (const row of store.events.after(cursor, 200)) {
                if (row.seq !== cursor + 1)
                  throw new ApplicationFault('cursor_expired', 'Event history has a gap; reload the snapshot', 'safe')
                cursor = row.seq
                if (row.topic.startsWith('application.'))
                  pending.push({
                    seq: row.seq,
                    topic: row.topic,
                    entityRef: row.entityRef,
                    payload: row.payload as Change['payload'],
                  })
              }
            })
            if (!pending.length)
              await new Promise<void>((resolve) => {
                const timer = setTimeout(() => {
                  wake = undefined
                  resolve()
                }, pollMs)
                wake = () => {
                  clearTimeout(timer)
                  resolve()
                }
              })
          }
          return { done: true, value: undefined }
        },
        async return(): Promise<IteratorResult<Change>> {
          closed = true
          wake?.()
          return { done: true, value: undefined }
        },
      }
    },
  }
}
