#!/usr/bin/env node
/**
 * `project-recipes` read-only CLI.
 *
 * It turns either explicit facts (`--facts`) or an explicitly authorized project root (`--root`)
 * plus a public `ApplicationConfiguration` snapshot into a `project-recipe-draft/1` result:
 * `draft` (exit 0), `needs_input` (exit 3) or `unsupported` (exit 4). A refused input (unreadable
 * or oversized file, symlink, bad JSON, existing output) exits 5; a usage error exits 2.
 *
 * The CLI never installs, runs or registers anything, never starts a model/agent, never writes to a
 * project, and never prints script bodies or environment material. `--help` touches no file.
 */
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { MetadataRefused, observeProjectMetadata, readJsonFile } from './metadata.ts'
import type { RecipeSelection } from '../../packages/project-recipes/src/index.ts'

export const EXIT = Object.freeze({ draft: 0, usage: 2, needsInput: 3, unsupported: 4, refused: 5 })

/** Mirrors the catalog for `--help`; a test asserts it matches the package's exported kinds. */
export const HELP_KINDS = ['regression_fix', 'scoped_change', 'verification_followup'] as const

type Library = typeof import('../../packages/project-recipes/src/index.ts')

/**
 * The library is loaded lazily so a missing workspace build produces one actionable refusal instead
 * of a raw module-resolution stack before the CLI can explain itself.
 */
const loadLibrary = async (): Promise<Library> => {
  try {
    return await import('../../packages/project-recipes/src/index.ts')
  } catch {
    throw new MetadataRefused('unreadable', 'packages/contracts/dist', '缺少已构建的 workspace 依赖：请先运行 pnpm --dir packages/contracts build 后重试')
  }
}

const HELP = `project-recipes — 只读的项目任务/检查声明建议（不含执行）

用法：
  node tools/project-recipes/cli.ts --config <config.json> (--facts <facts.json> | --root <项目根>)
      [--project <id>] [--kind <${HELP_KINDS.join('|')}>] [--paths <a,b>] [--exclude <a,b>]
      [--criteria <x,y>] [--profile <id>] [--now <ISO>] [--max-facts-age-ms <n>] [--output <新文件>]

输入：
  --config   当前公开 ApplicationConfiguration JSON 快照（必需）。只做 schema 校验，不派生权限。
  --facts    已观察好的 project-facts/1 JSON；优先复用现有 inspection，不再扫描环境。
  --root     明确授权的项目根目录；只读取根下白名单元数据（package.json、锁文件名、tsconfig 存在性）。
  --project  项目 ID；省略时默认取 --config 中唯一的项目。
  --paths    本次工作的项目相对路径，逗号分隔。有限范围配方必须显式给出。
  --kind     配方类型，默认 regression_fix。

结果（stdout 一个 JSON）：
  status=draft        完整建议：goal/scope/criteria/profileId，authorization="none"，含 provenance 与 revision
  status=needs_input  缺可纠正输入（列出 code/field/message），exit ${EXIT.needsInput}
  status=unsupported  该输入类别不支持，exit ${EXIT.unsupported}

退出码：${EXIT.draft} draft · ${EXIT.usage} 用法错误 · ${EXIT.needsInput} needs_input · ${EXIT.unsupported} unsupported · ${EXIT.refused} 输入被拒绝

边界：
  - 不安装、不运行、不注册任何脚本或检查；不调用模型/agent；不写项目。
  - --root 只读根下白名单名字：NOFOLLOW、必须是普通文件、有字节/文件数上限；不做递归扫描。
  - 不读取 home/环境变量/.npmrc/凭据；脚本正文与锁文件内容从不解析。
  - 输出里的路径只有项目相对路径；绝对路径只出现在 --root/--config 参数本身。
`

type Parsed = {
  help: boolean
  config?: string
  facts?: string
  root?: string
  project?: string
  kind?: string
  paths?: string[]
  exclude?: string[]
  criteria?: string[]
  profile?: string
  now?: string
  maxFactsAgeMs?: number
  output?: string
}

class UsageError extends Error {}

const list = (value: string): string[] => value.split(',').map((item) => item.trim()).filter((item) => item.length > 0)

export function parseArgs(argv: readonly string[]): Parsed {
  const parsed: Parsed = { help: false }
  const seen = new Set<string>()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    if (arg === '--help' || arg === '-h') {
      parsed.help = true
      continue
    }
    if (!arg.startsWith('--')) throw new UsageError(`unexpected argument: ${arg}`)
    const [flag, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined]
    if (seen.has(flag)) throw new UsageError(`duplicate flag: ${flag}`)
    seen.add(flag)
    const value = inline ?? argv[++index]
    if (value === undefined || value.startsWith('--')) throw new UsageError(`flag ${flag} needs a value`)
    switch (flag) {
      case '--config': parsed.config = value; break
      case '--facts': parsed.facts = value; break
      case '--root': parsed.root = value; break
      case '--project': parsed.project = value; break
      case '--kind': parsed.kind = value; break
      case '--paths': parsed.paths = list(value); break
      case '--exclude': parsed.exclude = list(value); break
      case '--criteria': parsed.criteria = list(value); break
      case '--profile': parsed.profile = value; break
      case '--now': parsed.now = value; break
      case '--max-facts-age-ms': {
        const number = Number(value)
        if (!Number.isSafeInteger(number) || number < 0) throw new UsageError('--max-facts-age-ms must be a non-negative integer')
        parsed.maxFactsAgeMs = number
        break
      }
      case '--output': parsed.output = value; break
      default: throw new UsageError(`unknown flag: ${flag}`)
    }
  }
  return parsed
}

