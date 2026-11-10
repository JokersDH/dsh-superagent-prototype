/**
 * Typed failures for local distribution and portability operations. Every code is stable because
 * the launcher CLI maps it to operator-facing diagnosis; unknown causes stay explicit instead of
 * degrading to success.
 */
export type PortabilityCode =
  | 'unsupported_platform'
  | 'invalid_root'
  | 'unsafe_root'
  | 'root_inside_install'
  | 'install_missing'
  | 'manifest_invalid'
  | 'manifest_version_unsupported'
  | 'archive_invalid'
  | 'archive_limit_exceeded'
  | 'archive_unsafe_path'
  | 'archive_duplicate_entry'
  | 'archive_checksum_mismatch'
  | 'bundle_digest_mismatch'
  | 'database_unavailable'
  | 'database_verify_failed'
  | 'config_invalid'
  | 'artifact_missing'
  | 'artifact_digest_mismatch'
  | 'writer_uncertain'
  | 'target_not_empty'
  | 'target_active'
  | 'target_invalid'
  | 'restore_failed'
  | 'rollback_failed'
  | 'io_error'

export class PortabilityError extends Error {
  readonly code: PortabilityCode
  readonly detail: Readonly<Record<string, unknown>>
  constructor(code: PortabilityCode, message: string, detail: Readonly<Record<string, unknown>> = {}) {
    super(message)
    this.name = 'PortabilityError'
    this.code = code
    this.detail = detail
  }
}

export function isPortabilityError(value: unknown): value is PortabilityError {
  return value instanceof PortabilityError
}
