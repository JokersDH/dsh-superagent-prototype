import type { Decision, Repositories, Thread, Ticket, Trigger, TriggerDisposition } from '../../packages/orchestrator-core/src/index.ts'

type Document<T> = T & Record<string, unknown>
interface JsonRows {
  get<T>(id: string): T | undefined
  list<T>(): T[]
}
/** Structural storage adapter: domain shapes remain owned by core; no SQL or second lifecycle here. */
export interface CoreStorePort {
  uow: { atomic<T>(operation: () => T): T }
  domain: {
    triggers: {
      get<T>(id: string): T | undefined
      save(value: Document<Trigger>): void
      disposition<T>(id: string): T | undefined
      saveDisposition(id: string, value: Document<TriggerDisposition>): void
    }
    threads: JsonRows & { save(value: Document<Thread>): void; active<T>(): T[] }
    tickets: JsonRows & { save(value: Document<Ticket>): void; open<T>(): T[]; active<T>(): T[] }
    decisions: { get<T>(id: string): T | undefined; save(value: Document<Decision>): void; byThread<T>(thread: string): T[] }
  }
}

export function bindCoreRepositories(store: CoreStorePort): Repositories {
  const domain = store.domain
  return {
    atomic: operation => {
      if (Object.prototype.toString.call(operation) === '[object AsyncFunction]') throw new TypeError('Core transactions must be synchronous')
      return store.uow.atomic(() => {
        const value = operation()
        if (value && (typeof value === 'object' || typeof value === 'function') && 'then' in value && typeof value.then === 'function') {
          void Promise.resolve(value).catch(() => undefined)
          throw new TypeError('Core transactions must be synchronous')
        }
        return value
      })
    },
    triggers: {
      get: id => domain.triggers.get<Trigger>(id), save: value => domain.triggers.save({ ...value }),
      disposition: id => domain.triggers.disposition<TriggerDisposition>(id), saveDisposition: (id, value) => domain.triggers.saveDisposition(id, { ...value }),
    },
    threads: { get: id => domain.threads.get<Thread>(id), save: value => domain.threads.save({ ...value }), list: () => domain.threads.list<Thread>(), active: () => domain.threads.active<Thread>() },
    tickets: { get: id => domain.tickets.get<Ticket>(id), save: value => domain.tickets.save({ ...value }), list: () => domain.tickets.list<Ticket>(), open: () => domain.tickets.open<Ticket>(), active: () => domain.tickets.active<Ticket>() },
    decisions: { get: id => domain.decisions.get<Decision>(id), save: value => domain.decisions.save({ ...value }), byThread: id => domain.decisions.byThread<Decision>(id) },
  }
}
