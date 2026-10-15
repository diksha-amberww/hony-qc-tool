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
  /** Drop rows matching predicate (e.g. sandbox-only clear). */
  removeRowsWhere: (shouldRemove: (row: QcResult) => boolean) => void
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

  const removeRowsWhere = useCallback((shouldRemove: (row: QcResult) => boolean) => {
    setRows((prev) => prev.filter((row) => !shouldRemove(row)))
  }, [])

  const value = useMemo(
    () => ({ rows, appendRow, clearRows, removeRowsWhere }),
    [rows, appendRow, clearRows, removeRowsWhere],
  )

  return <LiveOutputContext.Provider value={value}>{children}</LiveOutputContext.Provider>
}

export function useLiveOutput(): LiveOutputContextValue {
  const ctx = useContext(LiveOutputContext)
  if (!ctx) throw new Error('useLiveOutput must be used within LiveOutputProvider')
  return ctx
}
