#!/usr/bin/env node
/** Build a native macOS launcher around an exact already-verified preview; no services/model calls. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
const { values } = parseArgs({ options: { preview: { type: 'string' }, output: { type: 'string' }, version: { type: 'string', default: '0.1.1' } } })
if (!values.preview || !values.output || !/^\d+\.\d+\.\d+$/.test(values.version)) throw new Error('Use --preview <verified-folder> --output <new-folder> [--version 0.1.1]')
const preview = resolve(values.preview), output = resolve(values.output), version = values.version
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Build on the measured darwin-arm64 target')
if (existsSync(output)) throw new Error('Output already exists; no overwrite')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const run = (bin, args, options = {}) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, ...options })
  if (r.status !== 0 || r.error) throw new Error(basename(bin) + ' failed: ' + (r.error?.message ?? r.stderr).slice(-1600))
  return r.stdout
}
const sourceRoot = fileURLToPath(new URL('../../', import.meta.url))
const manifest = JSON.parse(readFileSync(join(preview, 'preview-manifest.json')))
const runtimeBefore = sha(readFileSync(join(preview, 'runtime/bin/node')))
const verifier = fileURLToPath(new URL('./verify-personal-preview.mjs', import.meta.url))
const verified = JSON.parse(run(process.execPath, [verifier, '--dir', preview]))
if (verified.status !== 'VERIFIED_STATIC') throw new Error('Preview static verification did not pass')
if (!existsSync(join(preview, '产品使用手册.html'))) throw new Error('The product guide must be packaged with the preview')
mkdirSync(output, { mode: 0o700 })
const stage = join(output, 'disk-image'), app = join(stage, 'Personal Agent.app'), contents = join(app, 'Contents')
mkdirSync(join(contents, 'MacOS'), { recursive: true })
mkdirSync(join(contents, 'Resources'), { recursive: true })
const engine = join(contents, 'Resources/engine')
cpSync(preview, engine, { recursive: true, verbatimSymlinks: true })
const build = join(output, 'build'); mkdirSync(build)
const swift = fileURLToPath(new URL('./macos-app/Launcher.swift', import.meta.url))
const iconSource = fileURLToPath(new URL('./macos-app/Icon.swift', import.meta.url))
run('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-target', 'arm64-apple-macos14.0', '-framework', 'AppKit', swift, '-o', join(contents, 'MacOS/PersonalAgent')])
chmodSync(join(contents, 'MacOS/PersonalAgent'), 0o755)
run('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-framework', 'AppKit', iconSource, '-o', join(build, 'make-icon')])
run(join(build, 'make-icon'), [join(build, 'AppIcon.iconset')])
run('/usr/bin/iconutil', ['-c', 'icns', join(build, 'AppIcon.iconset'), '-o', join(contents, 'Resources/AppIcon.icns')])
const plist = { CFBundleName: 'Personal Agent', CFBundleDisplayName: '个人 Agent 助理', CFBundleIdentifier: 'com.jokersdh.personalagent',
  CFBundleVersion: version, CFBundleShortVersionString: version, CFBundleExecutable: 'PersonalAgent', CFBundlePackageType: 'APPL',
  CFBundleIconFile: 'AppIcon.icns', LSMinimumSystemVersion: '14.0', NSHighResolutionCapable: true,
  LSApplicationCategoryType: 'public.app-category.developer-tools', PAProductSource: manifest.inner.source, PAProductBuild: manifest.inner.buildId }
writeFileSync(join(contents, 'Info.plist'), JSON.stringify(plist))
run('/usr/bin/plutil', ['-convert', 'xml1', join(contents, 'Info.plist')])
run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', app])
run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', app])
if (sha(readFileSync(join(engine, 'runtime/bin/node'))) !== runtimeBefore) throw new Error('App signing must not rewrite the original Node/runtime identity')
const after = JSON.parse(run(process.execPath, [verifier, '--dir', engine]))
if (after.status !== 'VERIFIED_STATIC') throw new Error('Embedded engine no longer matches its full inventory')
symlinkSync('/Applications', join(stage, 'Applications'))
writeFileSync(join(stage, '安装说明.txt'), '将 Personal Agent.app 拖到 Applications，然后从“应用程序”打开。\n产品使用手册包含在应用窗口和菜单中。\n当前为未公证的内部试用版，M系列Mac、macOS14及以上。\nCodex开发需本机Git和自己的Codex CLI0.164.0登录；Node已随包。\n')
const dmg = join(output, 'Personal-Agent-' + version + '-arm64.dmg')
run('/usr/bin/hdiutil', ['create', '-volname', 'Personal Agent', '-srcfolder', stage, '-format', 'UDZO', dmg], { timeout: 180000 })
run('/usr/bin/hdiutil', ['verify', dmg], { timeout: 120000 })
const result = { format: 'personal-agent-macos-dmg/1', app, dmg, bytes: readFileSync(dmg).byteLength, sha256: sha(readFileSync(dmg)),
  version, source: manifest.inner.source, buildId: manifest.inner.buildId, embeddedNodeSha256: runtimeBefore,
  mainExecutableSha256: sha(readFileSync(join(contents, 'MacOS/PersonalAgent'))), launcherSourceSha256: sha(readFileSync(swift)),
  signature: 'ad-hoc; not Developer ID signed or notarized', platform: 'darwin-arm64', minimumMacOS: '14.0',
  servicesStarted: 0, modelTurns: 0, stateIncluded: false, codeRepository: sourceRoot }
writeFileSync(join(output, 'artifact.json'), JSON.stringify(result, null, 2))
writeFileSync(join(output, 'SHA256SUMS'), result.sha256 + '  ' + basename(dmg) + '\n')
console.log(JSON.stringify(result, null, 2))