const projectIdFrom = (config: unknown, explicit: string | undefined): string => {
  if (explicit !== undefined) return explicit
  const projects = (config as { projects?: unknown })?.projects
  if (Array.isArray(projects) && projects.length === 1) {
    const only = projects[0] as { id?: unknown }
    if (typeof only?.id === 'string') return only.id
  }
  throw new UsageError('--project is required when the configuration does not contain exactly one project')
}

const selectionFrom = (parsed: Parsed): RecipeSelection => ({
  ...(parsed.profile === undefined ? {} : { profileId: parsed.profile }),
  ...(parsed.paths === undefined ? {} : { paths: parsed.paths }),
  ...(parsed.exclude === undefined ? {} : { excludedPaths: parsed.exclude }),
  ...(parsed.criteria === undefined ? {} : { criteriaIds: parsed.criteria }),
})

/** Runs one invocation; returns the process exit code. Exported for tests. */
export async function main(argv: readonly string[], io: { stdout: (text: string) => void; stderr: (text: string) => void } = { stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) }): Promise<number> {
  let parsed: Parsed
  try {
    parsed = parseArgs(argv)
  } catch (error) {
    io.stderr(`usage: ${(error as Error).message}\n${HELP}`)
    return EXIT.usage
  }
  if (parsed.help) {
    io.stdout(HELP)
    return EXIT.draft
  }
  let library: Library | undefined
  try {
    if (parsed.config === undefined) throw new UsageError('--config is required')
    if ((parsed.facts === undefined) === (parsed.root === undefined)) throw new UsageError('provide exactly one of --facts or --root')
    for (const [flag, value] of [['--paths', parsed.paths], ['--exclude', parsed.exclude], ['--criteria', parsed.criteria]] as const)
      if (value !== undefined && value.length === 0) throw new UsageError(`${flag} needs at least one value`)
    library = await loadLibrary()
    const configuration = readJsonFile(parsed.config)
    const now = parsed.now ?? new Date().toISOString()
    if (!Number.isFinite(Date.parse(now))) throw new UsageError('--now must be an ISO timestamp')

    const notes: string[] = []
    // `--facts` already names its project; `--root` needs one before the observation exists.
    const injected = parsed.facts === undefined ? undefined : readJsonFile(parsed.facts)
    const factsProjectId = typeof (injected as { projectId?: unknown } | undefined)?.projectId === 'string'
      ? String((injected as { projectId: string }).projectId)
      : undefined
    if (parsed.project !== undefined && factsProjectId !== undefined && parsed.project !== factsProjectId)
      throw new UsageError(`--project ${parsed.project} 与 --facts 中的项目 ${factsProjectId} 不一致`)
    const projectId = projectIdFrom(configuration, parsed.project ?? factsProjectId)
    let facts: unknown
    if (injected !== undefined) {
      facts = injected
    } else {
      const observation = observeProjectMetadata({ root: parsed.root!, projectId, observedAt: now })
      facts = observation.facts
      notes.push(...observation.notes)
    }
    const kind = parsed.kind ?? 'regression_fix'
    const result = library.matchRecipe({
      facts,
      configuration,
      kind,
      selection: selectionFrom(parsed),
      now,
      ...(parsed.maxFactsAgeMs === undefined ? {} : { maxFactsAgeMs: parsed.maxFactsAgeMs }),
    })
    for (const note of notes) io.stderr(`note: ${note}\n`)

    const text = `${JSON.stringify(result, null, 2)}\n`
    if (parsed.output !== undefined) {
      const target = resolve(parsed.output)
      try {
        writeFileSync(target, text, { flag: 'wx', encoding: 'utf8' })
      } catch {
        throw new MetadataRefused('unreadable', target.split('/').pop() ?? 'output', '输出文件已存在或不可写；不覆盖既有文件')
      }
      io.stderr(`wrote: ${target}\n`)
    }
    io.stdout(text)
    if (result.status === 'needs_input') {
      for (const item of result.needsInput) io.stderr(`needs_input ${item.code} (${item.field}): ${item.message}\n`)
      return EXIT.needsInput
    }
    if (result.status === 'unsupported') {
      for (const item of result.unsupported) io.stderr(`unsupported ${item.code} (${item.field}): ${item.message}\n`)
      return EXIT.unsupported
    }
    io.stderr(`draft ${result.recipe.id} v${result.recipe.version} for ${result.projectId}; revision ${result.revision}\n`)
    return EXIT.draft
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`usage: ${error.message}\n`)
      return EXIT.usage
    }
    if (error instanceof MetadataRefused) {
      io.stderr(`refused [${error.code}] ${error.target}: ${error.message}\n`)
      return EXIT.refused
    }
    if (library !== undefined && error instanceof library.RecipeInputError) {
      io.stderr(`refused [${error.code}] ${error.message}\n`)
      return error.code === 'unknown_kind' ? EXIT.usage : EXIT.refused
    }
    io.stderr(`refused: ${(error as Error).message}\n`)
    return EXIT.refused
  }
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  process.exitCode = await main(process.argv.slice(2))
}
