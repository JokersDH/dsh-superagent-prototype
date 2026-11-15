#!/usr/bin/env node
/** Wave-29 signal-tool fixture: prints its own pid and a grandchild pid, then idles. */
import { spawn } from 'node:child_process'
const ignoreTerm = process.argv.includes('--ignore-term')
if (ignoreTerm) process.on('SIGTERM', () => {})
const grandchild = process.argv.includes('--child') ? spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }) : null
process.stdout.write(JSON.stringify({ pid: process.pid, childPid: grandchild?.pid ?? null }) + '\n')
setInterval(() => {}, 1000)
