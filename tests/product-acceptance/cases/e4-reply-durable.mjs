import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { runCase, notTested, LAYERS } from '../lib/status.mjs'

const here = new URL('.', import.meta.url).pathname
const child = join(here, 'w12-reply-process-child.mjs')
const define = (id, title, extra = {}) => ({ id, title, layer: LAYERS.CONTROLLED, limitations: [
  'Separate OS process with current product runtime, real A18 SQLite/effect queue and a loopback mock provider; no Map result port.',
  ...(extra.limitations ?? []),
] })

function run(root, mode) {
  const result = spawnSync(process.execPath, [child, root, mode], { encoding: 'utf8', timeout: 25_000 })
  const line = String(result.stdout).trim().split('\n').filter(Boolean).at(-1)
  let value
  try { value = line ? JSON.parse(line) : undefined } catch { value = undefined }
  return { status: result.status, signal: result.signal, value, stderr: String(result.stderr).slice(-400) }
}

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'pa-w12-reply-'))
}

export async function runReplyDurability() {
  const cases = []
  cases.push(await runCase({ ...define('E2-REPLY-DURABLE', 'A18 result and reply recover across independent SIGKILL processes without a second provider call'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = tempRoot()
      try {
        const first = run(root, 'after-result')
        assert('FIRST_KILLED', first.signal === 'SIGKILL', JSON.stringify({ status: first.status, signal: first.signal }))
        assert('RESULT_PERSISTED', first.value?.schema === 18 && !!first.value?.result?.requestId, JSON.stringify(first.value)?.slice(0, 300))
        assert('NO_REPLY_BEFORE_RECOVERY', first.value?.replies?.length === 0, String(first.value?.replies?.length))
        assert('ONE_PROVIDER_CALL', first.value?.modelCalls === 1, String(first.value?.modelCalls))
        const recovered = run(root, 'recover')
        assert('RECOVER_OK', recovered.status === 0 && recovered.value?.modelCalls === 0, JSON.stringify({ status: recovered.status, calls: recovered.value?.modelCalls }))
        assert('REPLY_ONCE', recovered.value?.replies?.length === 1 && recovered.value.replies[0].text.includes('W12 durable'), JSON.stringify(recovered.value?.replies))
        assert('RESULT_IDENTICAL', JSON.stringify(recovered.value?.result) === JSON.stringify(first.value?.result), 'result changed')
        const replay = run(root, 'recover')
        assert('REPLAY_IDEMPOTENT', replay.status === 0 && replay.value?.modelCalls === 0 && JSON.stringify(replay.value?.replies) === JSON.stringify(recovered.value?.replies), JSON.stringify(replay.value)?.slice(0, 300))
        evidence.replyDurable = { first: { calls: first.value.modelCalls, result: first.value.result.requestId, replies: 0 },
          recovered: { calls: recovered.value.modelCalls, replies: recovered.value.replies.length }, replayed: replay.value.modelCalls }
      } finally { rmSync(root, { recursive: true, force: true }) }
    }))

  cases.push(await runCase({ ...define('E2-REPLY-UNKNOWN-DURABLE', 'A request without a completed result stays unknown across SIGKILL and is never resent'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = tempRoot()
      try {
        const crashed = run(root, 'during-provider')
        assert('UNKNOWN_KILLED', crashed.signal === 'SIGKILL' && crashed.value?.modelCalls === 1, JSON.stringify(crashed.value)?.slice(0, 300))
        assert('REQUEST_ONLY', crashed.value?.requestRecorded === true && crashed.value?.result === null, JSON.stringify(crashed.value)?.slice(0, 200))
        const recovered = run(root, 'recover')
        assert('UNKNOWN_RECOVERED', recovered.status === 0 && recovered.value?.modelCalls === 0 && recovered.value?.replies?.length === 0, JSON.stringify(recovered.value)?.slice(0, 300))
        assert('UNKNOWN_NOTICE', recovered.value?.notices?.length === 1 && /未自动重发/.test(recovered.value.notices[0].text), JSON.stringify(recovered.value?.notices))
        const replay = run(root, 'recover')
        assert('UNKNOWN_NO_RESEND_REPLAY', replay.value?.modelCalls === 0 && JSON.stringify(replay.value?.notices) === JSON.stringify(recovered.value?.notices), JSON.stringify(replay.value)?.slice(0, 200))
        evidence.replyUnknown = { crashedCalls: crashed.value.modelCalls, recoveredCalls: recovered.value.modelCalls, notice: recovered.value.notices[0].text }
      } finally { rmSync(root, { recursive: true, force: true }) }
    }))

  cases.push(await runCase({ ...define('E2-REPLY-MESSAGE-WINDOW', 'SIGKILL after the reply message commit keeps exactly one reply and result'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = tempRoot()
      try {
        const crashed = run(root, 'after-message')
        assert('MESSAGE_KILLED', crashed.signal === 'SIGKILL' && crashed.value?.replies?.length === 1, JSON.stringify(crashed.value)?.slice(0, 300))
        const recovered = run(root, 'recover')
        assert('MESSAGE_RECOVERED', recovered.status === 0 && recovered.value?.modelCalls === 0 && recovered.value?.replies?.length === 1, JSON.stringify(recovered.value)?.slice(0, 300))
        assert('MESSAGE_SAME_RESULT', JSON.stringify(recovered.value?.result) === JSON.stringify(crashed.value?.result), 'result changed')
        evidence.replyMessageWindow = { crashedCalls: crashed.value.modelCalls, recoveredCalls: recovered.value.modelCalls, replies: recovered.value.replies.length }
      } finally { rmSync(root, { recursive: true, force: true }) }
    }))

  cases.push(await runCase({ ...define('E2-REPLY-BAD-ARTIFACT', 'A corrupted persisted artifact refuses recovery without a new provider call'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = tempRoot()
      try {
        const crashed = run(root, 'after-result')
        assert('BAD_ARTIFACT_SETUP', !!crashed.value?.result?.artifactRef, JSON.stringify(crashed.value)?.slice(0, 300))
        const store = new ProductStore({ path: join(root, 'state/state.sqlite') })
        let path
        try { path = store.artifacts.filePath(crashed.value.result.artifactRef) } finally { store.close() }
        writeFileSync(path, 'W12 corrupted reply artifact')
        const recovered = run(root, 'recover')
        assert('BAD_ARTIFACT_NO_REPLY', recovered.status === 0 && recovered.value?.modelCalls === 0 && recovered.value?.replies?.length === 0, JSON.stringify(recovered.value)?.slice(0, 300))
        assert('BAD_ARTIFACT_NOTICE', recovered.value?.notices?.length === 1 && /无法核对/.test(recovered.value.notices[0].text), JSON.stringify(recovered.value?.notices))
        evidence.replyBadArtifact = { calls: recovered.value.modelCalls, replies: 0, notice: recovered.value.notices[0].text }
      } finally { rmSync(root, { recursive: true, force: true }) }
    }))

  cases.push(notTested({
    ...define('E4-B-PRODUCTION-RECOVERY', 'Real B production begin/answer/stop recovery through the product Store/queues/Runner', { layer: LAYERS.NOT_TESTED }),
  }, 'NOT_TESTED: current main product path uses ProductExecution with fixture/Codex profiles, but B\'s new production control candidate is not consumed by main and native execution is outside this wave. Required: actual product begin command -> Work/Ticket/effect/fact_receipts/dispatch_receipts/answers/answer_deliveries/user_questions/runtime rows, real transport/epoch counts, independent process SIGKILL, unknown no resend, and stop/answer through the existing queue. A fixture or receipt-only row is not production recovery.'))

  return { cases, artifacts: {} }
}
