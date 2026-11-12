import { Effects } from '@personal-agent/effects'
import type { ProductStore } from '@personal-agent/storage'
import type { ProductExecution } from './execution.ts'
import { ApplicationFault } from '@personal-agent/application'

export type ExecutionConsumer = Pick<ProductExecution, 'effects' | 'verificationBlocked' | 'verificationStatus' | 'retryVerification' | 'nativeFence' | 'start' | 'close'>

/** Only registered discussion handlers run; unregistered business rows retain their exact state. */
export function createDiscussionEffects(store: ProductStore): ExecutionConsumer {
  const effects = new Effects(store.queue)
  let timer: ReturnType<typeof setInterval> | undefined, closed = false
  return {
    effects,
    nativeFence: () => 'unknown',
    verificationBlocked: () => false,
    verificationStatus: work => work.actions.currentVerificationId
      ? { protocol: 'work-verification/1', workId: work.work.id, state: 'finished', verificationId: work.actions.currentVerificationId, retryAvailable: false }
      : { protocol: 'work-verification/1', workId: work.work.id, state: 'not_ready', retryAvailable: false },
    retryVerification: () => { throw new ApplicationFault('unsupported_capability', '开发执行器尚未就绪，验证未重新启动。') },
    start: () => {
      if (closed) throw new Error('A closed discussion consumer cannot start')
      if (timer) return
      effects.start(); timer = setInterval(() => effects.kick(), 50); timer.unref()
    },
    close: async () => { closed = true; if (timer) clearInterval(timer); await effects.drain() },
  }
}
