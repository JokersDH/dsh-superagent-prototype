import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CAPABILITY_STATES,
  EVIDENCE_LAYERS,
  describeRuntime,
  descriptionDigest,
  probeHostEnforcement,
  resolveRuntimeIdentity,
} from '../src/runtime-diagnostics.ts'

test('the public description never discloses a home or store path', () => {
  // main chooses the public projection, so the default must be safe to publish verbatim.
  const description = describeRuntime()
  const serialized = JSON.stringify(description)
  assert.equal(description.pathRedacted, true)
  assert.equal(description.identity.declaredPath, description.identity.declaredPath ? '[redacted]' : null)
  assert.ok(!serialized.includes(process.env.HOME ?? '/Users/'), 'the public projection leaked a home path')
  assert.ok(!serialized.includes('.codex'), 'the public projection leaked a store path')
  assert.equal(description.private, undefined, 'private facts must not appear without an explicit request')
})

test('the private projection is opt-in and carries the full identity', () => {
  const description = describeRuntime({ includePrivate: true })
  assert.equal(description.pathRedacted, false)
  assert.ok(description.private, 'an explicit request must return private facts')
  assert.equal(typeof description.private.home, 'string')
  assert.ok(Array.isArray(description.private.knownPaths))
})

test('a redacted and a private description of the same runtime agree on the digest', () => {
  // Redaction is a presentation choice, not an identity change: a consumer must be able to compare
  // the two without the comparison being invalidated by withheld paths.
  const publicDigest = descriptionDigest(describeRuntime())
  const privateDigest = descriptionDigest(describeRuntime({ includePrivate: true }))
  assert.match(publicDigest, /^[a-f0-9]{64}$/)
  assert.equal(publicDigest, privateDigest)
})

test('a redacted description is still judged usable on the observed binary', () => {
  // The trap: computing usability from the redacted projection would make every safe description
  // look unusable, because a redacted path is not a missing path.
  const description = describeRuntime()
  if (description.identity.digest) {
    assert.equal(description.usable, true)
    assert.deepEqual(description.reasons, [])
  }
})

test('a missing binary refuses instead of degrading to a green light', () => {
  const description = describeRuntime({ binary: 'definitely-not-a-real-binary-xyz' })
  assert.equal(description.usable, false)
  assert.equal(description.billableAdmitted, false)
  assert.match(description.reasons.join(' '), /was not found on PATH/)
  // Every billing-relevant row must be blocked, and none may read as supported.
  for (const row of description.capabilities.filter(row => row.admitsBilling)) {
    assert.notEqual(row.state, 'supported', `${row.id} reported supported for a missing binary`)
  }
})

test('a descriptor cannot unlock billing', () => {
  // Supplying capability claims is how a caller reports measured protocol facts. It must never be a
  // way to switch on admission, because the rows that gate billing are the ones that stay blocked.
  const description = describeRuntime({
    capabilities: {
      turn_budget_field: { state: 'supported', layer: 'measured_protocol', detail: 'claimed by caller' },
    },
  })
  // Even a caller-claimed ceiling does not admit billing on its own: pricing and native control
  // remain blocked, so the overall light stays off.
  const blocked = description.blockedCapabilities.map(row => row.id)
  assert.ok(blocked.includes('pricing_surface') || blocked.includes('native_control'))
  assert.equal(description.billableAdmitted, false)
})

test('billing is never admitted while any billing-relevant capability is unsupported', () => {
  const description = describeRuntime()
  const unsupportedBilling = description.capabilities.filter(row => row.admitsBilling && row.state !== 'supported')
  assert.equal(description.billableAdmitted, unsupportedBilling.length === 0)
  if (unsupportedBilling.length > 0) {
    assert.equal(description.billableAdmitted, false)
    assert.deepEqual(description.blockedCapabilities.map(row => row.id).sort(), unsupportedBilling.map(row => row.id).sort())
  }
})

