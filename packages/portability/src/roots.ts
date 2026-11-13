/**
 * Product roots for a local-first install. The install root holds read-only build artifacts;
 * config/data/cache/logs/workspace are private (0700, owned, not symlinked) and live outside the
 * checkout by default so a source update, a backup, or a full checkout move never carries user
 * state implicitly. `data` is exactly the coordinator `--state` directory, so this module adds no
 * second database or writer.
 */
import { chmodSync, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { arch as osArch, homedir as osHomedir, platform as osPlatform } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { PortabilityError } from './errors.ts'

export const PRODUCT_ID = 'dsh-superagent'
export const ROOT_NAMES = ['install', 'config', 'data', 'cache', 'logs', 'workspace'] as const
export type RootName = (typeof ROOT_NAMES)[number]
export type ProductRoots = Readonly<Record<RootName, string>>
export type PrivateRootName = Exclude<RootName, 'install'>

export interface RootOverrides {
  readonly install?: string
  readonly config?: string
  readonly data?: string
  readonly cache?: string
  readonly logs?: string
  readonly workspace?: string
}

export interface RootOptions {
  /** Absolute repository/build root that contains the launcher and built artifact dists. */
  readonly installRoot?: string
  readonly overrides?: RootOverrides
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly home?: string
  readonly platform?: NodeJS.Platform
}

const ENV_NAMES: Readonly<Record<RootName, string>> = {
  install: 'PA_INSTALL_ROOT',
  config: 'PA_CONFIG_ROOT',
  data: 'PA_DATA_ROOT',
  cache: 'PA_CACHE_ROOT',
  logs: 'PA_LOGS_ROOT',
  workspace: 'PA_WORKSPACE_ROOT',
}

/** Standard per-user directories; only darwin is actually tested (see the WP-12 RFC matrix). */
export function defaultRoots(input: { home: string; platform: NodeJS.Platform; installRoot: string }): ProductRoots {
  const { home, platform, installRoot } = input
  if (platform === 'darwin') {
    const support = join(home, 'Library/Application Support', PRODUCT_ID)
    return {
      install: installRoot,
      config: join(support, 'config'),
      data: join(support, 'data'),
      cache: join(home, 'Library/Caches', PRODUCT_ID),
      logs: join(home, 'Library/Logs', PRODUCT_ID),
      workspace: join(support, 'workspaces'),
    }
  }
  if (platform === 'linux') {
    const configHome = join(home, '.config')
    const dataHome = join(home, '.local/share')
    const stateHome = join(home, '.local/state')
    return {
      install: installRoot,
      config: join(configHome, PRODUCT_ID),
      data: join(dataHome, PRODUCT_ID),
      cache: join(home, '.cache', PRODUCT_ID),
      logs: join(stateHome, PRODUCT_ID, 'logs'),
      workspace: join(dataHome, PRODUCT_ID, 'workspaces'),
    }
  }
  if (platform === 'win32') {
    const appData = join(home, 'AppData/Roaming')
    const localAppData = join(home, 'AppData/Local')
    return {
      install: installRoot,
      config: join(appData, PRODUCT_ID, 'config'),
      data: join(appData, PRODUCT_ID, 'data'),
      cache: join(localAppData, PRODUCT_ID, 'cache'),
      logs: join(localAppData, PRODUCT_ID, 'logs'),
      workspace: join(localAppData, PRODUCT_ID, 'workspaces'),
    }
  }
  throw new PortabilityError('unsupported_platform', `No supported product directory convention for ${platform}`, {
    platform,
  })
}

function expandHome(value: string, home: string): string {
  if (value === '~') return home
  if (value.startsWith('~/')) return join(home, value.slice(2))
  return value
}

function assertAbsolute(name: RootName, value: string): string {
  if (value.trim() === '' || !isAbsolute(value))
    throw new PortabilityError('invalid_root', `Root ${name} must be an absolute path`, { name, value })
  if (value.includes('\0')) throw new PortabilityError('invalid_root', `Root ${name} contains NUL`, { name })
  return resolve(value)
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Resolve and validate all roots. Precedence: explicit override, then PA_*_ROOT, then the platform
 * default. Private roots may not be inside the install root (and the install may not live inside a
 * private root), and no two roots may coincide.
 */
export function resolveRoots(options: RootOptions): ProductRoots {
  const platform = options.platform ?? osPlatform()
  const home = options.home ?? osHomedir()
  const env = options.env ?? process.env
  const installRoot = options.installRoot ?? env.PA_INSTALL_ROOT ?? process.cwd()
  const base = defaultRoots({ home, platform, installRoot: assertAbsolute('install', installRoot) })
  const overrides = options.overrides ?? {}
  const roots = Object.fromEntries(
    ROOT_NAMES.map((name) => {
      const explicit = overrides[name]
      const fromEnv = env[ENV_NAMES[name]]
      const selected = explicit !== undefined ? explicit : fromEnv !== undefined ? fromEnv : base[name]
      return [name, assertAbsolute(name, expandHome(selected, home))]
    }),
  ) as ProductRoots
  const seen = new Map<string, RootName>()
  for (const name of ROOT_NAMES) {
    const value = roots[name]
    const existing = seen.get(value)
    if (existing) throw new PortabilityError('invalid_root', `Roots ${existing} and ${name} point at the same path`, { path: value })
    seen.set(value, name)
  }
  for (const name of ROOT_NAMES) {
    if (name === 'install') continue
    if (isInside(roots.install, roots[name]))
      throw new PortabilityError('root_inside_install', `Private root ${name} must not be inside the install root`, {
        name,
        install: roots.install,
        path: roots[name],
      })
    if (isInside(roots[name], roots.install))
      throw new PortabilityError('root_inside_install', `The install root must not be inside private root ${name}`, {
        name,
        install: roots.install,
        path: roots[name],
      })
  }
  return roots
}

const PRIVATE_NAMES: readonly PrivateRootName[] = ['config', 'data', 'cache', 'logs', 'workspace']

export interface EnsuredRoots {
  readonly roots: ProductRoots
  readonly created: readonly PrivateRootName[]
}

/** Create missing private roots (0700) and verify privacy; the install root must already exist. */
export function ensureRoots(roots: ProductRoots): EnsuredRoots {
  const created: PrivateRootName[] = []
  const install = statDirectory('install', roots.install, { create: false })
  const resolved: Record<RootName, string> = { ...roots, install }
  for (const name of PRIVATE_NAMES) {
    const value = roots[name]
    let exists = false
    try {
      statDirectory(name, value, { create: false })
      exists = true
    } catch (error) {
      if (!(error instanceof PortabilityError && error.code === 'install_missing')) throw error
    }
    if (!exists) {
      mkdirSync(value, { recursive: true, mode: 0o700 })
      created.push(name)
    }
    const checked = statDirectory(name, value, { create: false })
    resolved[name] = checked
  }
  return { roots: resolved, created }
}

function statDirectory(name: RootName, path: string, options: { create: boolean }): string {
  let stat
  try {
    stat = lstatSync(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new PortabilityError('install_missing', `Required root ${name} does not exist`, { name, path })
    throw new PortabilityError('io_error', `Cannot inspect root ${name}`, { name, path, cause: code })
  }
  if (stat.isSymbolicLink())
    throw new PortabilityError('unsafe_root', `Root ${name} must not be a symbolic link`, { name, path })
  if (!stat.isDirectory()) throw new PortabilityError('invalid_root', `Root ${name} is not a directory`, { name, path })
  if (process.getuid && stat.uid !== process.getuid())
    throw new PortabilityError('unsafe_root', `Root ${name} is not owned by the current user`, { name, path, uid: stat.uid })
  if (name !== 'install' && (stat.mode & 0o077) !== 0) {
    // Newly created directories use 0700; a pre-existing group/world-visible root is refused.
    throw new PortabilityError('unsafe_root', `Private root ${name} is visible to other users`, {
      name,
      path,
      mode: (stat.mode & 0o777).toString(8),
    })
  }
  return realpathSync(path)
}

/** Restrict a freshly created directory to the current user (used for staging and bundle directories). */
export function makePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  chmodSync(path, 0o700)
}

export interface RootReport {
  readonly name: RootName
  readonly path: string
  readonly exists: boolean
  readonly private: boolean
}

export function describeRoots(roots: ProductRoots): readonly RootReport[] {
  return ROOT_NAMES.map((name) => {
    let exists = false
    let isPrivate = name === 'install' ? true : false
    try {
      const stat = lstatSync(roots[name])
      exists = stat.isDirectory() && !stat.isSymbolicLink()
      if (name !== 'install') isPrivate = exists && (stat.mode & 0o077) === 0 && (!process.getuid || stat.uid === process.getuid())
    } catch {
      /* missing roots are reported, not thrown, for read-only diagnosis */
    }
    return { name, path: roots[name], exists, private: isPrivate }
  })
}

export function platformSupport(): { platform: NodeJS.Platform; arch: string; tested: boolean; note: string } {
  const platform = osPlatform()
  const arch = osArch()
  const tested = platform === 'darwin' && arch === 'arm64'
  return {
    platform,
    arch,
    tested,
    note: tested
      ? 'Tested candidate: darwin/arm64 with Node 24.21.x and the bundled SQLite ABI.'
      : 'NOT_TESTED: this platform/arch has no local distribution evidence; do not treat install as supported.',
  }
}
