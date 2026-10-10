import { useEffect } from 'react'
import { useLogs } from '../../context/LogsContext'
import type { AppendLogInput } from '../../types/log'

type AppLogPayload = {
  category?: string
  message: string
  detail?: string
  batchLabel?: string
  at?: number
}

/**
 * Streams Electron main-process log events into the shared Logs store.
 */
export function ElectronLogBridge() {
  const { appendLog } = useLogs()

  useEffect(() => {
    const subscribe = window.electronAPI?.onAppLog
    if (!subscribe) return undefined

    return subscribe((payload: AppLogPayload) => {
      const message = String(payload?.message ?? '').trim()
      if (!message) return
      const input: AppendLogInput = {
        category: (payload.category ?? 'SYSTEM').toString().trim().toUpperCase() || 'SYSTEM',
        message,
        detail: payload.detail?.trim() || undefined,
        batchLabel: payload.batchLabel?.trim() || undefined,
        at: payload.at,
      }
      appendLog(input)
    })
  }, [appendLog])

  return null
}
