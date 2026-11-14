/**
 * Bounded read/execute limits for every trial-kit operation. Every network, archive, file and
 * command path takes one of these numbers instead of an unbounded loop. Numbers are deliberately
 * generous for a real staged install (~20 MB tar / ~68 MB tree) and still finite.
 */
export const LIMITS = Object.freeze({
  maxArchiveBytes: 2 * 1024 * 1024 * 1024,
  maxEntries: 100_000,
  maxListingBytes: 32 * 1024 * 1024,
  maxManifestBytes: 8 * 1024 * 1024,
  maxPathLength: 900,
  maxPathComponent: 255,
  maxFilesVerified: 100_000,
  maxTotalVerifiedBytes: 2 * 1024 * 1024 * 1024,
  commandTimeoutMs: 300_000,
  diskHeadroomBytes: 64 * 1024 * 1024,
  minFreeBytes: 256 * 1024 * 1024,
  maxReportBytes: 8 * 1024 * 1024,
  maxResponseBytes: 256 * 1024,
  maxDiagnosticOutputBytes: 512 * 1024,
  networkTimeoutMs: 5_000,
  maxSoakDurationSeconds: 7_200,
  maxSoakRequests: 100_000,
  maxSoakEvents: 100_000,
  maxSoakSamples: 50_000,
})

export const TOOL = Object.freeze({ name: 'trial-kit', version: '0.1.0' })
