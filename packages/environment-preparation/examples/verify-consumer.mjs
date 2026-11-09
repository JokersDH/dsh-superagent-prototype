#!/usr/bin/env node
/** Second-process consumer: verify a serialized ref, optionally clean owned paths. */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { cleanupPreparedEnvironment, verifyPreparedEnvironment } from '../src/index.ts'

const { values } = parseArgs({ options: { ref: { type: 'string' }, cleanup: { type: 'boolean', default: false } } })
if (!values.ref) throw new Error('--ref is required')
const ref = JSON.parse(readFileSync(values.ref, 'utf8'))
const result = values.cleanup ? await cleanupPreparedEnvironment(ref) : verifyPreparedEnvironment(ref)
console.log(JSON.stringify(result, null, 2))
if (result.status !== 'valid' && result.status !== 'cleaned') process.exitCode = 1
