#!/usr/bin/env node
/** Run the controlled original normal chain in this process and print its original IDs. */
import { mkdirSync } from 'node:fs'
import { produceNormalChain } from './normal-chain.mjs'

const args = process.argv.slice(2)
const index = args.indexOf('--root')
const root = index >= 0 ? args[index + 1] : null
if (root === null) { console.error('usage: normal-child.mjs --root <new-root>'); process.exit(2) }
mkdirSync(root, { recursive: true, mode: 0o700 })
const facts = await produceNormalChain({ root })
console.log(JSON.stringify({ pid: process.pid, workId: facts.work.id, questionId: facts.question.id, answerId: facts.answer.answerId, commandId: facts.answer.commandId, attemptId: facts.attempt.attemptId, delivery: facts.deliveries[0]?.status ?? null }))
