/**
 * Priority command pump between the Runner/Supervisor and a Driver (WP-03, RT-03 / 04 §4).
 *
 * `AttemptIO.commands` is an AsyncIterable, so a driver can keep consuming control while a business
 * `await` is pending. This queue makes the ordering explicit and bounded:
 *
 *   cancel                                         -> priority 0
 *   answer, pause_at_boundary                      -> priority 1
 *   begin, deliver                                 -> priority 2
 *
 * Same-priority commands keep FIFO order. A full queue fails a control push with a stable
 * `state_indeterminate` error instead of dropping commands silently.
 */
import type { RunnerCommand } from '../../contracts/src/types.ts'
import { DriverError } from './errors.ts'

export const COMMAND_PRIORITY: Readonly<Record<RunnerCommand['kind'], number>> = Object.freeze({
  cancel: 0,
  answer: 1,
  pause_at_boundary: 1,
  begin: 2,
  deliver: 2,
})

export function commandPriority(command: RunnerCommand): number {
  const priority = COMMAND_PRIORITY[command.kind]
  if (priority === undefined) throw new DriverError('protocol_error', 'unknown_command_kind', `Unknown command kind: ${String(command.kind)}`)
  return priority
}

type Entry = { priority: number; seq: number; command: RunnerCommand }

export type CommandQueueOptions = {
  /** Maximum queued commands before a push fails. Default 256. */
  maxPending?: number
}

export class CommandQueue implements AsyncIterable<RunnerCommand> {
  #entries: Entry[] = []
  #waiters: Array<(result: IteratorResult<RunnerCommand>) => void> = []
  #seq = 0
  #closed = false
  #closedReason: string | undefined
  readonly #maxPending: number

  constructor(options: CommandQueueOptions = {}) {
    this.#maxPending = options.maxPending ?? 256
  }

  get pending(): number {
    return this.#entries.length
  }

  get closed(): boolean {
    return this.#closed
  }

  /** Queue a command. Cancel/answer jump ahead of business commands but never reorder peers. */
  push(command: RunnerCommand): void {
    if (this.#closed) throw new DriverError('state_indeterminate', 'command_queue_closed', `Queue closed: ${this.#closedReason ?? 'no reason'}`)
    if (this.#entries.length >= this.#maxPending) {
      throw new DriverError('state_indeterminate', 'command_queue_full', `Command queue holds ${this.#entries.length} commands`)
    }
    const entry: Entry = { priority: commandPriority(command), seq: ++this.#seq, command }
    let index = this.#entries.length
    while (index > 0 && compare(this.#entries[index - 1]!, entry) > 0) index -= 1
    this.#entries.splice(index, 0, entry)
    this.#wake()
  }

  /** Stop accepting commands; pending ones are still drained before the iterator ends. */
  close(reason = 'runner_stopped'): void {
    if (this.#closed) return
    this.#closed = true
    this.#closedReason = reason
    this.#wake()
  }

  [Symbol.asyncIterator](): AsyncIterator<RunnerCommand> {
    return { next: () => this.#take() }
  }

  #take(): Promise<IteratorResult<RunnerCommand>> {
    const entry = this.#entries.shift()
    if (entry) return Promise.resolve({ value: entry.command, done: false })
    if (this.#closed) return Promise.resolve({ value: undefined, done: true })
    return new Promise(resolve => {
      this.#waiters.push(resolve)
    })
  }

  #wake(): void {
    while (this.#waiters.length > 0) {
      const entry = this.#entries.shift()
      if (!entry) {
        if (!this.#closed) return
        const waiter = this.#waiters.shift()!
        waiter({ value: undefined, done: true })
        continue
      }
      const waiter = this.#waiters.shift()!
      waiter({ value: entry.command, done: false })
    }
  }
}

function compare(left: Entry, right: Entry): number {
  if (left.priority !== right.priority) return left.priority - right.priority
  return left.seq - right.seq
}
