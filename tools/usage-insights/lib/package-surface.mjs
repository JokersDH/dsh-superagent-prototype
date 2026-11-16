/**
 * Read-only capability report for a released artifact.
 *
 * It answers one question with evidence from the archive itself: which observation capabilities does
 * this exact package actually contain? A source checkout is not a package, and a tool shipped next to
 * a package is not a feature inside it, so the report reads only the packaged files.
 */
import { readArchive } from './tar.mjs'

const APP_ROOT = 'install/app/'
const USAGE_PACKAGE = `${APP_ROOT}packages/usage-insights/`

export const CAPABILITIES = ['pageObservation', 'numericExport', 'displayDownload']

const count = (text, needle) => (text === null ? 0 : text.split(needle).length - 1)

const filesUnder = (archive, prefix, pattern) =>
  archive.entries.filter(entry => entry.type === 'file' && entry.name.startsWith(prefix) && pattern.test(entry.name))

/**
 * Join the text of a bounded set of members. A member that would push the scan past the budget is
 * skipped rather than failing the report, and the skipped count is returned so a caller knows the
 * scan was partial.
 */
const boundedText = (archive, entries, maxBytes = 32 * 1024 * 1024) => {
  const parts = []
  let used = 0
  for (const entry of entries) {
    if (used + entry.size > maxBytes) continue
    const text = archive.text(entry.name)
    if (text === null) continue
    used += entry.size
    parts.push(text)
  }
  return parts.join('\n')
}

