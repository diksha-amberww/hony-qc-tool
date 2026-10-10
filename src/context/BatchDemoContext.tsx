import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { getQcBatchSession, pauseQcBatch, resumeQcBatch, stopQcBatch } from '../services/qcApi'
import { ensureVendorLoginBeforeScrape } from '../services/vendorSession/vendorLoginGate'
import { completeBatchInProcess } from '../services/qc/qcEngineService'
import { processQcRowForBatch } from '../services/qc/qcRowApi'
import { buildFailedQcResult, listingQcPayloadToQcResult } from '../services/qc/listingQcMapper'
import { normalizeScrapeErrorKind } from '../services/errorEngine/errorEngineService'
import { ScrapeOperationError } from '../errorEngine/types'
import { VENDOR_INTEGRATION_ID } from '../config/vendorIntegration'
import { useLiveOutput } from './LiveOutputContext'
import { useAiUsage } from './AiUsageContext'
import { useErrorEngine } from './ErrorEngineContext'
import { useLogs } from './LogsContext'
import { useBrandAliases } from './BrandAliasContext'
import { useSettings } from './SettingsContext'
import { emitQcErrorNotification } from '../services/qc/qcEngineNotifications'
import type { QcProcessStatus, QcResult } from '../types/qc'
import type { InputRow } from '../utils/inputParse'
import {
  clearExportLockSnapshot,
  lockExportSnapshot,
  readExportDraft,
} from '../utils/customExportDraft'

export type StartQcPayload = {
  sessionId: string
}

type BatchDemoContextValue = {
  total: number
  completed: QcResult[]
  status: QcProcessStatus
  running: boolean
  startedAt: number | null
  currentBatchLabel: string | null
  hasBatchQueue: boolean
  start: (payload: StartQcPayload) => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  stop: () => Promise<void>
  reset: () => Promise<void>
}

const BatchDemoContext = createContext<BatchDemoContextValue | null>(null)

const TICK_MS = 650

function formatVerdictLabel(verdict: string): string {
  return verdict.replace(/_/g, ' ')
}

function hasMainBatchRunner() {
  return Boolean(window.electronAPI?.qc?.processBatchInBackground)
}

