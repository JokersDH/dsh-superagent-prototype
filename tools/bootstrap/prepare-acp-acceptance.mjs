/** Prepare real Work inputs only. This entry never opens a vendor, service, Store or sender ledger. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseArgs } from 'node:util'
import { IdSchema, UserCommandSchema } from '../../packages/contracts/dist/index.js'
import { NativeProjectRegistry } from '../../apps/coordinator/product/project-registry.ts'

const { values } = parseArgs({ options: { 'profile-id': { type: 'string' } } })
if (!values['profile-id']) throw new Error('Pass --profile-id naming the intended ACP configuration; this prepares inputs and sends nothing')
const profileId = IdSchema.parse(values['profile-id'])
const root = mkdtempSync(join(tmpdir(), 'pa-acp-acceptance-')), project = join(root, 'project'), config = join(root, 'project-config')
mkdirSync(project, { mode: 0o700 }); mkdirSync(config, { mode: 0o700 })
mkdirSync(join(project, 'src')); mkdirSync(join(project, 'test'))
const source = 'export function add(a, b) { return a - b }\n'
const checks = "import test from 'node:test';import assert from 'node:assert/strict';import {add} from '../src/calc.mjs';test('add',()=>{assert.equal(add(2,3),5);assert.equal(add(-2,3),1);assert.equal(add(0,0),0)});\n"
writeFileSync(join(project, 'src/calc.mjs'), source)
writeFileSync(join(project, 'test/acceptance.test.mjs'), checks)
const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args],
  { cwd: project, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim()
git(['init', '-q']); git(['add', 'src/calc.mjs', 'test/acceptance.test.mjs'])
git(['-c', 'user.name=ACP Acceptance', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Failing arithmetic acceptance baseline'])
const baseline = spawnSync(process.execPath, ['--test'], { cwd: project, encoding: 'utf8' })
assert.equal(baseline.status, 1, 'the baseline must fail the registered behavioral check')
assert.equal(baseline.signal, null)
const registry = new NativeProjectRegistry(config)
const registration = { path: project, displayName: 'ACP short-task acceptance', check: 'node_test' }
const registered = registry.prepare(registration, { readOnlyInspection: true })
const check = registry.check(registered)
const nonce = randomUUID(), conversationId = `conv-acp-${nonce}`
const scope = { projectId: registered.id, allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] }
const goal = '修复 src/calc.mjs 的 add(a,b)，实现加法。可读取 src/calc.mjs 和 test/acceptance.test.mjs；只修改 src/calc.mjs，不改测试和 Git 元数据。无需运行命令、联网或安装依赖，工作台会运行注册检查。若权限被拒绝，停止修改，不换路径或重试受禁操作。'
const criteria = [{ id: 'arithmetic-tests', kind: 'machine', required: true, description: 'Original arithmetic tests pass unchanged', checkDefinitionRef: check.id },
  { id: 'patch-review', kind: 'human', required: true, description: 'Review current patch and accept only the requested source change' }]
const scenarios = ['allow', 'deny', 'stop'].map(name => ({ name,
  command: UserCommandSchema.parse({ kind: 'create_work', commandId: `m04-acp-${name}-${nonce}`, conversationId,
    projectId: registered.id, profileId, goal, scope, criteria }),
  action: name === 'allow' ? 'Answer the actual native permission with allow_once; inspect original checks and frozen patch; explicitly accept the current candidate.'
    : name === 'deny' ? 'Answer the actual native permission with deny; verify zero forbidden source writes. Do not retry or invent another question.'
    : 'Stop while the original prompt is still in flight, before answering its pending native permission or after its first live update; never count a naturally ended prompt as running stop.',
}))
const plan = { protocol: 'acp-acceptance-inputs/1', root, registration, baseCommit: git(['rev-parse', 'HEAD']),
  sourcePath: 'src/calc.mjs', sourceBaseline: source, unchangedCheckPath: 'test/acceptance.test.mjs', unchangedCheck: checks,
  baselineCheck: { command: [process.execPath, '--test'], exit: baseline.status }, profileId, scenarios,
  accounting: { grantId: 'm04-second-protocol-live-20261126', owner: 'B', sharedCeiling: 6, promptsSentByPreparation: 0,
    instruction: 'Use B original actual-send ledger only. Read/reconcile the original command, native journal and send evidence; this file is neither a grant nor a ledger.' },
  limits: ['Prepared input only, no live readiness or model call', 'Use the original normal product HTTP/UI; register the project before creating Work',
    'No automatic create/answer/accept/stop/retry; keep original identities on unknown results',
    'Only original complete owned-resource barrier releases occupancy; native terminal/cancel ACK alone is insufficient'],
}
writeFileSync(join(root, 'inputs.json'), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
assert.equal(git(['status', '--porcelain']), '')
assert.equal(readFileSync(join(project, 'test/acceptance.test.mjs'), 'utf8'), checks)
console.log(JSON.stringify({ status: 'INPUTS_PREPARED_ONLY', inputFile: join(root, 'inputs.json'), root, profileId,
  baseCommit: plan.baseCommit, failingRegisteredCheckConfirmed: true, modelTurns: 0, signals: 0, liveReady: false }, null, 2))
