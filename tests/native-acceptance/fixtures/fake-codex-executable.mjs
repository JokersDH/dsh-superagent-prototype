#!/usr/bin/env node
/**
 * B-owned fake Codex executable (wave-17 B1).
 *
 * `CodexProductDriver` spawns `spec.profile.executable` and speaks the installed app-server protocol
 * over its stdio. That is the seam this file fills: it is a real executable process, created by the
 * Runner's own ProcessHost, that answers the protocol using the B-owned in-memory fake app-server.
 *
 * Why this exists: the `codex-fake` scenario swapped in CodexNativeDriver, which never emits
 * `policy.prepared`, and it disabled eager preparation - so main's NativeProductAttempt waited for a
 * preparation fact that could never arrive. The right fix is not to remove main's guard or invent a
 * prepared fact; it is to give the ORIGINAL CodexProductDriver a real executable that completes the
 * version/app-server/preparation handshake. No installed Codex is executed and no gateway is touched.
 *
 * Invoked as:  node fake-codex-executable.mjs [--version]
 */
import { createFakeAppServer } from '../../../packages/drivers/codex-native/src/fake-app-server.ts'

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  process.stdout.write('codex-cli 0.164.0\n')
  process.exit(0)
}

// The approval variant emits a real approval request instead of completing silently, so the classic
// question path can be exercised through the original Broker.
const server = createFakeAppServer({ approval: process.env.PA_FAKE_APPROVAL === '1' })
const transport = server.transport()
transport.onData(chunk => process.stdout.write(chunk))
process.stdin.on('data', chunk => transport.send(chunk as Uint8Array))
process.stdin.on('end', () => { transport.close(); process.exit(0) })
// The Driver closes the connection when the turn ends; keep the process from lingering.
process.stdout.on('error', () => process.exit(0))

// No unsolicited banner: the Driver owns the handshake and an unexpected frame can make it close.
