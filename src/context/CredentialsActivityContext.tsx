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
import type { CredentialTestFeedback } from '../types/credentials'

const IDLE_TEST_FEEDBACK: CredentialTestFeedback = { status: 'idle', headline: '', lines: [] }

type CredentialsActivityContextValue = {
  testFeedbackByGroup: Record<string, CredentialTestFeedback>
  beginCredentialTest: (groupId: string) => void
  appendCredentialTestLine: (groupId: string, line: string) => void
  endCredentialTest: (groupId: string, ok: boolean, headline: string, lines: string[]) => void
  clearCredentialTestFeedback: (groupId: string) => void
  isGroupTestRunning: (groupId: string) => boolean
}

const CredentialsActivityContext = createContext<CredentialsActivityContextValue | null>(null)

export function CredentialsActivityProvider({ children }: { children: ReactNode }) {
  const [testFeedbackByGroup, setTestFeedbackByGroup] = useState<
    Record<string, CredentialTestFeedback>
  >({})
  const activeTestGroupRef = useRef<string | null>(null)

  const appendCredentialTestLine = useCallback((groupId: string, line: string) => {
    const text = line.trim()
    if (!text) return
    setTestFeedbackByGroup((prev) => {
      const cur = prev[groupId] ?? IDLE_TEST_FEEDBACK
      if (cur.status === 'idle') return prev
      if (cur.lines[cur.lines.length - 1] === text) return prev
      return {
        ...prev,
        [groupId]: { ...cur, lines: [...cur.lines, text] },
      }
    })
  }, [])

  const beginCredentialTest = useCallback((groupId: string) => {
    activeTestGroupRef.current = groupId
    setTestFeedbackByGroup((prev) => ({
      ...prev,
      [groupId]: { status: 'running', headline: '', lines: [] },
    }))
  }, [])

  const endCredentialTest = useCallback(
    (groupId: string, ok: boolean, headline: string, lines: string[]) => {
      if (activeTestGroupRef.current === groupId) {
        activeTestGroupRef.current = null
      }
      setTestFeedbackByGroup((prev) => {
        const prior = prev[groupId]
        const mergedLines = lines.length > 0 ? lines : prior?.lines ?? []
        return {
          ...prev,
          [groupId]: {
            status: ok ? 'success' : 'error',
            headline,
            lines: mergedLines,
          },
        }
      })
    },
    [],
  )

  const clearCredentialTestFeedback = useCallback((groupId: string) => {
    if (activeTestGroupRef.current === groupId) activeTestGroupRef.current = null
    setTestFeedbackByGroup((prev) => ({ ...prev, [groupId]: IDLE_TEST_FEEDBACK }))
  }, [])

  const isGroupTestRunning = useCallback(
    (groupId: string) => testFeedbackByGroup[groupId]?.status === 'running',
    [testFeedbackByGroup],
  )

  useEffect(() => {
    const subscribeTestLog = window.electronAPI?.credentials?.onTestLog
    if (!subscribeTestLog) return undefined
    return subscribeTestLog((payload) => {
      const groupId = String(payload?.groupId ?? '').trim()
      const line = String(payload?.line ?? '').trim()
      if (!groupId || !line) return
      if (activeTestGroupRef.current && activeTestGroupRef.current !== groupId) return
      if (!activeTestGroupRef.current) activeTestGroupRef.current = groupId
      setTestFeedbackByGroup((prev) => {
        const cur = prev[groupId]
        if (!cur || cur.status === 'idle') {
          return {
            ...prev,
            [groupId]: { status: 'running', headline: '', lines: [line] },
          }
        }
        if (cur.lines[cur.lines.length - 1] === line) return prev
        return { ...prev, [groupId]: { ...cur, lines: [...cur.lines, line] } }
      })
    })
  }, [])

  useEffect(() => {
    const subscribe = window.electronAPI?.onAppLog
    if (!subscribe) return undefined
    return subscribe((payload) => {
      const category = String(payload?.category ?? '').toUpperCase()
      if (category !== 'CREDENTIALS') return
      const groupId = activeTestGroupRef.current
      if (!groupId) return
      const message = String(payload?.message ?? '').trim()
      if (!message || message.startsWith('Credential test started')) return
      appendCredentialTestLine(groupId, message)
    })
  }, [appendCredentialTestLine])

  const value = useMemo(
    () => ({
      testFeedbackByGroup,
      beginCredentialTest,
      appendCredentialTestLine,
      endCredentialTest,
      clearCredentialTestFeedback,
      isGroupTestRunning,
    }),
    [
      testFeedbackByGroup,
      beginCredentialTest,
      appendCredentialTestLine,
      endCredentialTest,
      clearCredentialTestFeedback,
      isGroupTestRunning,
    ],
  )

  return (
    <CredentialsActivityContext.Provider value={value}>
      {children}
    </CredentialsActivityContext.Provider>
  )
}

export function useCredentialsActivity(): CredentialsActivityContextValue {
  const ctx = useContext(CredentialsActivityContext)
  if (!ctx) {
    throw new Error('useCredentialsActivity must be used within CredentialsActivityProvider')
  }
  return ctx
}
