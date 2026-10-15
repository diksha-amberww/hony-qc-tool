import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { tokenCostUsd } from '../utils/aiPricing'
import { loadAiUsageTotals, saveAiUsageTotals } from '../utils/aiUsageStorage'
import { useSettings } from './SettingsContext'

type SessionTotals = {
  skus: number
  inputTokens: number
  outputTokens: number
}

type AiUsageContextValue = {
  allTimeInputTokens: number
  allTimeOutputTokens: number
  allTimeCostUsd: number
  sessionInputTokens: number
  sessionOutputTokens: number
  sessionSkus: number
  sessionCostUsd: number
  recordUsage: (inputTokens: number, outputTokens: number) => void
  recordSkuProcessed: () => void
  resetSessionUsage: () => void
  resetAllTimeUsage: () => void
}

const AiUsageContext = createContext<AiUsageContextValue | null>(null)

const emptySession = (): SessionTotals => ({ skus: 0, inputTokens: 0, outputTokens: 0 })

export function AiUsageProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings()
  const [totals, setTotals] = useState(loadAiUsageTotals)
  const [session, setSession] = useState<SessionTotals>(emptySession)

  useEffect(() => {
    saveAiUsageTotals(totals)
  }, [totals])

  const recordUsage = useCallback((inputTokens: number, outputTokens: number) => {
    const input = Math.max(0, inputTokens)
    const output = Math.max(0, outputTokens)
    if (input === 0 && output === 0) return
    setTotals((prev) => ({
      inputTokens: prev.inputTokens + input,
      outputTokens: prev.outputTokens + output,
    }))
    setSession((prev) => ({
      ...prev,
      inputTokens: prev.inputTokens + input,
      outputTokens: prev.outputTokens + output,
    }))
  }, [])

  const recordSkuProcessed = useCallback(() => {
    setSession((prev) => ({ ...prev, skus: prev.skus + 1 }))
  }, [])

  const resetSessionUsage = useCallback(() => {
    setSession(emptySession())
    void window.electronAPI?.qc?.resetAiMetrics?.()
  }, [])

  const resetAllTimeUsage = useCallback(() => {
    setTotals({ inputTokens: 0, outputTokens: 0 })
  }, [])

  const value = useMemo(
    () => ({
      allTimeInputTokens: totals.inputTokens,
      allTimeOutputTokens: totals.outputTokens,
      allTimeCostUsd: tokenCostUsd(totals.inputTokens, totals.outputTokens, settings),
      sessionInputTokens: session.inputTokens,
      sessionOutputTokens: session.outputTokens,
      sessionSkus: session.skus,
      sessionCostUsd: tokenCostUsd(session.inputTokens, session.outputTokens, settings),
      recordUsage,
      recordSkuProcessed,
      resetSessionUsage,
      resetAllTimeUsage,
    }),
    [totals, session, settings, recordUsage, recordSkuProcessed, resetSessionUsage, resetAllTimeUsage],
  )

  return <AiUsageContext.Provider value={value}>{children}</AiUsageContext.Provider>
}

export function useAiUsage() {
  const ctx = useContext(AiUsageContext)
  if (!ctx) throw new Error('useAiUsage must be used within AiUsageProvider')
  return ctx
}
