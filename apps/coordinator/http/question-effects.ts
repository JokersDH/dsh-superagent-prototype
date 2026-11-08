import { z } from 'zod'
import { IdSchema } from '@personal-agent/contracts'
import { Later, UnknownSend } from '@personal-agent/effects'
import type { Effects } from '@personal-agent/effects'
import { ANSWER_EFFECT, DeliveryDeferred, DeliveryUnknown } from '@personal-agent/questions'
import type { AnswerTransport, QuestionBroker } from '@personal-agent/questions'

const EffectSchema = z.strictObject({ answerId: IdSchema, targetBindingId: IdSchema })
export function handleQuestionAnswers(
  effects: Pick<Effects, 'handle'>,
  broker: QuestionBroker,
  transport: AnswerTransport,
): void {
  effects.handle(
    ANSWER_EFFECT,
    async (value) => {
      const input = EffectSchema.parse(value)
      try {
        await broker.deliver(input.answerId, input.targetBindingId, transport)
      } catch (error) {
        if (error instanceof DeliveryUnknown)
          throw new UnknownSend('Answer delivery requires native reconciliation', 'answer_unknown')
        if (error instanceof DeliveryDeferred) throw new Later('Answer is proven not sent')
        throw error
      }
    },
    { limit: () => 2, retry: [2000, 60_000] },
  )
}
