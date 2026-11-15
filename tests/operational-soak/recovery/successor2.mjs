/**
 * Wave-31 H5 independent OS-process readback.
 *
 * Producer child (PID A) creates one controlled original Work/question/answer in a private A Store,
 * exits, and a successor child (PID B) reads the same Store with the original IDs. This proves a real
 * process boundary and same-Store continuity. It does NOT prove B coordinator recovery: no B runtime,
 * coordinator SIGKILL, Runner continuation or business ingress is started.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { observeProcess } from '../procguard/guard3.mjs'

function run(script, args) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolvePromise({ pid: child.pid, code, stdout, stderr }))
  })
}

export async function runSuccessorReadback({ root, normalChild, successorRead }) {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const producer = await run(normalChild, ['--root', root])
  if (producer.code !== 0) throw new Error(`normal child failed: ${producer.stderr.slice(0, 400)}`)
  const produced = JSON.parse(producer.stdout.trim().split('\n').at(-1))
  const afterExit = observeProcess(producer.pid)
  const state = join(root, 'state', 'state.sqlite')
  const successor = await run(successorRead, ['--state', state, '--work', produced.workId, '--question', produced.questionId, '--answer', produced.answerId])
  const readback = JSON.parse(successor.stdout.trim().split('\n').at(-1))
  const wrongWork = await run(successorRead, ['--state', state, '--work', 'deadbeef', '--question', produced.questionId, '--answer', produced.answerId])
  const missingState = await run(successorRead, ['--state', join(root, 'missing', 'state.sqlite'), '--work', produced.workId, '--question', produced.questionId, '--answer', produced.answerId])
  const normal = JSON.parse(readFileSync(join(root, 'normal.json'), 'utf8'))
  const checks = {
    producerExit0: producer.code === 0,
    producerPidGone: afterExit.state === 'gone' || afterExit.state === 'unknown',
    successorDifferentPid: successor.pid !== producer.pid && Number.isInteger(successor.pid),
    successorExit0: successor.code === 0,
    sameWorkQuestionAnswer: readback.ok === true && readback.workId === produced.workId && readback.questionId === produced.questionId && readback.answerQuestionId === produced.questionId,
    nativeApplied: readback.delivery === 'native_applied',
    sameStoreOriginalTuple: normal.work.id === produced.workId && normal.question.id === produced.questionId && normal.answer.answerId === produced.answerId && normal.attempt.attemptId === produced.attemptId,
    wrongWorkRefused: wrongWork.code === 1 && JSON.parse(wrongWork.stdout.trim().split('\n').at(-1)).ok === false,
    missingStateRefused: missingState.code === 1 && JSON.parse(missingState.stdout.trim().split('\n').at(-1)).ok === false,
    noSignalSent: true,
  }
  return {
    protocol: 'successor-readback/1',
    surface: 'two OS processes over one original A ProductStore; no B coordinator/Runner',
    producer: { pid: producer.pid, exit: producer.code, observationAfterExit: afterExit },
    successor: { pid: successor.pid, exit: successor.code, readback },
    original: produced,
    checks,
    bRecovery: 'NOT_REACHED: this is an independent new process reading the original Store, not a B coordinator recovery or Runner continuation.',
    limits: ['no old Runner process was alive', 'no coordinator SIGKILL/business answer recovery', 'no global process/socket discovery'],
  }
}
