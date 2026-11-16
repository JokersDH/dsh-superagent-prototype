/**
 * Wave-35 H3 model-connection source consumer.
 *
 * Uses the actual main PrivateModelProvider configure/status path with a private file. It never calls
 * reply/network and never reads another user's home or credentials. The test records the exact
 * error/scope boundary for not-configured, invalid input, private permissions, symlink and valid save.
 */
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrivateModelProvider } from '../../../apps/coordinator/product/model-provider.ts'

const INPUT = (overrides = {}) => ({
  baseURL: 'https://model.example.invalid/v1', model: 'fixture-model', apiKey: 'test-key-0123456789', allowInsecureHttp: false, ...overrides,
})

export async function runModelConnection({ root }) {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const privateDir = join(root, 'private')
  mkdirSync(privateDir, { recursive: true, mode: 0o700 })
  const path = join(privateDir, 'model.json')
  const provider = new PrivateModelProvider(path)
  let fetches = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = (...args) => { fetches += 1; return originalFetch(...args) }
  const observations = {}
  try {
    observations.initial = provider.status()
    observations.invalidHttp = await attempt(() => provider.configure(INPUT({ baseURL: 'http://model.example.invalid/v1' })))
    observations.invalidKey = await attempt(() => provider.configure(INPUT({ apiKey: 'short' })))
    observations.valid = provider.configure(INPUT())
    observations.file = existsSync(path) ? { mode: (lstatSync(path).mode & 0o777).toString(8), uid: lstatSync(path).uid, bytes: lstatSync(path).size } : null
    observations.directory = { mode: (lstatSync(privateDir).mode & 0o777).toString(8) }
    observations.secondModel = provider.configure(INPUT({ model: 'fixture-model-2' }))
    observations.otherBase = provider.configure(INPUT({ baseURL: 'https://other.example.invalid/v1', model: 'other-model' }))
    observations.statusJson = JSON.stringify(provider.status())
    observations.fetches = fetches
    // symlink config is refused by configure and status stays not configured.
    const symlinkRoot = join(root, 'symlink')
    mkdirSync(symlinkRoot, { recursive: true, mode: 0o700 })
    const target = join(root, 'target.json'); writeFileSync(target, '{}\n', { mode: 0o600 })
    const linkPath = join(symlinkRoot, 'model.json'); symlinkSync(target, linkPath)
    observations.symlink = await attempt(() => new PrivateModelProvider(linkPath).configure(INPUT()))
    // a visible private directory is refused before any save.
    const visibleRoot = join(root, 'visible'); mkdirSync(visibleRoot, { recursive: true, mode: 0o700 }); chmodSync(visibleRoot, 0o755)
    observations.visibleDirectory = await attempt(() => new PrivateModelProvider(join(visibleRoot, 'model.json')).configure(INPUT()))
    const checks = {
      initiallyNotConfigured: observations.initial.configured === false && observations.initial.state === 'not_configured',
      invalidHttpRefused: observations.invalidHttp.ok === false,
      invalidKeyRefused: observations.invalidKey.ok === false,
      validConfigured: observations.valid.configured === true && observations.valid.model === 'fixture-model',
      privateFile0600: observations.file?.mode === '600',
      privateDir0700: observations.directory?.mode === '700',
      apiKeyNotExposed: !observations.statusJson.includes('test-key-0123456789'),
      sameBaseAccumulatesModels: observations.secondModel.models.includes('fixture-model') && observations.secondModel.models.includes('fixture-model-2'),
      differentBaseResetsModels: observations.otherBase.models.length === 1 && observations.otherBase.models[0] === 'other-model',
      symlinkRefused: observations.symlink.ok === false,
      visibleDirectoryRefused: observations.visibleDirectory.ok === false,
      noModelRequest: observations.fetches === 0,
    }
    return {
      protocol: 'model-connection-source/1',
      surface: 'main PrivateModelProvider configure/status (no reply/network)',
      modelCalls: 0, vendorTurns: 0, networkFetches: fetches,
      observations: { initial: observations.initial, valid: observations.valid, file: observations.file, directory: observations.directory, statusFields: Object.keys(observations.valid) },
      errors: { invalidHttp: observations.invalidHttp.code, invalidKey: observations.invalidKey.code, symlink: observations.symlink.code, visibleDirectory: observations.visibleDirectory.code },
      checks,
      limits: ['source-level provider only; not installed W33 package', 'no HTTP UI form, no app screenshot', 'no key from a human account', 'no execution/profile/agent grant'],
    }
  } finally {
    globalThis.fetch = originalFetch
  }
}

async function attempt(action) {
  try { return { ok: true, value: await action() } } catch (error) { return { ok: false, code: error?.code ?? error?.constructor?.name ?? 'error', message: String(error?.message ?? error) } }
}
