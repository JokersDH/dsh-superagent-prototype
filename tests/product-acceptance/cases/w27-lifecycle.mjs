import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runCase, LAYERS } from '../lib/status.mjs'
import {
  argvHasExactPath, liveIdentity, privateRoot, readRecord, releaseRoot, retainMaterial, sha256, spawnSleeper,
  startOwned, stopOwned, writeSyntheticRecord,
} from '../lib/packaged-instance.mjs'

/**
 * Wave-27 probe-owned lifecycle controls.
 *
 * Every control is pure: plain Node sleepers in a private temporary root plus a synthetic instance
 * record. No product runtime, packaged bytes or user process is involved, so these run before the
 * live lane and prove the *tool* refuses to over-claim ownership. A refusal keeps a hashed copy of
 * the record as retained material; a sleeper the control deliberately leaves alive is killed through
 * the control's own child handle, never by pid lookup.
 */
const RETAINED = resolve('tests/product-acceptance/reports/wave27/lifecycle')

function retainedFactsID(control, root, reason, extra = {}) {
  mkdirSync(RETAINED, { recursive: true })
  const record = readRecord(root.config)
  const material = retainMaterial(root, reason, { files: ['silent.mjs', 'silent-start.sh'] })
  const payload = { control, reason, at: new Date().toISOString(), root: root.own,
    scope: { install: root.install, state: root.state, config: root.config },
    record: record.present ? { path: record.path, sha256: record.sha256, bytes: record.bytes, value: record.value ?? null } : { present: false },
    material, extra }
  const path = join(RETAINED, `${control}.json`)
  writeFileSync(path, JSON.stringify(payload, null, 2) + '\n')
  return { path: path.replace(`${process.cwd()}/`, ''), sha256: sha256(readFileSync(path)), bytes: readFileSync(path).byteLength, reason }
}

const recordFor = (root, { pid, start, apiPid = pid, apiStart = start, consolePid, consoleStart, state = root.state, install = root.install }) => ({
  protocol: 'pa-instance/1', pid, processStart: start,
  apiPid, apiProcessStart: apiStart,
  ...(consolePid === undefined ? {} : { consolePid, consoleProcessStart: consoleStart }),
  state, install, apiURL: 'http://127.0.0.1:1', consoleURL: 'http://127.0.0.1:2',
  buildId: 'probe', mode: 'personal', access: 'local-development', startupMode: 'normal',
})

const birthFor = (root, sleeper) => ({ pid: sleeper.pid, start: sleeper.start, uid: sleeper.uid,
  state: root.state, config: root.config, install: root.install })

const define = (id, title) => ({ id, title, layer: LAYERS.READONLY, limitations: [
  'Pure control: a plain Node sleeper and a synthetic instance record in a private temporary root; no product runtime, packaged bytes or user process is involved.',
  'It proves the acceptance tool\'s ownership and cleanup behaviour only, never product behaviour or a product stop boundary.',
] })

