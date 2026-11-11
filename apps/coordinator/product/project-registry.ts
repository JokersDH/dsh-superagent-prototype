import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { IdSchema, JsonSchema, ProjectRegistrationInputSchema } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import type { ProjectRegistrationInput, Scope } from '@personal-agent/contracts'
import type { CheckDefinition } from '@personal-agent/verification'
import { ApplicationFault } from '@personal-agent/application'

const ProjectRecordSchema = z.strictObject({
  id: IdSchema,
  path: z.string().min(1).max(4096),
  displayName: z.string().min(1).max(160),
  check: ProjectRegistrationInputSchema.shape.check,
  environment: ProjectRegistrationInputSchema.shape.environment,
})
const RegistrySchema = z.strictObject({ version: z.literal(1), projects: z.array(ProjectRecordSchema).max(100) })
export type RegisteredProject = z.infer<typeof ProjectRecordSchema>
const git = (cwd: string, args: string[], readOnlyInspection = false) =>
  execFileSync('git', readOnlyInspection ? ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args] : args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000,
    maxBuffer: 2 * 1024 * 1024,
    ...(readOnlyInspection ? { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } } : {}),
  }).trim()

/** Operator project settings are private configuration, not another execution database. */
export class NativeProjectRegistry {
  private readonly file: string
  private records: RegisteredProject[] = []
  constructor(privateRoot: string) {
    mkdirSync(privateRoot, { recursive: true, mode: 0o700 })
    const directory = lstatSync(privateRoot)
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      directory.mode & 0o077 ||
      (process.getuid && directory.uid !== process.getuid())
    )
      throw new Error('Project configuration directory must be private and user-owned')
    this.file = join(privateRoot, 'native-projects.json')
    if (existsSync(this.file)) {
      const stat = lstatSync(this.file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024 || stat.mode & 0o077)
        throw new Error('Unsafe private project configuration')
      this.records = RegistrySchema.parse(JSON.parse(readFileSync(this.file, 'utf8'))).projects
    }
  }
  list(): RegisteredProject[] {
    return structuredClone(this.records)
  }
  prepare(input: ProjectRegistrationInput, options: { allowSettingsChange?: boolean; readOnlyInspection?: boolean } = {}): RegisteredProject {
    input = ProjectRegistrationInputSchema.parse(input)
    if (!isAbsolute(input.path)) throw new ApplicationFault('invalid_request', '请选择 Git 仓库的绝对路径。')
    let path: string
    try {
      path = realpathSync(input.path)
      if (!lstatSync(path).isDirectory() || realpathSync(git(path, ['rev-parse', '--show-toplevel'], options.readOnlyInspection)) !== path)
        throw new Error('not a repository root')
      git(path, ['rev-parse', '--verify', 'HEAD'], options.readOnlyInspection)
    } catch {
      throw new ApplicationFault('invalid_request', '目录必须是已有提交的 Git 仓库根目录。')
    }
    if (git(path, ['status', '--porcelain=v1', '--untracked-files=normal', ...(options.readOnlyInspection ? ['--ignore-submodules=all'] : [])], options.readOnlyInspection))
      throw new ApplicationFault('conflict', '项目有未提交的修改，请提交当前基线后再导入。')
    let environment = input.environment
    if (environment?.policy === 'offline_install') {
      try {
        const storeDir = realpathSync(environment.storeDir)
        const rel = relative(path, storeDir)
        if (!lstatSync(storeDir).isDirectory() || !(rel === '..' || rel.startsWith('../'))) throw new Error('unsafe store')
        environment = { policy: 'offline_install', storeDir }
      } catch { throw new ApplicationFault('invalid_request', '离线缓存必须是项目目录之外的已有目录。') }
    }
    const record = ProjectRecordSchema.parse({
      id: `project-${canonicalDigest(path).slice(0, 24)}`,
      path,
      displayName: input.displayName ?? basename(path),
      check: input.check,
      ...(environment ? { environment } : {}),
    })
    const existing = this.records.find((project) => project.id === record.id)
    if (existing && !options.allowSettingsChange && canonicalDigest(JsonSchema.parse(existing)) !== canonicalDigest(JsonSchema.parse(record)))
      throw new ApplicationFault('conflict', '该项目已使用另一份设置导入。')
    if (!existing && this.records.length >= 100)
      throw new ApplicationFault('budget_exceeded', '当前最多导入 100 个项目。')
    return record
  }
  save(record: RegisteredProject): void {
    const projects = [...this.records.filter((project) => project.id !== record.id), record]
    const bytes = Buffer.from(JSON.stringify(RegistrySchema.parse({ version: 1, projects }), null, 2) + '\n')
    const temporary = `${this.file}.${randomUUID()}.tmp`
    const fd = openSync(temporary, 'wx', 0o600)
    try {
      for (let offset = 0; offset < bytes.length; ) offset += writeSync(fd, bytes, offset)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    try {
      renameSync(temporary, this.file)
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary)
    }
    const directory = openSync(dirname(this.file), 'r')
    try {
      fsyncSync(directory)
    } finally {
      closeSync(directory)
    }
    this.records = projects
  }
  scope(record: RegisteredProject): Scope {
    return { projectId: record.id, allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] }
  }
  check(record: RegisteredProject): CheckDefinition {
    const executable =
      record.check === 'node_test'
        ? process.execPath
        : execFileSync('which', [record.check === 'pnpm_test' ? 'pnpm' : 'npm'], { encoding: 'utf8' }).trim()
    return {
      id: `check-${record.id}`,
      revision: 1,
      title: record.check === 'node_test' ? 'Node 测试' : record.check === 'pnpm_test' ? 'pnpm test' : 'npm test',
      executable,
      argv: record.check === 'node_test' ? ['--test'] : ['test'],
      deadlineMs: 120000,
      outputLimitBytes: 200000,
      ...(record.environment ? { allowedEnvironment: ['HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'PNPM_HOME', 'COREPACK_HOME', 'COREPACK_ENABLE_NETWORK', 'COREPACK_ENABLE_DOWNLOAD_PROMPT', 'CI'] } : {}),
    }
  }
  environment(record: RegisteredProject) {
    return record.environment ? {
      ...record.environment,
      ...(record.environment.policy === 'offline_install'
        ? { managerCommand: execFileSync('which', ['pnpm'], { encoding: 'utf8' }).trim() } : {}),
    } : undefined
  }
}

export function ensureStarterProject(path: string): void {
  if (existsSync(path)) return
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 })
  mkdirSync(path, { mode: 0o700 })
  mkdirSync(join(path, 'src'))
  mkdirSync(join(path, 'test'))
  writeFileSync(
    join(path, 'package.json'),
    JSON.stringify(
      { name: 'personal-agent-project', private: true, type: 'module', scripts: { test: 'node --test' } },
      null,
      2,
    ) + '\n',
  )
  writeFileSync(join(path, 'src/index.mjs'), 'export const greet = name => `Hello, ${name}!`\n')
  writeFileSync(
    join(path, 'test/index.test.mjs'),
    "import test from 'node:test';import assert from 'node:assert/strict';import {greet} from '../src/index.mjs';test('greeting',()=>assert.equal(greet('world'),'Hello, world!'))\n",
  )
  writeFileSync(join(path, '.gitignore'), 'node_modules/\n')
  git(path, ['init', '-q'])
  git(path, ['add', 'package.json', 'src', 'test', '.gitignore'])
  git(path, [
    '-c',
    'user.name=Personal Agent',
    '-c',
    'user.email=local@localhost',
    'commit',
    '-qm',
    'Initial personal development project',
  ])
}
