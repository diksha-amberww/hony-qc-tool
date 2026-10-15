import { Box, type SxProps, type Theme } from '@mui/material'
import { useEffect, useRef, useState, type ReactNode } from 'react'

type SandboxScrollRevealProps = {
  children: ReactNode
  /** When true, plays enter animation and smooth-scrolls into view */
  active?: boolean
  sx?: SxProps<Theme>
}

/**
 * Results block slides up from below when QC finishes; rows can re-animate on scroll into view.
 */
export function SandboxScrollReveal({ children, active = false, sx }: SandboxScrollRevealProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    if (!active) {
      setEntered(false)
      return
    }
    setEntered(true)
    const t = window.setTimeout(() => {
      rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    return () => window.clearTimeout(t)
  }, [active])

  return (
    <Box
      ref={rootRef}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        minWidth: 0,
        scrollMarginTop: 24,
        opacity: entered ? 1 : 0,
        transform: entered ? 'translateY(0)' : 'translateY(56px)',
        transition: 'opacity 0.55s cubic-bezier(0.22, 1, 0.36, 1), transform 0.55s cubic-bezier(0.22, 1, 0.36, 1)',
        ...sx,
      }}
    >
      {children}
    </Box>
  )
}
