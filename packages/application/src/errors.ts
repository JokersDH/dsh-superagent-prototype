import { AppErrorSchema } from '@personal-agent/contracts'
import type { AppError } from '@personal-agent/contracts'
export class ApplicationFault extends Error {
  readonly error: AppError
  constructor(code: AppError['code'], message: string, retry: AppError['retry'] = 'user_action') {
    super(message)
    this.error = AppErrorSchema.parse({ code, message, retry })
  }
}
