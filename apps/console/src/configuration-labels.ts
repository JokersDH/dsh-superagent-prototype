export const blockedLabel = (reason?: string): string => {
  if (reason === 'stale_contract') return '项目授权已过期'
  if (reason === 'unsupported_capability') return '执行器不可调度'
  if (reason === 'auth_required') return '需要重新认证'
  if (reason === 'budget_exceeded') return '预算或会话受限'
  return reason ? `暂不可调度（${reason}）` : '暂不可调度'
}
