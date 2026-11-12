import type { ExecutionUnavailableReason } from '@personal-agent/contracts'

export const executionUnavailableLabel: Record<ExecutionUnavailableReason, string> = {
  not_installed: '未安装 Codex',
  incompatible_version: 'Codex 版本尚未通过验证',
  unsupported_platform: '当前平台尚未通过验证',
  probe_failed: 'Codex 检测未完成',
  not_admitted: 'Codex 尚未通过验证',
  operator_disabled: '开发执行已关闭',
  recovery_readonly: '恢复数据只读',
}

export const blockedLabel = (reason?: string): string => {
  if (reason === 'stale_contract') return '项目授权已过期'
  if (reason === 'unsupported_capability') return '执行器不可调度'
  if (reason === 'auth_required') return '需要重新认证'
  if (reason === 'budget_exceeded') return '预算或会话受限'
  return reason ? `暂不可调度（${reason}）` : '暂不可调度'
}
