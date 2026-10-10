import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { QcResult, QcRunSource } from '../types/qc'

type LiveOutputContextValue = {
  rows: QcResult[]
  appendRow: (result: QcResult, source?: QcRunSource) => void
  clearRows: () => void
}

const LiveOutputContext = createContext<LiveOutputContextValue | null>(null)

export function LiveOutputProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<QcResult[]>([])

  const appendRow = useCallback((result: QcResult, source?: QcRunSource) => {
    const runSource = source ?? result.runSource ?? 'upload'
    setRows((prev) => [...prev, { ...result, runSource }])
  }, [])

  const clearRows = useCallback(() => {
    setRows([])
  }, [])

  const value = useMemo(
    () => ({ rows, appendRow, clearRows }),
    [rows, appendRow, clearRows],
  )

  return <LiveOutputContext.Provider value={value}>{children}</LiveOutputContext.Provider>
}

export function useLiveOutput(): LiveOutputContextValue {
  const ctx = useContext(LiveOutputContext)
  if (!ctx) throw new Error('useLiveOutput must be used within LiveOutputProvider')
  return ctx
}
