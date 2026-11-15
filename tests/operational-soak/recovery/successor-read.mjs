#!/usr/bin/env node
/** New-process readback of one original Work/question/answer from the same A Store. */
import { ProductStore } from '../../../packages/storage/dist/index.js'

const args = process.argv.slice(2)
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const state = value('--state')
const work = value('--work')
const question = value('--question')
const answer = value('--answer')
if ([state, work, question, answer].some((entry) => entry === null)) { console.error('usage: successor-read.mjs --state <db> --work <id> --question <id> --answer <id>'); process.exit(2) }
let store
try {
  store = new ProductStore({ path: state })
  const workRow = store.product.works.get(work)
  const questionRow = store.product.questions.get(question)
  const answerRow = store.answers.get(answer)
  const delivery = store.answers.deliveries(answer)[0] ?? null
  const ok = workRow?.id === work && questionRow?.id === question && answerRow?.questionId === question && delivery?.status === 'native_applied'
  console.log(JSON.stringify({ pid: process.pid, ok, workId: workRow?.id ?? null, questionId: questionRow?.id ?? null, questionVersion: questionRow?.version ?? null, answerQuestionId: answerRow?.questionId ?? null, delivery: delivery?.status ?? null }))
  process.exit(ok ? 0 : 1)
} catch (error) {
  console.log(JSON.stringify({ pid: process.pid, ok: false, error: String(error?.message ?? error) }))
  process.exit(1)
} finally {
  try { store?.close() } catch { /* read projection */ }
}
