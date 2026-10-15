import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { SandboxQcResult, SandboxTerminalLine } from '../data/sandboxQc'
type SandboxRunContextValue = {
  running: boolean
  /** Human-readable step label while Sandbox QC is in flight. */
  runStatusMessage: string
  /** 0–100 progress hint for the live output panel. */
  runProgress: number
  terminalLines: SandboxTerminalLine[]
  qcResult: SandboxQcResult | null
  showResults: boolean
  runErrors: string[]
  setRunning: (value: boolean) => void
  setRunStatusMessage: (value: string) => void
  setRunProgress: (value: number) => void
  setTerminalLines: React.Dispatch<React.SetStateAction<SandboxTerminalLine[]>>
  setQcResult: React.Dispatch<React.SetStateAction<SandboxQcResult | null>>
  setShowResults: (value: boolean) => void
  setRunErrors: React.Dispatch<React.SetStateAction<string[]>>
  registerTimer: (timerId: number) => void
  clearTimers: () => void
  bumpRunGeneration: () => number
  runGeneration: () => number
}

const SandboxRunContext = createContext<SandboxRunContextValue | null>(null)

export function SandboxRunProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState(false)
  const [runStatusMessage, setRunStatusMessage] = useState('')
  const [runProgress, setRunProgress] = useState(0)
  const [terminalLines, setTerminalLines] = useState<SandboxTerminalLine[]>([])
  const [qcResult, setQcResult] = useState<SandboxQcResult | null>(null)
  const [showResults, setShowResults] = useState(false)
  const [runErrors, setRunErrors] = useState<string[]>([])
  const timersRef = useRef<number[]>([])
  const runGenRef = useRef(0)
  const registerTimer = useCallback((timerId: number) => {
    timersRef.current.push(timerId)
  }, [])

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((id) => window.clearTimeout(id))
    timersRef.current = []
  }, [])

  const bumpRunGeneration = useCallback(() => {
    runGenRef.current += 1
    return runGenRef.current
  }, [])

  const runGeneration = useCallback(() => runGenRef.current, [])

  const value = useMemo(
    () => ({
      running,
      runStatusMessage,
      runProgress,
      terminalLines,
      qcResult,
      showResults,
      runErrors,
      setRunning,
      setRunStatusMessage,
      setRunProgress,
      setTerminalLines,
      setQcResult,
      setShowResults,
      setRunErrors,
      registerTimer,
      clearTimers,
      bumpRunGeneration,
      runGeneration,
    }),
    [
      running,
      runStatusMessage,
      runProgress,
      terminalLines,
      qcResult,
      showResults,
      runErrors,
      registerTimer,
      clearTimers,
      bumpRunGeneration,
      runGeneration,
    ],
  )

  return <SandboxRunContext.Provider value={value}>{children}</SandboxRunContext.Provider>
}

export function useSandboxRun(): SandboxRunContextValue {
  const ctx = useContext(SandboxRunContext)
  if (!ctx) throw new Error('useSandboxRun must be used within SandboxRunProvider')
  return ctx
}
