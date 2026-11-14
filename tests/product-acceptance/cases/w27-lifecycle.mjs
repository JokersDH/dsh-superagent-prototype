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
        stopped = await stopOwned(root, { packageStop: false, proofSignal: true })
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
        stopped = await stopOwned(root, { packageStop: false, proofSignal: true })
        foreignAlive = liveIdentity(foreign.pid)
        evidence.lifecycleForeignChild = { sameUid: foreignIdentity.uid === liveIdentity(sleeper.pid).uid, reason: stopped.reason,
          signalled: stopped.signals?.[0]?.signalled ?? null, foreignAlive,
          foreignArgvExactForRequestedRoot: argvHasExactPath(foreignIdentity.command, root.state), command: foreignIdentity.command }
      } finally { try { sleeper.child.kill('SIGKILL') } catch { /* gone */ } try { foreign.child.kill('SIGKILL') } catch { /* gone */ }
        rmSync(root.own, { recursive: true, force: true }); rmSync(other.own, { recursive: true, force: true }) }
      assert('FOREIGN_SAME_UID', evidence.lifecycleForeignChild?.sameUid === true, String(evidence.lifecycleForeignChild?.sameUid))
      assert('FOREIGN_ARGV_NOT_EXACT', evidence.lifecycleForeignChild?.foreignArgvExactForRequestedRoot === false, String(evidence.lifecycleForeignChild?.command))
      assert('FOREIGN_REFUSED', stopped?.retained === true && stopped.reason === 'fresh_identity_changed', JSON.stringify(stopped?.signals))
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
        stopped = await stopOwned(root, { packageStop: false, proofSignal: true })
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
        first = await stopOwned(root, { packageStop: false, proofSignal: true })
        second = await stopOwned(root, { packageStop: false, proofSignal: true })
        released = releaseRoot(root, first)
        evidence.lifecycleIdempotent = { first: { clean: first.clean, signals: first.signals },
          second: { clean: second.clean, signalled: (second.signals ?? []).length }, released, rootAfter: existsSync(root.own) }
      } finally { try { sleeper.child.kill('SIGKILL') } catch { /* gone */ } rmSync(root.own, { recursive: true, force: true }) }
      assert('IDEMPOTENT_FIRST_CLEAN', first?.clean === true, JSON.stringify(first?.signals))
      assert('IDEMPOTENT_SECOND_NOOP', second?.clean === true && (second.signals ?? []).length === 0, JSON.stringify(second?.signals))
      assert('IDEMPOTENT_RELEASE', released?.removed === true, JSON.stringify(released))
    }))

  return { cases, artifacts: {} }
}