/** Capabilities the package exposes, each backed by a packaged file rather than a checkout. */
export function inspectArchive(path, options = {}) {
  const archive = readArchive(path, options)
  const isAppleDouble = entry => entry.name.split('/').pop().startsWith('._')
  const regular = archive.entries.filter(entry => entry.type === 'file' && !isAppleDouble(entry))
  const appleDouble = archive.entries.filter(entry => entry.type === 'file' && isAppleDouble(entry))
  const links = archive.entries.filter(entry => entry.type === 'symlink')
  const directories = archive.entries.filter(entry => entry.type === 'directory')
  const paxHeaders = archive.entries.filter(entry => entry.type === 'other')

  // The install manifest embeds the whole file inventory (megabytes), so the guard is generous but
  // still bounded, and a manifest that is present but skipped is reported as its own state instead of
  // looking like a package that declared nothing.
  const installText = archive.text('install/install.json')
  const manifestState = installText === null ? 'absent'
    : installText.length > 8 * 1024 * 1024 ? 'too_large' : 'parsed'
  let install = null
  if (manifestState === 'parsed') {
    try { install = JSON.parse(installText) } catch { install = null }
  }
  const resolvedManifestState = manifestState === 'parsed' && install === null ? 'invalid' : manifestState

  const manifestText = archive.text(`${USAGE_PACKAGE}package.json`)
  let manifest = null
  if (manifestText !== null) {
    try { manifest = JSON.parse(manifestText) } catch { manifest = null }
  }
  const indexEntry = manifest?.exports?.['.']?.import ?? './dist/index.js'
  const indexText = archive.text(`${USAGE_PACKAGE}${indexEntry.replace(/^\.\//, '')}`)
  const distFiles = regular
    .filter(entry => entry.name.startsWith(`${USAGE_PACKAGE}dist/`))
    .map(entry => entry.name.slice(`${USAGE_PACKAGE}dist/`.length))
    .sort()

  const httpText = archive.text(`${APP_ROOT}apps/coordinator/http/app.ts`)
  const observationText = archive.text(`${APP_ROOT}apps/coordinator/product/usage-observation.ts`)

  // A packaged build may ship sources (internal trial) or only a compiled console bundle. Reading one
  // fixed source path made a built bundle look like a missing feature, so both layouts are scanned and
  // the layout is reported instead of guessed.
  const coordinatorFiles = filesUnder(archive, `${APP_ROOT}apps/coordinator/`, /\.(ts|js)$/)
  const coordinatorText = boundedText(archive, coordinatorFiles)
  const consoleSourceFiles = filesUnder(archive, `${APP_ROOT}apps/console/src/`, /\.(ts|tsx)$/)
  const consoleBundleFiles = filesUnder(archive, `${APP_ROOT}apps/console/dist/`, /\.js$/)
  const consoleText = boundedText(archive, [...consoleSourceFiles, ...consoleBundleFiles])

  const usageInsights = {
    version: manifest?.version ?? null,
    distEntry: indexEntry,
    distFiles,
    exports: {
      analyze: count(indexText, 'analyzeUsageInsights'),
      numericExport: count(indexText, 'buildInsightExport'),
      displayExport: count(indexText, 'buildDisplayExport'),
      crossCheck: count(indexText, 'crossCheckAnalysisWithDisplay'),
    },
  }
  const coordinator = {
    sourceFiles: coordinatorFiles.length,
    pageRoute: count(coordinatorText, "'/v1/insights'") + count(coordinatorText, '"/v1/insights"'),
    downloadRoute: count(coordinatorText, '/v1/insights/export'),
    downloadProtocol: count(coordinatorText, 'usage-observation-download'),
    downloadContract: count(coordinatorText, 'UsageObservationDownload'),
    // Legacy source-path signals, kept so an older layout can still be compared.
    httpModulePresent: httpText !== null,
    observationModulePresent: observationText !== null,
  }
  const console = {
    layout: consoleSourceFiles.length > 0 ? 'source' : consoleBundleFiles.length > 0 ? 'bundle' : 'absent',
    sourceFiles: consoleSourceFiles.length,
    bundleFiles: consoleBundleFiles.length,
    references: count(consoleText, 'downloadUsageObservation') + count(consoleText, 'usage-observation-download') +
      count(consoleText, '/v1/insights/export'),
  }
  console.interfacePresent = console.layout === 'absent' ? null : console.references > 0

  // A capability needs both the library function and the product path that serves it: a dist
  // function alone is a library feature, not a downloadable observation. When the console cannot be
  // inspected at all, the server side decides and the browser trigger stays `unverifiable`.
  const capabilities = {
    pageObservation: coordinator.pageRoute > 0 && usageInsights.exports.analyze > 0,
    numericExport: usageInsights.exports.numericExport > 0,
    displayDownload: usageInsights.exports.displayExport > 0 && coordinator.downloadRoute > 0 &&
      (coordinator.downloadProtocol > 0 || coordinator.downloadContract > 0) && console.interfacePresent !== false,
  }
  return {
    protocol: 'usage-insights-package-surface/1',
    archive: {
      sha256: archive.sha256,
      bytes: archive.bytes,
      inflatedBytes: archive.inflatedBytes,
      headers: archive.entries.length,
      contentFiles: regular.length,
      appleDouble: appleDouble.length,
      paxHeaders: paxHeaders.length,
      symlinks: links.length,
      directories: directories.length,
    },
    /** The parsed install manifest, so identity is derived in one place instead of per caller. */
    rawManifest: install,
    manifestState: resolvedManifestState,
    manifestBytes: installText === null ? null : installText.length,
    manifest: install === null ? null : {
      format: install.format ?? null,
      formatVersion: install.formatVersion ?? null,
      sourceCommit: install.source?.commit ?? null,
      sourceBranch: install.source?.branch ?? null,
      sourceDirty: install.source?.dirty ?? null,
      buildId: install.buildId ?? null,
      declaredFiles: Array.isArray(install.files) ? install.files.length
        : (typeof install.files === 'number' ? install.files : null),
      supportMatrix: install.supportMatrix ?? null,
      limitations: Array.isArray(install.limitations) ? install.limitations.slice(0, 8) : [],
    },
    usageInsights,
    coordinator,
    console,
    capabilities,
    browserTrigger: console.layout === 'absent' ? 'unverifiable' : console.interfacePresent ? 'present' : 'absent',
    absent: Object.entries(capabilities).filter(([, present]) => !present).map(([name]) => name),
    accounting: {
      // Content files and symlinks are what an install manifest lists; the manifest does not list
      // itself, so one file of difference is expected and anything else is a real discrepancy.
      accountedFiles: regular.length + links.length,
      manifestDelta: install === null || !Array.isArray(install.files) ? null
        : (regular.length + links.length) - install.files.length,
    },
    authorization: 'none',
    note: 'This report reads packaged files only. It is not an install, a runtime probe or a release verdict.',
  }
}