test('every capability row states its evidence layer and what would invalidate it', () => {
  const description = describeRuntime()
  assert.ok(description.capabilities.length > 0)
  for (const row of description.capabilities) {
    assert.ok(CAPABILITY_STATES.includes(row.state), `${row.id} has an unknown state ${row.state}`)
    assert.ok(EVIDENCE_LAYERS.includes(row.layer), `${row.id} has an unknown layer ${row.layer}`)
    assert.equal(typeof row.invalidation, 'string')
    assert.ok(row.invalidation.length > 0, `${row.id} does not say what invalidates it`)
  }
})

test('untested is never rendered as supported', () => {
  const description = describeRuntime()
  const nativeControl = description.capabilities.find(row => row.id === 'native_control')
  assert.equal(nativeControl.state, 'untested')
  assert.notEqual(nativeControl.state, 'supported')
})

test('the description refuses to over-claim', () => {
  const description = describeRuntime()
  assert.ok(Array.isArray(description.notClaimed))
  assert.ok(description.notClaimed.length >= 3)
  assert.match(description.notClaimed.join(' '), /turn will succeed/)
  assert.match(description.notClaimed.join(' '), /acceptance/)
})

test('host enforcement is measured by executing a probe, not by platform name', () => {
  const enforcement = probeHostEnforcement()
  assert.equal(typeof enforcement.available, 'boolean')
  assert.equal(typeof enforcement.evidence, 'string')
  if (enforcement.available) {
    assert.ok(enforcement.mechanism, 'an available mechanism must be named')
    assert.ok(enforcement.executable, 'an available mechanism must name its executable')
  } else {
    assert.equal(enforcement.mechanism, null)
  }
})

test('identity resolution reports both a version and a byte digest', () => {
  const identity = resolveRuntimeIdentity()
  assert.equal(typeof identity.binary, 'string')
  assert.equal(identity.platform, process.platform)
  if (identity.declaredPath) {
    assert.match(identity.digest, /^[a-f0-9]{64}$/)
    assert.equal(typeof identity.bytes, 'number')
    assert.ok(identity.version, 'a located binary must report a version')
  }
})

// --- wave-09 B5: diagnostics report, they never grant -----------------------------------------

test('a caller capability override cannot switch on billing', () => {
  // Every billing-relevant row claimed supported and a full model identity supplied: still no light,
  // because an override is a report and the rows stay at their observed value.
  const description = describeRuntime({
    capabilities: {
      turn_budget_field: { state: 'supported' },
      pricing_surface: { state: 'supported' },
      native_control: { state: 'supported' },
    },
    modelIdentity: { model: 'gpt-6.1-sol', modelProvider: 'OpenAI', observedFrom: 'thread/start' },
  })
  assert.equal(description.billableAdmitted, false)
  const billingRows = description.capabilities.filter(row => row.admitsBilling)
  for (const row of billingRows) {
    assert.notEqual(row.state, 'supported', `${row.id} was upgraded to supported by an override`)
  }
})

test('a null model identity blocks billing even with every row supported', () => {
  const description = describeRuntime({ modelIdentity: { model: null, modelProvider: null, observedFrom: 'thread/start' } })
  assert.equal(description.billableAdmitted, false)
  assert.match(description.billingReasons.join(' '), /model\/provider values are missing/)
})

test('a model identity without provenance is not treated as measured', () => {
  const description = describeRuntime({ modelIdentity: { model: 'gpt-6.1-sol', modelProvider: 'OpenAI' } })
  assert.equal(description.billableAdmitted, false)
  assert.match(description.billingReasons.join(' '), /carry no provenance/)
})

test('a downgrade override is still honoured', () => {
  // Reporting a capability as worse than observed must work, or a consumer cannot record a regression.
  const description = describeRuntime({ capabilities: { host_isolation: { state: 'absent' } } })
  const host = description.capabilities.find(row => row.id === 'host_isolation')
  assert.equal(host.state, 'absent')
})

test('billing stays unadmitted on this host without a measured model identity', () => {
  const description = describeRuntime()
  assert.equal(description.billableAdmitted, false)
  assert.equal(description.modelIdentity, null)
})
