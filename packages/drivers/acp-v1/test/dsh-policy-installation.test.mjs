import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { installDshAcpPolicy, verifyDshAcpPolicy, inspectDshAcpProfile } from '../native-policies/dsh-policy-installation.mjs'
import { createDshAcpPolicyHost } from '../native-policies/dsh-policy-host.mjs'
import { canonicalDigest } from '../../../contracts/src/canonical.ts'
import { DSH_NATIVE_SCOPE } from '../native-policies/dsh-policy-installation.mjs'

const moduleRoot = process.env.PA_DSH_POLICY_MODULE_ROOT
for (const configured of [true, false]) test(`private DSH installation is reconstructible without a CLI (${configured ? 'configured' : 'no credential'})`, { skip: !moduleRoot }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pa-dsh-installation-')), connectionRoot = join(root, 'connection')
  const key = 'controlled-private-value-do-not-export'
  try {
    const installed = await installDshAcpPolicy({ connectionRoot, profileId: 'controlled-acp-dsh', nodeExecutable: process.execPath,
      dshEntry: resolve(moduleRoot, '../../lib/bin.js'), moduleRoot,
      model: { id: 'controlled-model', baseURL: 'http://127.0.0.1:1/v1', ...(configured ? { apiKey: key } : {}) } })
    assert.equal(installed.readiness, configured ? 'policy_installed' : 'needs_auth')
    assert.equal(installed.profile.driverId, 'acp-v1')
    assert.equal(installed.profile.argv[0], '--import')
    const current = verifyDshAcpPolicy(installed.profile)
    assert.equal(current.policyIdentity, installed.policyIdentity)
    assert.equal(current.plan.consumer.observations.length, 13)
    const boot = await import(pathToFileURL(join(moduleRoot, 'dsh-app-boot/lib/index.js')).href)
    const profileDir = join(connectionRoot, 'home/profiles/acp'), installAnchor = resolve(moduleRoot, '../../package.json')
    const nativeProfile = boot.loadProfileDirectory('dsh', profileDir, installAnchor)
    const overlays = boot.loadOverlayPatches('dsh', current.plan.overlayPath)
    const patches = boot.readProfilePatches('dsh', { name: 'acp', dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml'),
      installAnchor, home: join(connectionRoot, 'home'), cwd: root, overlays, telemetryDisabledEnv: '1' }, nativeProfile)
    const entries = boot.composeEntries([patches])
    assert.deepEqual(entries.find(row => row.id === 'acp').inject, ['acpAppStartup', 'personalAgentPolicy'])
    assert.equal(entries.find(row => row.id === 'hmr').disabled, true)
    assert.equal(entries.find(row => row.id === 'sandbox-policy').config.mode, 'read-only')
    assert.equal(entries.find(row => row.id === 'tools').config.mode, 'native')
    assert.equal(entries.find(row => row.id === 'acp').config.provider, 'personal-agent-model')
    const inspection = inspectDshAcpProfile(installed.profile)
    assert.equal(inspection.nativeVersion, '0.2.1-rc.2')
    const manifest = await readFile(installed.manifestPath, 'utf8')
    assert.equal(manifest.includes(key), false)
    assert.equal(manifest.includes(createHash('sha256').update(key).digest('hex')), false, 'raw credential hashes are not configuration identity')
    const credential = await readFile(join(connectionRoot, 'home/.credentials.yaml'), 'utf8')
    assert.equal(credential.includes(key), configured)
    assert.equal((await stat(join(connectionRoot, 'home/.credentials.yaml'))).mode & 0o077, 0)
    const host = createDshAcpPolicyHost({ runtime: { originalIdentity() { return undefined } } })
    const input = { spec: { profile: installed.profile }, settings: { workspacePath: root, scope: {
      projectId: 'controlled-project', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] } } }
    if (configured) await host.beforeSpawn(input)
    else await assert.rejects(host.beforeSpawn(input), /private_model_key_required/)
    await assert.rejects(host.beforeSpawn({ ...input, settings: { ...input.settings, scope: { ...input.settings.scope, allowedPaths: ['src/'] } } }), /scope_not_supported/)
    const originalManifest = JSON.parse(manifest)
    const forged = (mutate) => {
      const { profile, policyIdentity: _, ...plan } = structuredClone(originalManifest)
      mutate(plan)
      const policyIdentity = canonicalDigest(plan), claimedProfile = { ...profile, nativeConfigRef: `dsh-policy:${policyIdentity}` }
      return { document: { ...plan, policyIdentity, profile: claimedProfile }, profile: claimedProfile }
    }
    for (const mutate of [
      plan => { plan.sources = [] },
      plan => { plan.sources = plan.sources.filter(file => !file.path.endsWith('/dsh-product-policy.mjs')) },
      plan => { plan.configuration = [] },
      plan => { plan.configuration[2] = plan.configuration[1] },
      plan => { plan.home = join(root, 'foreign-home') },
    ]) {
      const claim = forged(mutate)
      await writeFile(installed.manifestPath, JSON.stringify(claim.document))
      assert.throws(() => verifyDshAcpPolicy(claim.profile), /dsh-policy:/, 'self-labelled digests cannot omit required source/configuration')
    }
    await writeFile(installed.manifestPath, manifest)
    // DSH itself rewrites the empty root on boot. Identical reviewed bytes are permitted, while a
    // different root is refused even if a caller changes its claimed digest and Profile identity.
    const rootConfig = join(connectionRoot, 'home/profiles/acp/cordis.yml'), rootBytes = await readFile(rootConfig, 'utf8')
    await writeFile(rootConfig, rootBytes)
    assert.equal(verifyDshAcpPolicy(installed.profile).policyIdentity, installed.policyIdentity)
    await writeFile(rootConfig, '- id: injected-root\n  name: unsafe\n')
    const alteredRoot = forged(plan => { plan.configuration[2].sha256 = createHash('sha256').update('- id: injected-root\n  name: unsafe\n').digest('hex') })
    await writeFile(installed.manifestPath, JSON.stringify(alteredRoot.document))
    assert.throws(() => verifyDshAcpPolicy(alteredRoot.profile), /required_configuration_template_changed/)
    await writeFile(rootConfig, rootBytes); await writeFile(installed.manifestPath, manifest)
    if (configured) {
      // A controlled negative tests witness validation only; it does not mint a real spawn/CLI PASS.
      const pid = process.pid, nonce = randomUUID(), createdAt = Date.now(), activationFile = join(current.plan.activations, `${pid}-${nonce}.json`)
      await writeFile(join(current.plan.activations, `launch-${pid}.json`), JSON.stringify({ protocol: 'personal-agent-dsh-launch/1', pid, nonce,
        createdAt, activationFile, policyIdentity: installed.policyIdentity, workspacePath: root }), { mode: 0o600 })
      await writeFile(activationFile, JSON.stringify({ protocol: 'personal-agent-dsh-activation/1', pid, nonce, createdAt,
        workspacePath: await import('node:fs').then(fs => fs.realpathSync(root)), scopeDigest: canonicalDigest(DSH_NATIVE_SCOPE) }), { mode: 0o600 })
      const witnessHost = createDshAcpPolicyHost({ runtime: { originalIdentity() { return { pid, groupId: pid, nonce: 'controlled-original-record',
        executable: installed.profile.executable, argv: installed.profile.argv, startMarker: 'CONTROLLED-NOT-A-NATIVE-BIRTH', spawnedAt: createdAt - 1000 } } } })
      await assert.rejects(witnessHost.prepare({ ...input, resourceRef: 'controlled-owned-resource',
        initialized: { protocolVersion: 1, agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' } }, session: { sessionId: 'controlled-session' } }), /native_guard_activation_binding/)
    }
    await writeFile(current.plan.overlayPath, `${await readFile(current.plan.overlayPath, 'utf8')}\n# changed\n`)
    assert.throws(() => verifyDshAcpPolicy(installed.profile), /source_or_configuration_changed/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