export function BatchDemoProvider({ children }: { children: ReactNode }) {
  const { appendLog } = useLogs()
  const { appendRow: appendLiveOutputRow, clearRows: clearLiveOutputRows } = useLiveOutput()
  const { recordUsage } = useAiUsage()
  const { settings } = useSettings()
  const { aliasPairs } = useBrandAliases()
  const [completed, setCompleted] = useState<QcResult[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<QcProcessStatus>('idle')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [currentBatchLabel, setCurrentBatchLabel] = useState<string | null>(null)
  const runSeqRef = useRef(0)
  const batchLabelRef = useRef<string | null>(null)
  const prevStatusRef = useRef<QcProcessStatus>(status)
  const sessionReadyRef = useRef(false)
  const queueRef = useRef<InputRow[]>([])
  const sessionIdRef = useRef<string | null>(null)
  const statusRef = useRef<QcProcessStatus>(status)
  statusRef.current = status
  const completedCountRef = useRef(0)
  const processingRowRef = useRef(false)
  const vendorRecoveryRef = useRef(false)
  const { handleScrapeFailure, isRecovering, resetRecoveryUi } = useErrorEngine()
  const running = status === 'running'

  useEffect(() => {
    completedCountRef.current = completed.length
  }, [completed.length])

  const appendRowLogs = useCallback(
    (result: QcResult, rowIndex: number, label?: string) => {
      const nextCount = rowIndex + 1
      const sku =
        result.identity.find((f) => f.key === 'sku')?.value ??
        result.identity[0]?.value ??
        result.id

      appendLog({
        category: 'SCRAPING',
        message: `Vendor listing scraped for ${sku}`,
        detail: settings.headlessScraping ? result.id : `${result.id} · visible browser`,
        batchLabel: label,
      })
      appendLog({
        category: 'SCRAPING',
        message: `Amazon SP-API listing loaded`,
        detail: result.identity.find((f) => f.key === 'listing_id')?.value ?? result.id,
        batchLabel: label,
      })
      appendLog({
        category: 'AI',
        message: `Model comparison finished for ${sku}`,
        detail: `${result.inputTokens ?? 0} in / ${result.outputTokens ?? 0} out`,
        batchLabel: label,
      })

      const verdictLabel = formatVerdictLabel(result.verdict)
      if (result.verdict === 'FAIL') {
        emitQcErrorNotification({
          batchLabel: label ?? null,
          completed: [...completed, result],
          total,
          status: statusRef.current,
          startedAt,
          error_message: `QC FAIL — ${sku} (${verdictLabel})`,
        })
        appendLog({
          category: 'ERROR',
          message: `QC FAIL — ${sku}`,
          detail: `${nextCount}/${total} · ${verdictLabel}`,
          batchLabel: label,
        })
      } else if (result.verdict === 'MANUAL_REVIEW') {
        appendLog({
          category: 'WARNING',
          message: `Manual review required — ${sku}`,
          detail: `${nextCount}/${total} · ${verdictLabel}`,
          batchLabel: label,
        })
      } else {
        appendLog({
          category: 'QC',
          message: `PASS — ${sku}`,
          detail: `${nextCount}/${total}`,
          batchLabel: label,
        })
      }
    },
    [appendLog, completed, settings.headlessScraping, startedAt, total],
  )

  const ingestQcResult = useCallback(
    (rowIndex: number, result: QcResult) => {
      const inTok = result.inputTokens ?? 0
      const outTok = result.outputTokens ?? 0
      if (inTok > 0 || outTok > 0) {
        recordUsage(inTok, outTok)
      }
      setCompleted((prev) => {
        if (prev.length > rowIndex) return prev
        const row = { ...result, runSource: 'upload' as const }
        appendLiveOutputRow(row)
        const next = [...prev, row]
        completedCountRef.current = next.length
        return next
      })
      appendRowLogs(result, rowIndex, batchLabelRef.current ?? undefined)
    },
    [appendRowLogs, recordUsage, appendLiveOutputRow],
  )

  const reset = useCallback(async () => {
    const sessionId = sessionIdRef.current
    if (
      sessionId &&
      (statusRef.current === 'running' || statusRef.current === 'paused')
    ) {
      await stopQcBatch({ sessionId })
    }
    setCompleted([])
    clearLiveOutputRows()
    queueRef.current = []
    sessionIdRef.current = null
    completedCountRef.current = 0
    setTotal(0)
    prevStatusRef.current = 'idle'
    setStatus('idle')
    setStartedAt(null)
    setCurrentBatchLabel(null)
    batchLabelRef.current = null
    sessionReadyRef.current = false
    resetRecoveryUi()
    clearExportLockSnapshot()
    appendLog({ category: 'SYSTEM', message: 'QC workspace reset' })
  }, [appendLog, resetRecoveryUi, clearLiveOutputRows])

  const startMainBatchRunner = useCallback(
    async (sessionId: string, label: string, startRowIndex: number) => {
      const bridge = window.electronAPI?.qc?.processBatchInBackground
      if (!bridge) return
      await bridge({
        sessionId,
        batchLabel: label,
        vendorId: VENDOR_INTEGRATION_ID,
        headless: settings.headlessScraping,
        startRowIndex,
        settings: {
          titleSimilarityPercent: settings.titleSimilarityPercent,
          imageSimilarityPercent: settings.imageSimilarityPercent,
        },
        brandAliases: [...aliasPairs],
      })
    },
    [aliasPairs, settings],
  )

  const start = useCallback(
    async (payload: StartQcPayload) => {
      const session = await getQcBatchSession(payload.sessionId)
      if (!session.ok) {
        appendLog({
          category: 'ERROR',
          message: 'Cannot start QC',
          detail: session.error,
        })
        return
      }
      if (session.rows.length === 0) {
        appendLog({
          category: 'ERROR',
          message: 'Cannot start QC',
          detail: 'Validated batch has no rows',
        })
        return
      }
      if (session.state !== 'running') {
        appendLog({
          category: 'ERROR',
          message: 'Cannot start QC',
          detail:
            session.state === 'validated'
              ? 'Press Start QC on Upload after validation.'
              : `Batch session is ${session.state}. Validate and start a new batch.`,
        })
        return
      }

      queueRef.current = session.rows
      sessionIdRef.current = payload.sessionId
      setTotal(session.rows.length)

      runSeqRef.current += 1
      const label = `QC-${String(runSeqRef.current).padStart(3, '0')}`
      batchLabelRef.current = label
      setCurrentBatchLabel(label)
      setCompleted([])
      completedCountRef.current = 0
      setStartedAt(Date.now())
      prevStatusRef.current = 'running'
      setStatus('running')
      lockExportSnapshot(readExportDraft())

      await ensureVendorLoginBeforeScrape(
        settings,
        { sessionReady: sessionReadyRef },
        appendLog,
        label,
      )

      appendLog({
        category: 'SYSTEM',
        message: 'QC process started',
        detail: `0/${session.rows.length}`,
        batchLabel: label,
      })
      appendLog({
        category: 'QC',
        message: 'Batch queue ready',
        detail: `${session.rows.length} SKUs from validated upload`,
        batchLabel: label,
      })

      if (hasMainBatchRunner()) {
        await startMainBatchRunner(payload.sessionId, label, 0)
      }
    },
    [appendLog, settings, startMainBatchRunner],
  )

  const pause = useCallback(async () => {
    if (statusRef.current !== 'running') return
    const sessionId = sessionIdRef.current
    if (sessionId) {
      const result = await pauseQcBatch({ sessionId })
      if (!result.ok) {
        appendLog({
          category: 'ERROR',
          message: 'Could not pause QC',
          detail: result.error,
          batchLabel: batchLabelRef.current ?? undefined,
        })
        return
      }
    }
    setStatus('paused')
  }, [appendLog])

  const resume = useCallback(async () => {
    if (statusRef.current !== 'paused') return
    const sessionId = sessionIdRef.current
      if (sessionId) {
      const result = await resumeQcBatch({ sessionId })
      if (!result.ok) {
        appendLog({
          category: 'ERROR',
          message: 'Could not resume QC',
          detail: result.error,
          batchLabel: batchLabelRef.current ?? undefined,
        })
        return
      }
    }
    setStatus('running')
  }, [appendLog])

  const stop = useCallback(async () => {
    if (statusRef.current !== 'running' && statusRef.current !== 'paused') return
    const sessionId = sessionIdRef.current
    if (sessionId) {
      const result = await stopQcBatch({ sessionId })
      if (!result.ok) {
        appendLog({
          category: 'ERROR',
          message: 'Could not stop QC',
          detail: result.error,
          batchLabel: batchLabelRef.current ?? undefined,
        })
        return
      }
    }
    setStatus('stopped')
  }, [appendLog])

  useEffect(() => {
    const subscribe = window.electronAPI?.qc?.onBatchProcessing
    if (!subscribe) return undefined

    return subscribe(async (event) => {
      if (event.sessionId !== sessionIdRef.current) return
      const label = batchLabelRef.current ?? undefined

      if (event.type === 'row') {
        const row = queueRef.current[event.rowIndex]
        const response = event.result
        if (response.ok) {
          ingestQcResult(event.rowIndex, listingQcPayloadToQcResult(response.result))
          return
        }
        if (response.phase === 'vendor') return
        if (row) {
          ingestQcResult(event.rowIndex, buildFailedQcResult(row, response.error))
        }
        return
      }

      if (event.type === 'vendorFailure') {
        if (vendorRecoveryRef.current) return
        vendorRecoveryRef.current = true
        const row = queueRef.current[event.rowIndex]
        try {
          if (!settings.errorEngineEnabled) {
            appendLog({
              category: 'ERROR',
              message: 'Scrape failed (Error Engine disabled)',
              detail: event.error,
              batchLabel: label,
            })
            await pause()
            return
          }
          sessionReadyRef.current = false
          const scrapeError = new ScrapeOperationError({
            kind: normalizeScrapeErrorKind(event.kind),
            message: event.error,
            sku: String(row?.part_sku ?? row?.sku ?? ''),
            retryable: true,
          })
          const recovered = await handleScrapeFailure(scrapeError, {
            pause,
            resume,
            batchLabel: label,
          })
          if (recovered) {
            sessionReadyRef.current = true
          }
        } finally {
          vendorRecoveryRef.current = false
        }
        return
      }

      if (event.type === 'complete') {
        setStatus('done')
        return
      }
    })
  }, [appendLog, handleScrapeFailure, ingestQcResult, pause, resume, settings.errorEngineEnabled])

  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if (prev === status) return
    const label = batchLabelRef.current ?? undefined
    if (prev === 'running' && status === 'paused') {
      appendLog({ category: 'SYSTEM', message: 'QC process paused', batchLabel: label })
    } else if (prev === 'paused' && status === 'running') {
      appendLog({ category: 'SYSTEM', message: 'QC process resumed', batchLabel: label })
    } else if ((prev === 'running' || prev === 'paused') && status === 'stopped') {
      appendLog({ category: 'SYSTEM', message: 'QC process stopped', batchLabel: label })
      clearExportLockSnapshot()
    } else if (status === 'done' && prev === 'running') {
      appendLog({
        category: 'QC',
        message: 'QC process completed',
        detail: `${total}/${total}`,
        batchLabel: label,
      })
      appendLog({
        category: 'SYSTEM',
        message: 'Batch finished successfully',
        batchLabel: label,
      })
      if (sessionIdRef.current) {
        completeBatchInProcess(sessionIdRef.current)
      }
      clearExportLockSnapshot()
    } else if (status === 'done' && prev === 'paused') {
      clearExportLockSnapshot()
    }
  }, [status, appendLog, total])

  useEffect(() => {
    if (hasMainBatchRunner()) return
    if (status !== 'running') return
    if (total <= 0) return
    if (completedCountRef.current >= total) {
      setStatus('done')
      return
    }

    let loopActive = true

    const runLoop = async () => {
      while (loopActive && statusRef.current === 'running') {
        if (isRecovering || processingRowRef.current) {
          await new Promise((resolve) => window.setTimeout(resolve, 200))
          continue
        }

        const rowIndex = completedCountRef.current
        if (rowIndex >= total) {
          setStatus('done')
          break
        }

        const row = queueRef.current[rowIndex]
        if (!row) break

        processingRowRef.current = true
        const label = batchLabelRef.current ?? undefined

        try {
          await new Promise((resolve) => window.setTimeout(resolve, TICK_MS))
          if (!loopActive || statusRef.current !== 'running') break

          const result = await processQcRowForBatch(row, {
            rowIndex,
            headless: settings.headlessScraping,
            batchLabel: label,
            settings,
            brandAliases: aliasPairs,
            loginGateRefs: { sessionReady: sessionReadyRef },
            appendLog,
          })
          ingestQcResult(rowIndex, result)
        } catch (error) {
          sessionReadyRef.current = false
          if (!settings.errorEngineEnabled) {
            const detail = error instanceof Error ? error.message : 'Scrape failed'
            emitQcErrorNotification({
              batchLabel: label ?? null,
              completed,
              total,
              status: statusRef.current,
              startedAt,
              error_message: detail,
            })
            appendLog({
              category: 'ERROR',
              message: 'Scrape failed (Error Engine disabled)',
              detail,
              batchLabel: label,
            })
            await pause()
            break
          }
          const recovered = await handleScrapeFailure(error, {
            pause,
            resume,
            batchLabel: label,
          })
          if (recovered) {
            sessionReadyRef.current = true
          }
        } finally {
          processingRowRef.current = false
        }
      }
    }

    void runLoop()

    return () => {
      loopActive = false
    }
  }, [
    status,
    total,
    isRecovering,
    appendLog,
    settings,
    aliasPairs,
    handleScrapeFailure,
    pause,
    resume,
    ingestQcResult,
    completed,
    startedAt,
  ])

  const value = useMemo(
    () => ({
      total,
      completed,
      status,
      running,
      startedAt,
      currentBatchLabel,
      hasBatchQueue: total > 0,
      start,
      pause,
      resume,
      stop,
      reset,
    }),
    [
      total,
      completed,
      status,
      running,
      startedAt,
      currentBatchLabel,
      start,
      pause,
      resume,
      stop,
      reset,
    ],
  )

  return <BatchDemoContext.Provider value={value}>{children}</BatchDemoContext.Provider>
}

export function useBatchDemo() {
  const ctx = useContext(BatchDemoContext)
  if (!ctx) throw new Error('useBatchDemo must be used within BatchDemoProvider')
  return ctx
}