export async function runLifecycle() {
  const cases = []

  cases.push(await runCase({ ...define('E1-LIFECYCLE-OWN', 'A probe-owned sleeper with matching start/uid/exact argv is stopped and released'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = privateRoot('pa-e-life-own-')
      const sleeper = spawnSleeper(root)
      let stopped, released
      try {
        const identity = liveIdentity(sleeper.pid)
        writeSyntheticRecord(root, recordFor(root, { pid: sleeper.pid, start: identity.start }))
        stopped = await stopOwned(root, { packageStop: false, proofSignal: true, birth: birthFor(root, { pid: sleeper.pid, start: identity.start, uid: identity.uid }) })
        released = releaseRoot(root, stopped)
        evidence.lifecycleOwn = { birth: { pid: sleeper.pid, start: identity.start, uid: identity.uid,
          argvExact: argvHasExactPath(identity.command, root.install) && argvHasExactPath(identity.command, root.state) },
          signals: stopped.signals, aliveAfter: stopped.aliveAfter ?? [], clean: stopped.clean, released, rootAfter: existsSync(root.own) }
      } finally { try { sleeper.child.kill('SIGKILL') } catch { /* gone */ } }
      assert('OWN_STOPPED', stopped?.clean === true && (stopped.aliveAfter ?? []).length === 0, JSON.stringify(stopped?.signals))
      assert('OWN_TERM_SUFFICIENT', (stopped?.signals ?? []).length > 0 && stopped.signals.every(item => item.signalled === 'SIGTERM'), JSON.stringify(stopped?.signals))
      assert('OWN_RELEASED', released?.removed === true && existsSync(root.own) === false, JSON.stringify(released))
    }))

  cases.push(await runCase({ ...define('E1-LIFECYCLE-WRONG-START', 'A recorded start identity that does not match the live process refuses every signal and retains the record'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = privateRoot('pa-e-life-start-')
      const sleeper = spawnSleeper(root)
      let stopped, retained, alive
      try {
        writeSyntheticRecord(root, recordFor(root, { pid: sleeper.pid, start: 'Wed Jan  1 00:00:00 2020' }))
        stopped = await stopOwned(root, { packageStop: false, proofSignal: true })
        retained = retainedFactsID('wrongstart', root, stopped.reason ?? 'unknown')
        alive = liveIdentity(sleeper.pid)
        evidence.lifecycleWrongStart = { reason: stopped.reason, gaps: stopped.gaps ?? [], signals: stopped.signals,
          alive: alive.alive, retained: { path: retained.path, sha256: retained.sha256, reason: retained.reason } }
      } finally { try { sleeper.child.kill('SIGKILL') } catch { /* gone */ } rmSync(root.own, { recursive: true, force: true }) }
      assert('WRONGSTART_REFUSED', stopped?.retained === true && stopped.reason === 'unknown_live_resource', JSON.stringify(stopped?.gaps))
      assert('WRONGSTART_NO_SIGNAL', (stopped?.signals ?? []).length === 0, JSON.stringify(stopped?.signals))
      assert('WRONGSTART_PROCESS_ALIVE', alive?.alive === true, JSON.stringify(alive))
      assert('WRONGSTART_RETAINED', retained?.sha256?.length === 64 && retained.bytes > 0, JSON.stringify(retained))
    }))

  cases.push(await runCase({ ...define('E1-LIFECYCLE-SIBLING', 'A sibling root and a substring-only argv match are refused before any signal'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = privateRoot('pa-e-life-sib-')
      const sibling = `${root.state}-sibling`
      mkdirSync(sibling, { recursive: true })
      const sleeper = spawnSleeper(root)
      let stopped, identity, alive
      try {
        identity = liveIdentity(sleeper.pid)
        writeSyntheticRecord(root, recordFor(root, { pid: sleeper.pid, start: identity.start }))
        stopped = await stopOwned({ install: root.install, config: root.config, state: sibling, own: root.own }, { packageStop: false, proofSignal: true })
        alive = liveIdentity(sleeper.pid)
        evidence.lifecycleSibling = { scope: stopped.scope ?? null, reason: stopped.reason, signals: stopped.signals,
          substringMatch: argvHasExactPath(identity.command, sibling), exactMatch: argvHasExactPath(identity.command, root.state), alive }
      } finally { try { sleeper.child.kill('SIGKILL') } catch { /* gone */ } rmSync(root.own, { recursive: true, force: true }); rmSync(sibling, { recursive: true, force: true }) }
      assert('SIBLING_REQUEST_REFUSED', stopped?.retained === true && stopped.reason === 'requested_root_mismatch', JSON.stringify(stopped?.scope))
      assert('SIBLING_NO_SIGNAL', (stopped?.signals ?? []).length === 0, JSON.stringify(stopped?.signals))
      assert('SIBLING_SUBSTRING_NOT_PROOF', argvHasExactPath(identity?.command, sibling) === false, String(identity?.command))
      assert('SIBLING_PROCESS_ALIVE', alive?.alive === true, JSON.stringify(alive))
    }))

  cases.push(await runCase({ ...define('E1-LIFECYCLE-FOREIGN-CHILD', 'A same-UID child whose exact argv names another root is not signalled'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = privateRoot('pa-e-life-foreign-')
      const other = privateRoot('pa-e-life-other-')
      const sleeper = spawnSleeper(root)
      const foreign = spawnSleeper(other, { name: 'foreign' })
      let stopped, foreignAlive
      try {
        const foreignIdentity = liveIdentity(foreign.pid)
        writeSyntheticRecord(root, recordFor(root, { pid: foreign.pid, start: foreignIdentity.start }))
        stopped = await stopOwned(root, { packageStop: false, proofSignal: true,
          birth: { pid: foreign.pid, start: foreignIdentity.start, uid: foreignIdentity.uid, state: other.state, config: other.config, install: other.install } })
        foreignAlive = liveIdentity(foreign.pid)
        evidence.lifecycleForeignChild = { sameUid: foreignIdentity.uid === liveIdentity(sleeper.pid).uid, reason: stopped.reason, blocked: stopped.blocked ?? null,
          signalled: stopped.signals?.[0]?.signalled ?? null, foreignAlive,
          foreignArgvExactForRequestedRoot: argvHasExactPath(foreignIdentity.command, root.state), command: foreignIdentity.command }
      } finally { try { sleeper.child.kill('SIGKILL') } catch { /* gone */ } try { foreign.child.kill('SIGKILL') } catch { /* gone */ }
        rmSync(root.own, { recursive: true, force: true }); rmSync(other.own, { recursive: true, force: true }) }
      assert('FOREIGN_SAME_UID', evidence.lifecycleForeignChild?.sameUid === true, String(evidence.lifecycleForeignChild?.sameUid))
      assert('FOREIGN_ARGV_NOT_EXACT', evidence.lifecycleForeignChild?.foreignArgvExactForRequestedRoot === false, String(evidence.lifecycleForeignChild?.command))
      assert('FOREIGN_REFUSED', stopped?.retained === true && (stopped.reason === 'resource_scope_mismatch' || stopped.reason === 'fresh_identity_changed'), JSON.stringify({ reason: stopped?.reason, blocked: stopped?.blocked }))
      assert('FOREIGN_ALIVE', foreignAlive?.alive === true, JSON.stringify(foreignAlive))
    }))

  cases.push(await runCase({ ...define('E1-LIFECYCLE-MIXED-UNKNOWN', 'One known and one unknown recorded pid refuse the whole set, including the console upgrade path'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = privateRoot('pa-e-life-mixed-')
      const sleeper = spawnSleeper(root)
      const consoleSleeper = spawnSleeper(root, { name: 'console' })
      let stopped, alive, recordPresent
      try {
        const identity = liveIdentity(sleeper.pid)
        writeSyntheticRecord(root, recordFor(root, { pid: sleeper.pid, start: identity.start, consolePid: consoleSleeper.pid, consoleStart: '' }))
        stopped = await stopOwned(root, { packageStop: false, proofSignal: true })
        alive = [liveIdentity(sleeper.pid), liveIdentity(consoleSleeper.pid)].map(item => item.alive)
        recordPresent = readRecord(root.config).present
        evidence.lifecycleMixedUnknown = { gaps: stopped.gaps ?? [], reason: stopped.reason, signals: stopped.signals, alive, recordPresent }
      } finally { try { sleeper.child.kill('SIGKILL') } catch { /* gone */ } try { consoleSleeper.child.kill('SIGKILL') } catch { /* gone */ }
        rmSync(root.own, { recursive: true, force: true }) }
      assert('MIXED_REFUSED', stopped?.retained === true && stopped.reason === 'unknown_live_resource', JSON.stringify(stopped?.gaps))
      assert('MIXED_CONSOLE_GAP', (stopped?.gaps ?? []).some(item => item.label === 'console'), JSON.stringify(stopped?.gaps))
      assert('MIXED_NO_SIGNAL', (stopped?.signals ?? []).length === 0, JSON.stringify(stopped?.signals))
      assert('MIXED_ALL_ALIVE', alive?.every(Boolean) === true, JSON.stringify(alive))
      assert('MIXED_RECORD_KEPT', recordPresent === true, 'record was deleted')
    }))

  cases.push(await runCase({ ...define('E1-LIFECYCLE-START-WINDOW', 'A start that never reports RUNNING retains birth facts and its private root, and is only cleaned by proven stop'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = privateRoot('pa-e-life-window-')
      const script = join(root.own, 'silent.mjs')
      writeFileSync(script, 'setInterval(() => {}, 1000)\n')
      const fakeBin = join(root.own, 'silent-start.sh')
      writeFileSync(fakeBin, `#!/bin/sh\nexec "${process.execPath}" "${script}" --install "${root.install}" --state "${root.state}"\n`, { mode: 0o755 })
      const started = startOwned(root, { ports: [0, 0], bin: fakeBin, timeoutMs: 1500 })
      const value = await started.value
      const birth = started.birth
      let fresh, freshExact, stopped, released, beforeStop
      try {
        // Wait (bounded) for the shell's exec so the recorded identity names the exact roots.
        for (let attempt = 0; attempt < 30; attempt += 1) {
          const probe = liveIdentity(birth.pid)
          if (argvHasExactPath(probe.command ?? '', root.state) || !probe.alive) break
          await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
        }
        fresh = liveIdentity(birth.pid)
        freshExact = argvHasExactPath(fresh.command, root.install) && argvHasExactPath(fresh.command, root.state)
        writeSyntheticRecord(root, recordFor(root, { pid: birth.pid, start: fresh.start }))
        beforeStop = { rootExists: existsSync(root.own), record: readRecord(root.config).present }
        stopped = await stopOwned(root, { packageStop: false, proofSignal: true,
          birth: { pid: birth.pid, start: fresh.start, uid: fresh.uid, state: root.state, config: root.config, install: root.install } })
        released = releaseRoot(root, stopped)
        evidence.lifecycleStartWindow = { status: value.status, birth: { pid: birth.pid, start: birth.start, uid: birth.uid, recordedAt: birth.recordedAt },
          fresh: { start: fresh.start, uid: fresh.uid, command: fresh.command, argvExact: freshExact },
          beforeStop, reason: stopped.reason ?? null, clean: stopped.clean, signals: stopped.signals, released }
      } finally { try { started.child.kill('SIGKILL') } catch { /* gone */ } rmSync(root.own, { recursive: true, force: true }) }
      assert('WINDOW_TIMEOUT', value.status === 'TIMEOUT', value.status)
      assert('WINDOW_BIRTH_NONEMPTY', Number.isSafeInteger(birth.pid) && typeof birth.start === 'string' && birth.start.length > 0, JSON.stringify(birth))
      assert('WINDOW_ROOT_RETAINED', beforeStop?.rootExists === true && beforeStop?.record === true, JSON.stringify(beforeStop))
      assert('WINDOW_FRESH_EXACT', freshExact === true, String(fresh?.command))
      assert('WINDOW_CLEANED_BY_PROOF_ONLY', stopped?.clean === true && released?.removed === true, JSON.stringify({ signals: stopped?.signals, released }))
      assert('WINDOW_CHILD_EXITED', liveIdentity(birth.pid).alive === false, JSON.stringify(liveIdentity(birth.pid)))
    }))

  cases.push(await runCase({ ...define('E1-LIFECYCLE-REFUSED-STOP', 'A packaged stop that refuses leaves the process, the record and the root untouched'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = privateRoot('pa-e-life-refused-')
      const sleeper = spawnSleeper(root)
      let stopped, retained, alive
      try {
        const identity = liveIdentity(sleeper.pid)
        writeSyntheticRecord(root, recordFor(root, { pid: sleeper.pid, start: identity.start }))
        mkdirSync(join(root.install, 'bin'), { recursive: true })
        const fakePa = join(root.install, 'bin/pa')
        writeFileSync(fakePa, '#!/bin/sh\nprintf \'%s\\n\' \'{"status":"BLOCKED","code":"unknown_live_resource"}\'\nexit 2\n', { mode: 0o755 })
        stopped = await stopOwned(root, { packageStop: true, proofSignal: false })
        retained = retainedFactsID('refused-stop', root, stopped.reason ?? 'stop_refused')
        alive = liveIdentity(sleeper.pid)
        evidence.lifecycleRefusedStop = { package: stopped.packageStop, reason: stopped.reason, signals: stopped.signals, alive,
          retained: { path: retained.path, sha256: retained.sha256, reason: retained.reason } }
      } finally { try { sleeper.child.kill('SIGKILL') } catch { /* gone */ } rmSync(root.own, { recursive: true, force: true }) }
      assert('REFUSED_PACKAGE_STATUS', stopped?.packageStop?.json?.status === 'BLOCKED' && stopped.packageStop.status !== 0, JSON.stringify(stopped?.packageStop))
      assert('REFUSED_NO_FALLBACK_SIGNAL', (stopped?.signals ?? []).length === 0 && stopped?.retained === true && stopped?.reason === 'package_stop_refused', JSON.stringify(stopped?.signals))
      assert('REFUSED_PROCESS_ALIVE', alive?.alive === true, JSON.stringify(alive))
      assert('REFUSED_RETAINED_MATERIAL', retained?.sha256?.length === 64 && retained.bytes > 0, JSON.stringify(retained))
    }))

  cases.push(await runCase({ ...define('E1-LIFECYCLE-IDEMPOTENT', 'A second stop of the same root is a no-op and never removes unproven material'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = privateRoot('pa-e-life-idem-')
      const sleeper = spawnSleeper(root)
      let first, second, released
      try {
        const identity = liveIdentity(sleeper.pid)
        writeSyntheticRecord(root, recordFor(root, { pid: sleeper.pid, start: identity.start }))
        const birthRecord = birthFor(root, { pid: sleeper.pid, start: identity.start, uid: identity.uid })
        first = await stopOwned(root, { packageStop: false, proofSignal: true, birth: birthRecord,
          resources: [{ pid: sleeper.pid, start: identity.start, parentPid: null }] })
        // A repeat with nothing registered to stop is a no-op; it does not claim an unobserved set.
        second = await stopOwned(root, { packageStop: false, proofSignal: false })
        released = releaseRoot(root, first)
        evidence.lifecycleIdempotent = { first: { clean: first.clean, signals: first.signals },
          second: { clean: second.clean, signalled: (second.signals ?? []).length }, released, rootAfter: existsSync(root.own) }
      } finally { try { sleeper.child.kill('SIGKILL') } catch { /* gone */ } rmSync(root.own, { recursive: true, force: true }) }
      assert('IDEMPOTENT_FIRST_CLEAN', first?.clean === true, JSON.stringify(first?.signals))
      assert('IDEMPOTENT_SECOND_NOOP', second?.clean === true && (second.signals ?? []).length === 0, JSON.stringify(second?.signals))
      assert('IDEMPOTENT_RELEASE', released?.removed === true, JSON.stringify(released))
    }))

  cases.push(await runCase({ ...define('E1-LIFECYCLE-BIRTH-ROOT', 'A record that self-claims another state than the process birth refuses every signal'), evidence: {} },
    async ({ assert, evidence }) => {
      const rootA = privateRoot('pa-e-life-birthA-')
      const rootB = privateRoot('pa-e-life-birthB-')
      const sleeper = spawnSleeper(rootA)
      let stopped, alive, recordPresent
      try {
        const identity = liveIdentity(sleeper.pid)
        // The record claims rootB while the birth facts and argv are rootA.
        writeSyntheticRecord(rootB, recordFor(rootB, { pid: sleeper.pid, start: identity.start, state: rootB.state, install: rootB.install }))
        stopped = await stopOwned({ ...rootB }, { packageStop: false, proofSignal: true,
          birth: { pid: sleeper.pid, start: identity.start, uid: identity.uid, state: rootA.state, config: rootA.config, install: rootA.install } })
        alive = liveIdentity(sleeper.pid)
        recordPresent = readRecord(rootB.config).present
        evidence.lifecycleBirthRoot = { reason: stopped.reason, blocked: stopped.blocked ?? null, signals: stopped.signals,
          alive: alive.alive, recordPresent, birthState: rootA.state, requestedState: rootB.state }
      } finally { try { sleeper.child.kill('SIGKILL') } catch { /* gone */ }
        rmSync(rootA.own, { recursive: true, force: true }); rmSync(rootB.own, { recursive: true, force: true }) }
      assert('BIRTH_ROOT_REFUSED', stopped?.retained === true && stopped.reason === 'resource_scope_mismatch', JSON.stringify({ reason: stopped?.reason, blocked: stopped?.blocked }))
      assert('BIRTH_ROOT_BLOCKED_LAUNCHER', stopped?.blocked?.label === 'launcher' && stopped?.blocked?.birthOk === false, JSON.stringify(stopped?.blocked))
      assert('BIRTH_ROOT_NO_SIGNAL', (stopped?.signals ?? []).length === 0, JSON.stringify(stopped?.signals))
      assert('BIRTH_ROOT_ALIVE', alive?.alive === true, JSON.stringify(alive))
      assert('BIRTH_ROOT_RECORD_KEPT', recordPresent === true, 'record was deleted')
    }))

  cases.push(await runCase({ ...define('E1-LIFECYCLE-CHILD-SCOPE', 'A wrong-root coordinator child blocks the whole set before the launcher is signalled'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = privateRoot('pa-e-life-child-')
      const other = privateRoot('pa-e-life-childother-')
      const launcher = spawnSleeper(root)
      const child = spawnSleeper(other, { name: 'api' })
      let stopped, alive, recordPresent
      try {
        const l = liveIdentity(launcher.pid)
        const c = liveIdentity(child.pid)
        writeSyntheticRecord(root, recordFor(root, { pid: launcher.pid, start: l.start, apiPid: child.pid, apiStart: c.start }))
        stopped = await stopOwned(root, { packageStop: false, proofSignal: true,
          birth: { pid: launcher.pid, start: l.start, uid: l.uid, state: root.state, config: root.config, install: root.install } })
        alive = [liveIdentity(launcher.pid).alive, liveIdentity(child.pid).alive]
        recordPresent = readRecord(root.config).present
        evidence.lifecycleChildScope = { reason: stopped.reason, blocked: stopped.blocked ?? null, signals: stopped.signals, alive, recordPresent,
          childState: other.state, requestedState: root.state }
      } finally { try { launcher.child.kill('SIGKILL') } catch { /* gone */ } try { child.child.kill('SIGKILL') } catch { /* gone */ }
        rmSync(root.own, { recursive: true, force: true }); rmSync(other.own, { recursive: true, force: true }) }
      assert('CHILD_SCOPE_REFUSED', stopped?.retained === true && stopped.reason === 'resource_scope_mismatch', JSON.stringify({ reason: stopped?.reason, blocked: stopped?.blocked }))
      assert('CHILD_SCOPE_BLOCKED_API', stopped?.blocked?.label === 'api' && stopped?.blocked?.stateOk === false, JSON.stringify(stopped?.blocked))
      assert('CHILD_SCOPE_NO_SIGNAL', (stopped?.signals ?? []).length === 0, JSON.stringify(stopped?.signals))
      assert('CHILD_SCOPE_ALL_ALIVE', alive?.every(Boolean) === true, JSON.stringify(alive))
      assert('CHILD_SCOPE_RECORD_KEPT', recordPresent === true, 'record was deleted')
    }))

  cases.push(await runCase({ ...define('E1-LIFECYCLE-NO-RECORD-BIRTH', 'A known birth without any instance record is not clean: it is retained and only a verified birth proof stops it'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = privateRoot('pa-e-life-norec-')
      const sleeper = spawnSleeper(root)
      let refused, stopped, released
      try {
        const identity = liveIdentity(sleeper.pid)
        const birth = { pid: sleeper.pid, start: identity.start, uid: identity.uid, state: root.state, config: root.config, install: root.install }
        refused = await stopOwned(root, { packageStop: false, proofSignal: false, birth })
        released = releaseRoot(root, refused)
        const aliveAfterRefusal = liveIdentity(sleeper.pid).alive
        const resources = [{ pid: birth.pid, start: birth.start, parentPid: null }]
        stopped = await stopOwned(root, { packageStop: false, proofSignal: true, birth, resources })
        evidence.lifecycleNoRecord = { refused: { clean: refused.clean, reason: refused.reason, retained: refused.retained },
          released: released.removed, aliveAfterRefusal,
          stopped: { clean: stopped.clean, source: stopped.source, signals: stopped.signals, aliveAfter: stopped.aliveAfter ?? [] } }
      } finally { try { sleeper.child.kill('SIGKILL') } catch { /* gone */ } rmSync(root.own, { recursive: true, force: true }) }
      assert('NOREC_REFUSED_CLEAN', refused?.clean !== true && refused?.retained === true && refused.reason === 'record_missing_known_birth', JSON.stringify(refused))
      assert('NOREC_NOT_RELEASED', released?.removed === false && evidence.lifecycleNoRecord.aliveAfterRefusal === true, JSON.stringify(released))
      assert('NOREC_BIRTH_PROOF_CLEAN', stopped?.clean === true && stopped.source === 'known_set' && (stopped.signals ?? []).length > 0 &&
        (stopped.signals ?? []).every(item => item.signalled === 'SIGTERM'), JSON.stringify(stopped?.signals))
    }))

  cases.push(await runCase({ ...define('E1-LIFECYCLE-NO-RECORD-EXIT', 'A known birth that already exited with no children is a legitimate exit, not an unknown resource'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = privateRoot('pa-e-life-noexit-')
      const sleeper = spawnSleeper(root)
      let stopped
      try {
        const identity = liveIdentity(sleeper.pid)
        const birth = { pid: sleeper.pid, start: identity.start, uid: identity.uid, state: root.state, config: root.config, install: root.install }
        sleeper.child.kill('SIGKILL')
        for (let attempt = 0; attempt < 40 && liveIdentity(sleeper.pid).alive; attempt += 1) await new Promise(r => setTimeout(r, 50))
        const resources = [{ pid: birth.pid, start: birth.start, parentPid: null }]
        stopped = await stopOwned(root, { packageStop: false, proofSignal: true, birth, resources })
        evidence.lifecycleNoRecordExit = { clean: stopped.clean, reason: stopped.reason ?? null, legitimateExit: stopped.legitimateExit ?? null,
          signals: stopped.signals, resources: stopped.resources ?? null }
      } finally { rmSync(root.own, { recursive: true, force: true }) }
      assert('NOEXIT_CLEAN', stopped?.clean === true && stopped.legitimateExit === true, JSON.stringify(stopped))
      assert('NOEXIT_NO_SIGNAL', (stopped?.signals ?? []).length === 0, JSON.stringify(stopped?.signals))
      assert('NOEXIT_SET_OBSERVED', Array.isArray(stopped?.resources) && stopped.resources.length === 1, JSON.stringify(stopped?.resources))
    }))

  cases.push(await runCase({ ...define('E1-LIFECYCLE-NO-RECORD-REUSE', 'A birth whose pid was reused by another process is retained without a signal'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = privateRoot('pa-e-life-noreuse-')
      const sleeper = spawnSleeper(root)
      let stopped
      try {
        const identity = liveIdentity(sleeper.pid)
        const birth = { pid: sleeper.pid, start: 'Wed Jan  1 00:00:00 2020', uid: identity.uid, state: root.state, config: root.config, install: root.install }
        const resources = [{ pid: birth.pid, start: birth.start, parentPid: null }]
        stopped = await stopOwned(root, { packageStop: false, proofSignal: true, birth, resources })
        evidence.lifecycleNoRecordReuse = { clean: stopped.clean, reason: stopped.reason, signals: stopped.signals,
          birthAlive: stopped.birthAlive ?? null, alive: liveIdentity(sleeper.pid).alive }
      } finally { try { sleeper.child.kill('SIGKILL') } catch { /* gone */ } rmSync(root.own, { recursive: true, force: true }) }
      assert('NOREUSE_REFUSED', stopped?.clean !== true && stopped?.retained === true && stopped.reason === 'birth_identity_mismatch', JSON.stringify(stopped))
      assert('NOREUSE_NO_SIGNAL', (stopped?.signals ?? []).length === 0, JSON.stringify(stopped?.signals))
      assert('NOREUSE_ALIVE', evidence.lifecycleNoRecordReuse.alive === true, JSON.stringify(stopped?.birthAlive))
    }))

  cases.push(await runCase({ ...define('E1-LIFECYCLE-STOP-NO-RECORD', 'A packaged STOPPED that saw no record does not release a known live birth'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = privateRoot('pa-e-life-stopnorec-')
      const sleeper = spawnSleeper(root)
      let stopped
      try {
        const identity = liveIdentity(sleeper.pid)
        const birth = { pid: sleeper.pid, start: identity.start, uid: identity.uid, state: root.state, config: root.config, install: root.install }
        mkdirSync(join(root.install, 'bin'), { recursive: true })
        writeFileSync(join(root.install, 'bin/pa'), '#!/bin/sh\nprintf \'%s\\n\' \'{"status":"STOPPED"}\'\nexit 0\n', { mode: 0o755 })
        const resources = [{ pid: birth.pid, start: birth.start, parentPid: null }]
        stopped = await stopOwned(root, { birth, resources, packageStop: true, equivalentProof: true })
        evidence.lifecycleStopNoRecord = { clean: stopped.clean, reason: stopped.reason ?? null, sawNoRecord: stopped.packageStopSawNoRecord ?? null,
          signals: stopped.signals, source: stopped.source ?? null, alive: liveIdentity(sleeper.pid).alive }
      } finally { try { sleeper.child.kill('SIGKILL') } catch { /* gone */ } rmSync(root.own, { recursive: true, force: true }) }
      assert('STOPNOREC_NOT_ACCEPTED', evidence.lifecycleStopNoRecord.sawNoRecord === true && stopped?.source === 'known_set', JSON.stringify(stopped))
      assert('STOPNOREC_CLEAN_WITH_PROOF', stopped?.clean === true && (stopped.signals ?? []).length > 0, JSON.stringify(stopped?.signals))
      assert('STOPNOREC_ALIVE_BEFORE_PROOF', evidence.lifecycleStopNoRecord.alive === false, 'process should be gone after the verified proof')
    }))

  cases.push(await runCase({ ...define('E1-LIFECYCLE-NO-RECORD-UNVERIFIED', 'A forced no-record proof without a complete immutable resource set is retained, not cleaned'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = privateRoot('pa-e-life-nounverified-')
      const sleeper = spawnSleeper(root)
      let stopped, released
      try {
        const identity = liveIdentity(sleeper.pid)
        const birth = { pid: sleeper.pid, start: identity.start, uid: identity.uid, state: root.state, config: root.config, install: root.install }
        stopped = await stopOwned(root, { packageStop: false, proofSignal: true, birth, resources: null })
        released = releaseRoot(root, stopped)
        evidence.lifecycleNoRecordUnverified = { clean: stopped.clean, reason: stopped.reason, retained: stopped.retained,
          signals: stopped.signals, released: released.removed, alive: liveIdentity(sleeper.pid).alive }
      } finally { try { sleeper.child.kill('SIGKILL') } catch { /* gone */ } rmSync(root.own, { recursive: true, force: true }) }
      assert('NOUNV_REFUSED', stopped?.clean !== true && stopped?.retained === true && stopped.reason === 'resources_unverified', JSON.stringify(stopped))
      assert('NOUNV_NO_SIGNAL', (stopped?.signals ?? []).length === 0, JSON.stringify(stopped?.signals))
      assert('NOUNV_NOT_RELEASED', released?.removed === false && evidence.lifecycleNoRecordUnverified.alive === true, JSON.stringify(released))
    }))

  cases.push(await runCase({ ...define('E1-LIFECYCLE-SET-MISMATCH', 'A resource set with a wrong start, uid or parent is refused before any signal'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = privateRoot('pa-e-life-setmismatch-')
      const sleeper = spawnSleeper(root)
      const child = spawnSleeper(root, { name: 'api' })
      let stopped
      try {
        const identity = liveIdentity(sleeper.pid)
        const childIdentity = liveIdentity(child.pid)
        const birth = { pid: sleeper.pid, start: identity.start, uid: identity.uid, state: root.state, config: root.config, install: root.install }
        // The child's recorded start and parent are wrong: the set is not the spawn's own.
        const resources = [{ pid: sleeper.pid, start: identity.start, parentPid: null },
          { pid: child.pid, start: 'Wed Jan  1 00:00:00 2020', parentPid: 999999 }]
        stopped = await stopOwned(root, { packageStop: false, proofSignal: true, birth, resources })
        evidence.lifecycleSetMismatch = { reason: stopped.reason, blocked: stopped.blocked ?? null, signals: stopped.signals,
          alive: [liveIdentity(sleeper.pid).alive, liveIdentity(child.pid).alive], childStart: childIdentity.start }
      } finally { try { sleeper.child.kill('SIGKILL') } catch { /* gone */ } try { child.child.kill('SIGKILL') } catch { /* gone */ }
        rmSync(root.own, { recursive: true, force: true }) }
      assert('SETMISMATCH_REFUSED', stopped?.retained === true && stopped.reason === 'resource_scope_mismatch', JSON.stringify(stopped?.blocked))
      assert('SETMISMATCH_NO_SIGNAL', (stopped?.signals ?? []).length === 0, JSON.stringify(stopped?.signals))
      assert('SETMISMATCH_ALL_ALIVE', evidence.lifecycleSetMismatch.alive.every(Boolean), JSON.stringify(evidence.lifecycleSetMismatch.alive))
    }))

  cases.push(await runCase({ ...define('E1-LIFECYCLE-BIRTH-CONFIG', 'A birth from another config cannot authorize cleanup of the requested root'), evidence: {} },
    async ({ assert, evidence }) => {
      const rootA = privateRoot('pa-e-life-cfgA-')
      const rootB = privateRoot('pa-e-life-cfgB-')
      const sleeper = spawnSleeper(rootA)
      let stopped
      try {
        const identity = liveIdentity(sleeper.pid)
        const birth = { pid: sleeper.pid, start: identity.start, uid: identity.uid, state: rootA.state, config: rootA.config, install: rootA.install }
        const resources = [{ pid: sleeper.pid, start: identity.start, parentPid: null }]
        stopped = await stopOwned(rootB, { packageStop: false, proofSignal: true, birth, resources })
        evidence.lifecycleBirthConfig = { reason: stopped.reason, signals: stopped.signals, alive: liveIdentity(sleeper.pid).alive,
          birthConfig: rootA.config, requestedConfig: rootB.config }
      } finally { try { sleeper.child.kill('SIGKILL') } catch { /* gone */ } rmSync(rootA.own, { recursive: true, force: true }); rmSync(rootB.own, { recursive: true, force: true }) }
      assert('BIRTHCFG_REFUSED', stopped?.retained === true && stopped.reason === 'birth_set_mismatch', JSON.stringify(stopped))
      assert('BIRTHCFG_NO_SIGNAL', (stopped?.signals ?? []).length === 0, JSON.stringify(stopped?.signals))
      assert('BIRTHCFG_ALIVE', evidence.lifecycleBirthConfig.alive === true, JSON.stringify(evidence.lifecycleBirthConfig))
    }))

  /** Spawns a sleeper, kills it and returns its now-dead pid/start (a legitimate "already exited" id). */
  const deadPid = async root => {
    const sleeper = spawnSleeper(root, { name: `dead-${Date.now()}` })
    const identity = liveIdentity(sleeper.pid)
    sleeper.child.kill('SIGKILL')
    for (let attempt = 0; attempt < 60 && liveIdentity(sleeper.pid).alive; attempt += 1) await new Promise(r => setTimeout(r, 50))
    return { pid: sleeper.pid, start: identity.start }
  }

  cases.push(await runCase({ ...define('E1-LIFECYCLE-STOPPED-KNOWN-CHILD', 'A packaged STOPPED that leaves a known live child is not clean until that child is verified and stopped'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = privateRoot('pa-e-life-stoppedchild-')
      const child = spawnSleeper(root, { name: 'api' })
      let refused, released, proven
      try {
        const dead = await deadPid(root)
        const childIdentity = liveIdentity(child.pid)
        // The record names a dead launcher and a live api child, so the pre-stop set has one survivor.
        writeSyntheticRecord(root, recordFor(root, { pid: dead.pid, start: dead.start, apiPid: child.pid, apiStart: childIdentity.start }))
        mkdirSync(join(root.install, 'bin'), { recursive: true })
        writeFileSync(join(root.install, 'bin/pa'), '#!/bin/sh\nprintf \'%s\\n\' \'{"status":"STOPPED"}\'\nexit 0\n', { mode: 0o755 })
        refused = await stopOwned(root, { packageStop: true, equivalentProof: false })
        released = releaseRoot(root, refused)
        const childAlive = liveIdentity(child.pid).alive
        proven = await stopOwned(root, { packageStop: false, proofSignal: true,
          birth: { pid: dead.pid, start: dead.start, uid: childIdentity.uid, state: root.state, config: root.config, install: root.install },
          resources: [{ pid: dead.pid, start: dead.start, parentPid: null },
            { pid: child.pid, start: childIdentity.start, parentPid: dead.pid }] })
        evidence.lifecycleStoppedChild = { packageStatus: refused.packageStop?.json?.status ?? null, reason: refused.reason,
          retained: refused.retained, aliveAfter: refused.aliveAfter ?? [], released: released.removed, childAlive,
          proven: { clean: proven.clean, signals: proven.signals, parentGone: proven.preflight?.find(item => item.pid === child.pid)?.parentGone ?? null } }
      } finally { try { child.child.kill('SIGKILL') } catch { /* gone */ } rmSync(root.own, { recursive: true, force: true }) }
      assert('STOPPED_CHILD_NOT_CLEAN', refused?.clean === false && refused?.retained === true && refused.reason === 'known_resource_alive_after_package_stop',
        JSON.stringify({ reason: refused?.reason, alive: refused?.aliveAfter }))
      assert('STOPPED_CHILD_ALIVE_OBSERVED', evidence.lifecycleStoppedChild.childAlive === true && evidence.lifecycleStoppedChild.aliveAfter.length === 1,
        JSON.stringify(evidence.lifecycleStoppedChild.aliveAfter))
      assert('STOPPED_CHILD_NOT_RELEASED', released?.removed === false, JSON.stringify(released))
      assert('STOPPED_CHILD_PROVEN_STOP', proven?.clean === true && (proven.signals ?? []).some(item => item.pid === child.pid && item.signalled === 'SIGTERM'),
        JSON.stringify(proven?.signals))
    }))

  cases.push(await runCase({ ...define('E1-LIFECYCLE-STOPPED-NO-RECORD-CHILD', 'A STOPPED with no record and an exited parent still cannot ignore a known live child'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = privateRoot('pa-e-life-stoppednorec-')
      const child = spawnSleeper(root, { name: 'api' })
      let stopped, released
      try {
        const dead = await deadPid(root)
        const childIdentity = liveIdentity(child.pid)
        mkdirSync(join(root.install, 'bin'), { recursive: true })
        writeFileSync(join(root.install, 'bin/pa'), '#!/bin/sh\nprintf \'%s\\n\' \'{"status":"STOPPED"}\'\nexit 0\n', { mode: 0o755 })
        stopped = await stopOwned(root, { packageStop: true, equivalentProof: false,
          birth: { pid: dead.pid, start: dead.start, uid: childIdentity.uid, state: root.state, config: root.config, install: root.install },
          resources: [{ pid: dead.pid, start: dead.start, parentPid: null },
            { pid: child.pid, start: childIdentity.start, parentPid: dead.pid }] })
        released = releaseRoot(root, stopped)
        evidence.lifecycleStoppedNoRecordChild = { reason: stopped.reason, retained: stopped.retained, clean: stopped.clean,
          aliveAfter: stopped.aliveAfter ?? [], released: released.removed, childAlive: liveIdentity(child.pid).alive }
      } finally { try { child.child.kill('SIGKILL') } catch { /* gone */ } rmSync(root.own, { recursive: true, force: true }) }
      assert('STOPPED_NOREC_CHILD_REFUSED', stopped?.clean === false && stopped?.retained === true && stopped.reason === 'known_resource_alive_after_package_stop',
        JSON.stringify({ reason: stopped?.reason, alive: stopped?.aliveAfter }))
      assert('STOPPED_NOREC_CHILD_ALIVE', evidence.lifecycleStoppedNoRecordChild.childAlive === true, JSON.stringify(evidence.lifecycleStoppedNoRecordChild))
      assert('STOPPED_NOREC_CHILD_NOT_RELEASED', released?.removed === false, JSON.stringify(released))
    }))

  cases.push(await runCase({ ...define('E1-LIFECYCLE-PARENT-GONE', 'A live child whose recorded parent already exited is still a legitimate known resource'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = privateRoot('pa-e-life-parentgone-')
      const child = spawnSleeper(root, { name: 'api' })
      let stopped
      try {
        const dead = await deadPid(root)
        const childIdentity = liveIdentity(child.pid)
        stopped = await stopOwned(root, { packageStop: false, proofSignal: true,
          birth: { pid: dead.pid, start: dead.start, uid: childIdentity.uid, state: root.state, config: root.config, install: root.install },
          resources: [{ pid: dead.pid, start: dead.start, parentPid: null },
            { pid: child.pid, start: childIdentity.start, parentPid: dead.pid }] })
        evidence.lifecycleParentGone = { clean: stopped.clean, reason: stopped.reason ?? null,
          preflight: stopped.preflight ?? [], signals: stopped.signals, aliveAfter: stopped.aliveAfter ?? [] }
      } finally { try { child.child.kill('SIGKILL') } catch { /* gone */ } rmSync(root.own, { recursive: true, force: true }) }
      const childPreflight = evidence.lifecycleParentGone.preflight.find(item => item.pid === evidence.lifecycleParentGone.signals?.[0]?.pid)
      assert('PARENTGONE_ACCEPTED', stopped?.clean === true && (stopped.signals ?? []).some(item => item.signalled === 'SIGTERM'),
        JSON.stringify({ reason: stopped?.reason, signals: stopped?.signals }))
      assert('PARENTGONE_FLAG', childPreflight?.parentGone === true && childPreflight?.parentOk === true,
        JSON.stringify(childPreflight))
    }))

  cases.push(await runCase({ ...define('E1-LIFECYCLE-BIRTH-NO-SET', 'A known birth without the product record or a caller set is never released by an empty observation'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = privateRoot('pa-e-life-birthnoset-')
      const sleeper = spawnSleeper(root)
      let stopped, released
      try {
        const identity = liveIdentity(sleeper.pid)
        const birth = { pid: sleeper.pid, start: identity.start, uid: identity.uid, state: root.state, config: root.config, install: root.install }
        mkdirSync(join(root.install, 'bin'), { recursive: true })
        writeFileSync(join(root.install, 'bin/pa'), '#!/bin/sh\nprintf \'%s\\n\' \'{"status":"STOPPED"}\'\nexit 0\n', { mode: 0o755 })
        stopped = await stopOwned(root, { birth, packageStop: true, equivalentProof: true })
        released = releaseRoot(root, stopped)
        evidence.lifecycleBirthNoSet = { clean: stopped.clean, reason: stopped.reason, retained: stopped.retained,
          signals: stopped.signals, preStopSet: stopped.preStopSet ?? null, released: released.removed,
          alive: liveIdentity(sleeper.pid).alive }
      } finally { try { sleeper.child.kill('SIGKILL') } catch { /* gone */ } rmSync(root.own, { recursive: true, force: true }) }
      assert('BIRTHNOSET_RETAINED', stopped?.clean !== true && stopped?.retained === true && stopped.reason === 'resources_unverified',
        JSON.stringify({ reason: stopped?.reason, set: stopped?.preStopSet }))
      assert('BIRTHNOSET_NO_SIGNAL', (stopped?.signals ?? []).length === 0, JSON.stringify(stopped?.signals))
      assert('BIRTHNOSET_NOT_RELEASED', released?.removed === false && evidence.lifecycleBirthNoSet.alive === true, JSON.stringify(released))
    }))

  return { cases, artifacts: {} }
}
