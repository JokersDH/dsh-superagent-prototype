/**
 * @personal-agent/portability — local distribution and migration support for one personal
 * install. It resolves private product roots, defines the complete backup bundle format, and
 * (in later stages) creates/verifies/restores bundles through the storage snapshot port. It never
 * opens a second production writer and never dispatches business during backup/restore.
 */
export { PortabilityError, isPortabilityError, type PortabilityCode } from './errors.ts'
export {
  PRODUCT_ID,
  ROOT_NAMES,
  defaultRoots,
  describeRoots,
  ensureRoots,
  makePrivateDirectory,
  platformSupport,
  resolveRoots,
  type EnsuredRoots,
  type PrivateRootName,
  type ProductRoots,
  type RootName,
  type RootOptions,
  type RootOverrides,
  type RootReport,
} from './roots.ts'
export {
  BUNDLE_FORMAT,
  BUNDLE_FORMAT_VERSION,
  BUNDLE_LIMITS,
  DATABASE_ENTRY,
  MANIFEST_ENTRY,
  assertSafeEntryPath,
  canonicalJson,
  manifestDigest,
  sha256Hex,
  validateManifest,
  type BackupManifest,
  type BundleEntry,
  type BundleEntryKind,
  type DatabaseFacts,
  type ExcludedEntry,
  type PathBinding,
  type WriterClaimFacts,
} from './manifest.ts'
export {
  createHashingSink,
  readTarGz,
  writeTarGz,
  type ArchiveEntry,
  type ArchiveLimits,
  type ArchiveSink,
  type ArchiveSource,
  type HashedEntry,
} from './archive.ts'
export { snapshotState, type SnapshotOptions, type SnapshotResult, type StagingFile } from './snapshot.ts'
export {
  EVIDENCE_FORMAT,
  EVIDENCE_FORMAT_VERSION,
  readEvidenceSummary,
  verifyEvidenceSummary,
  type EvidenceProject,
  type EvidenceSummary,
  type EvidenceWork,
} from './evidence.ts'
export {
  createBundle,
  verifyBundle,
  type BundleResult,
  type CreateBundleOptions,
  type VerifyBundleOptions,
  type VerifyBundleResult,
} from './bundle.ts'
export {
  DATABASE_FILES,
  assertStateInactive,
  inspectStateActivity,
  type StateActivity,
  type StateActivityCheck,
  type StateActivityOptions,
  type StateHolder,
  type WriterActivity,
} from './state.ts'
export {
  restoreBundle,
  readRestoreReport,
  writePrivateFile,
  type RestoreOptions,
  type RestorePathMapping,
  type RestoreReport,
  type RestoreResult,
} from './restore.ts'
