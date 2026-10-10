import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type CredentialRuntimeContextValue = {
  /** Bumps when credentials are saved or cleared (main process or local fallback). */
  revision: number
  bumpRevision: () => void
}

const CredentialRuntimeContext = createContext<CredentialRuntimeContextValue | null>(null)

export function CredentialRuntimeProvider({ children }: { children: ReactNode }) {
  const [revision, setRevision] = useState(0)

  const bumpRevision = useCallback(() => {
    setRevision((n) => n + 1)
  }, [])

  useEffect(() => {
    const onLocal = () => bumpRevision()
    window.addEventListener('hony:credentials-changed', onLocal)

    const subscribe = window.electronAPI?.credentials?.onChanged
    const unsubscribe = subscribe?.(() => {
      bumpRevision()
    })

    return () => {
      window.removeEventListener('hony:credentials-changed', onLocal)
      unsubscribe?.()
    }
  }, [bumpRevision])

  const value = useMemo(() => ({ revision, bumpRevision }), [revision, bumpRevision])

  return (
    <CredentialRuntimeContext.Provider value={value}>{children}</CredentialRuntimeContext.Provider>
  )
}

export function useCredentialRuntime(): CredentialRuntimeContextValue {
  const ctx = useContext(CredentialRuntimeContext)
  if (!ctx) {
    throw new Error('useCredentialRuntime must be used within CredentialRuntimeProvider')
  }
  return ctx
}
