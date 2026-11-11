#!/usr/bin/env node
/**
 * B6: D-facing diagnostic view (wave-06, zero model calls, no secrets).
 *
 * D needs readable runtime version / capability / gap facts for the installer and recovery
 * diagnostics. This prints them from real local inspection and says explicitly what is UNKNOWN
 * rather than filling gaps with a plausible-looking default.
 *
 * Deliberately contains NO credentials, tokens, account identifiers, session text or absolute
 * user-home paths beyond the binary itself.
 *
 * Usage: node tests/native-acceptance/runtime-diagnostics.mjs [--json]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { currentRuntimePreflight } from './cost-preflight.mjs'

const asJson = process.argv.includes('--json')

/** Run a command and capture either trimmed stdout or a classified failure. */
const probe = (cmd, args) => {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'] })
    return { ok: true, value: out.trim() }
  } catch (error) {
    return { ok: false, value: null, reason: error.code ?? 'failed' }
  }
}

const which = name => probe('sh', ['-c', `command -v ${name} 2>/dev/null || true`]).value || null

// --- versions and presence -------------------------------------------------------------------
const codexPath = which('codex')
const codexVersion = codexPath ? probe('codex', ['--version']) : { ok: false, value: null, reason: 'not_installed' }

const diagnostics = {
  protocol: 'runtime-diagnostics/1',
  generatedAt: new Date().toISOString(),
  modelCalls: 0,
  runtime: {
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    codex: {
      installed: Boolean(codexPath),
      version: codexVersion.ok ? codexVersion.value : null,
      /** Where the binary is - a tool path, not a credential or account home. */
      path: codexPath,
      versionKnown: codexVersion.ok,
    },
  },

  // --- capability surface, from the real generated protocol --------------------------------
  capability: {
    /** These are protocol-surface facts from `codex app-server generate-ts`, not a compatibility PASS. */
    sessionStart: 'available (thread/start, ephemeral supported)',
    sessionResume: 'available (thread/resume)',
    sessionFork: 'available (thread/fork, optional lastTurnId cut point)',
    threadRead: 'available (thread/read, thread/turns/list, thread/items/list)',
    sandboxModes: ['read-only', 'workspace-write', 'danger-full-access'],
    approvalRoutes: ['user', 'auto_review', 'guardian_subagent'],
    usageReporting: 'available post-turn (total + last; input/cached/cache-write/output/reasoning)',
    pricingSurface: 'ABSENT - no price/cost field exists in the generated protocol',
  },

  // --- gaps, each with an owner so D can route it ------------------------------------------
  gaps: collectGaps(codexPath),

  // --- what this report cannot tell you ----------------------------------------------------
  unknown: [
    'whether the installed Codex is authenticated (a credential file existing is only a hint)',
    'whether a real native turn would succeed on this machine today',
    'the actual model that would be used, and its price',
  ],
}

// A local session directory count is a coarse presence hint only - never an identity or a secret.
const sessionsDir = join_home('.codex', 'sessions')
diagnostics.runtime.codexSessionStore = describeStore(sessionsDir)

/** Each gap carries an owner so D can route it instead of guessing. */
function collectGaps(codexPath) {
  const list = [{
    id: 'pricing_unavailable',
    owner: 'main/E',
    detail: 'The protocol exposes no price or cost field, so a cost ceiling has no unit.',
    forD: 'Do not print an estimated cost. Report cost as unavailable.',
  }]
  const preflight = currentRuntimePreflight()
  if (preflight.verdict !== 'READY') {
    list.push({
      id: 'turn_bound_unproven',
      owner: 'B/main',
      detail: `${preflight.blockers.length} billed component(s) cannot be bounded before send.`,
      forD: 'Treat any on-demand native run as unbounded and say so in diagnostics.',
    })
  }
  if (!codexPath) {
    list.push({
      id: 'codex_missing',
      owner: 'D',
      detail: 'The Codex CLI is not installed or not on PATH.',
      forD: 'Report the native lane as unavailable rather than degrading silently.',
    })
  }
  list.push({
    id: 'native_stop_untested',
    owner: 'B/E',
    detail: 'Real vendor stop/question/unknown-send are NOT_TESTED; only controlled-process stop is proven.',
    forD: 'Do not claim native control works in installation diagnostics.',
  })
  return list
}

function join_home(...parts) {
  const home = process.env.HOME
  return home ? `${home}/${parts.join('/')}` : null
}
function describeStore(dir) {
  if (!dir || !existsSync(dir)) return { present: false, note: 'no session store found; nothing was read' }
  try {
    statSync(dir)
    // Count top-level year directories only; never enumerate or read session content.
    const years = readdirSync(dir).filter(name => /^\d{4}$/.test(name))
    return { present: true, note: `store present with ${years.length} year bucket(s); contents were NOT read` }
  } catch {
    return { present: true, note: 'store present but unreadable; contents were NOT read' }
  }
}

if (asJson) process.stdout.write(`${JSON.stringify(diagnostics, null, 2)}\n`)
else {
  process.stdout.write(`runtime  node ${diagnostics.runtime.node} on ${diagnostics.runtime.platform}\n`)
  process.stdout.write(`codex    ${diagnostics.runtime.codex.installed ? `${diagnostics.runtime.codex.version} (${diagnostics.runtime.codex.path})` : 'NOT INSTALLED'}\n`)
  process.stdout.write('\ncapability (protocol surface, not a compatibility PASS):\n')
  for (const [key, value] of Object.entries(diagnostics.capability)) {
    process.stdout.write(`  ${key.padEnd(18)} ${Array.isArray(value) ? value.join(' | ') : value}\n`)
  }
  process.stdout.write(`\nsession store  ${diagnostics.runtime.codexSessionStore.note}\n`)
  process.stdout.write('\ngaps:\n')
  for (const gap of diagnostics.gaps) process.stdout.write(`  [${gap.owner}] ${gap.id}: ${gap.detail}\n`)
  process.stdout.write('\nunknown:\n')
  for (const item of diagnostics.unknown) process.stdout.write(`  - ${item}\n`)
  process.stdout.write('\nmodelCalls=0\n')
}
