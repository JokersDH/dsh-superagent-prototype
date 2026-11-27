/** Node --import bootstrap for the ORIGINAL DSH ACP entry, with no wire proxy or extra scheduler. */
import { randomUUID } from 'node:crypto'
import { renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { manifestForDshProfile, readDshPrivateJson, verifyDshAcpPolicy, isolateDshChildEnvironment } from './dsh-policy-installation.mjs'

const manifestPath = new URL(import.meta.url).searchParams.get('manifest')
if (!manifestPath) throw new Error('dsh-policy:missing_original_manifest')
const raw = readDshPrivateJson(manifestPath)
if (manifestForDshProfile(raw.profile) !== manifestPath) throw new Error('dsh-policy:manifest_binding')
const verified = verifyDshAcpPolicy(raw.profile)
if (verified.readiness !== 'policy_installed') throw new Error('dsh-policy:private_model_key_required')
const nonce = randomUUID(), createdAt = Date.now(), activationFile = join(verified.plan.activations, `${process.pid}-${nonce}.json`)
const pointer = join(verified.plan.activations, `launch-${process.pid}.json`), temporary = `${pointer}.${nonce}.tmp`
writeFileSync(temporary, JSON.stringify({ protocol: 'personal-agent-dsh-launch/1', pid: process.pid, nonce,
  createdAt, activationFile, policyIdentity: verified.policyIdentity, workspacePath: process.cwd() }), { flag: 'wx', mode: 0o600 })
renameSync(temporary, pointer)
isolateDshChildEnvironment(verified.plan)
process.env.PA_SUPERAGENT_DSH_ACTIVATION_FILE = activationFile
process.env.PA_SUPERAGENT_DSH_NONCE = nonce
