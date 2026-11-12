/**
 * `pa stop`: signal only a verified instance. If the launcher process is already gone, a recorded
 * API child is signalled only after its command line, uid, private state and listener still match;
 * an unknown process, stale record with a live listener, or stop timeout is reported, not hidden.
 */
import { listenersOnPort, processCommand, readInstanceRecord, processAlive, removeInstanceRecord, stopProcess, verifyCoordinatorProcess, verifyInstance } from './instance.mjs'
import { requestedScopeCheck } from './identity.mjs'

const record_removed_code = 'instance_record_removed'

function removeRecord(configRoot) {
  try {
    removeInstanceRecord(configRoot)
    return true
  } catch {
    return false
  }
}

export async function stopInstance({ roots, timeoutMs = 8000 }) {
  let record
  try {
    record = readInstanceRecord(roots.config)
  } catch (error) {
    return {
      ok: false,
      code: 'invalid_instance_record',
      message: '实例记录不可信，拒绝结束任何进程',
      detail: { cause: error.message, code: error.code },
      hint: '运行 `pa doctor` 核对私有状态；不会按 PID 猜测结束进程。',
    }
  }
  if (record === null) return { ok: true, status: 'STOPPED', detail: { note: 'no managed instance is recorded' } }

  // A record only describes the roots it was written for. A stop aimed at another requested state or
  // install must refuse before touching a pid or deleting the record.
  const scope = requestedScopeCheck({ roots, record, requireInstall: true })
  if (!scope.ok) {
    return {
      ok: false,
      status: 'BLOCKED',
      code: 'requested_root_mismatch',
      message: '请求的私有根与实例记录不一致；不结束任何进程、不删除记录',
      detail: scope,
      hint: '用记录所属的 --config-root/--data-root/--install 调用，或先核对 `pa doctor`。',
    }
  }

  const verification = await verifyInstance(record)
  if (verification.ok) {
    const result = await stopProcess(record.pid, { timeoutMs })
    if (result.stopped) {
      const removed = removeRecord(roots.config)
      return { ok: true, status: 'STOPPED', ...result, verification, instanceRecordRemoved: removed }
    }
    return {
      ok: false,
      status: 'STOP_TIMEOUT',
      code: result.code ?? 'stop_failed',
      message: '停止超时：已发送 SIGTERM，但进程在限期内仍存活',
      detail: { pid: record.pid, stillAlive: result.stillAlive, timeoutMs },
      hint: '如实报告未静止资源；请人工核对后再处理，不要假报已停止。',
    }
  }

  const launcherAlive = await processAlive(record.pid)
  if (!launcherAlive) {
    const orphan = await verifyCoordinatorProcess(record)
    if (orphan.ok) {
      const result = await stopProcess(record.apiPid, { timeoutMs })
      if (result.stopped) {
        const removed = removeRecord(roots.config)
        return { ok: true, status: 'STOPPED_ORPHAN', ...result, verification: orphan, instanceRecordRemoved: removed }
      }
      return {
        ok: false,
        status: 'STOP_TIMEOUT',
        code: result.code ?? 'stop_failed',
        message: 'launcher 已退出，但登记的 API 子进程在限期内仍存活',
        detail: { apiPid: record.apiPid, stillAlive: result.stillAlive },
      }
    }
    const apiAlive = orphan.checks.some((check) => check.id === 'api_alive' && check.ok)
    if (!apiAlive) {
      // A recorded port held by a process that is not one of the recorded pids is an unknown live
      // target: keep the record and the process, and report it instead of collecting a "stale" record.
      const unknownListeners = []
      const foreignPorts = []
      for (const url of [record.apiURL, record.consoleURL]) {
        const port = new URL(url).port
        const listeners = await listenersOnPort(port)
        for (const pid of listeners.pids) {
          if (pid === record.pid || pid === record.apiPid || pid === record.consolePid) continue
          const commandLine = await processCommand(pid)
          // Only a listener that names this record's state/install can be a lost writer for this
          // instance. An unrelated service on a recycled port is recorded, not treated as ours.
          if (commandLine !== null && (commandLine.includes(record.state) || commandLine.includes(record.install)))
            unknownListeners.push({ port, pid, command: commandLine.slice(0, 200) })
          else foreignPorts.push({ port, pid })
        }
      }
      if (unknownListeners.length > 0) {
        return {
          ok: false,
          status: 'UNVERIFIED',
          code: 'unknown_live_resource',
          message: '登记的端口仍由无法归属的进程监听；保留记录，不结束未知进程',
          detail: { unknownListeners: unknownListeners.slice(0, 8) },
          hint: '核对端口与进程来源；不要删除 instance.json 绕过。',
        }
      }
      const removed = removeRecord(roots.config)
      return {
        ok: true,
        status: 'STALE_RECORD_CLEANED',
        ...(foreignPorts.length === 0 ? {} : { foreignPortOccupied: foreignPorts.slice(0, 8) }),
        message: 'launcher 与登记子进程都已退出；清理陈旧实例记录',
        verification: orphan,
        instanceRecordRemoved: removed,
      }
    }
    return {
      ok: false,
      status: 'UNVERIFIED',
      code: 'instance_identity_mismatch',
      message: 'launcher 已退出，登记的子进程无法核对为同一实例；不结束未知进程',
      detail: { failures: orphan.failures, checks: orphan.checks },
    }
  }

  return {
    ok: false,
    status: 'UNVERIFIED',
    code: 'instance_identity_mismatch',
    message: '实例记录与真实进程身份不一致；不结束未知进程',
    detail: { failures: verification.failures, checks: verification.checks },
    hint: '等待进程自行退出，或人工核对后用 `pa doctor` 复查；不按 PID 猜测。',
  }
}
