import { lstatSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expectedStartupMode } from './recovery.mjs'

/**
 * Feature detection for the blocked-capable receiver in this exact trusted installation.
 * This never invokes startup, probes an executor, reads consent, or authorizes native execution.
 * Normal personal admission remains the receiver's shared probe + original receipt + fresh guard.
 */
export async function hasInspectedNativeStartup({ installRoot, stateRoot }) {
  try {
    if (expectedStartupMode(stateRoot) !== 'normal') return false
    const root = realpathSync(installRoot)
    const path = join(root, 'apps/coordinator/product/inspected-startup.ts')
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== path) return false
    const receiver = await import(pathToFileURL(path).href)
    return receiver.INSPECTED_NATIVE_STARTUP_PROTOCOL === 'inspected-native-startup/1' &&
      typeof receiver.prepareInspectedPersonalStartup === 'function'
  } catch {
    // A legacy/broken install keeps its original fail-closed preflight; no configurable fallback.
    return false
  }
}
