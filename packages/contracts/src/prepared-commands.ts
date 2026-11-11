import type { CommandReceipt, TrustedActor, UserCommand } from './types.ts'

/** Process-local opaque handle. Serializing/copying it does not transfer command authority. */
export interface PreparedUserCommand {
  readonly protocol: 'prepared-user-command/1'
  readonly commandId: string
  readonly expiresAt: string
}

/** Companion to ApplicationService; the frozen Runner/data protocol is unchanged. */
export interface TransactionalApplicationCommands {
  /** Read-only asynchronous preflight, outside any UnitOfWork. Does not record a receipt. */
  prepareCommand(command: UserCommand, actor: TrustedActor): Promise<PreparedUserCommand>
  /**
   * Synchronous, same-instance handle, inside the caller's existing UnitOfWork.
   * A rejected receipt rolls back this command's effects. A composer must roll back its own
   * participant changes too when the receipt is rejected. Outer rollback includes the receipt.
   */
  commitPrepared(prepared: PreparedUserCommand): CommandReceipt
}
