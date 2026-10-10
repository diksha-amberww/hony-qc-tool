import type { QcProcessStatus } from '../../types/qc'
import type { QcResult } from '../../types/qc'
import { buildQcEventPayload, emitQcEngineEvent } from './qcEngineEventBus'

export function emitQcErrorNotification(args: {
  batchLabel: string | null
  completed: QcResult[]
  total: number
  status: QcProcessStatus
  startedAt: number | null
  error_message: string
}): void {
  emitQcEngineEvent(
    'onError',
    buildQcEventPayload({
      batchLabel: args.batchLabel,
      completed: args.completed,
      total: args.total,
      status: args.status,
      startedAt: args.startedAt,
      error_message: args.error_message,
    }),
  )
}
