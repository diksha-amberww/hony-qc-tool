import { memo } from 'react'
import { Chip, useTheme, type ChipProps, type SxProps, type Theme } from '@mui/material'
import type { QcVerdict } from '../../types/qc'

export type QcVerdictTone = 'success' | 'warning' | 'error'

export function verdictTone(verdict: QcVerdict): QcVerdictTone {
  if (verdict === 'PASS') return 'success'
  if (verdict === 'FAIL') return 'error'
  return 'warning'
}

export function formatVerdictLabel(verdict: QcVerdict): string {
  if (verdict === 'MANUAL_REVIEW') return 'MANUAL REVIEW'
  return verdict.replace(/_/g, ' ')
}

const MANUAL_REVIEW_ORANGE = '#f59e0b'

/** Dark-mode: surrounding UI bg, colored text + border. Light: filled chip. */
export function verdictChipSx(verdict: QcVerdict, mode: 'light' | 'dark'): SxProps<Theme> {
  if (verdict === 'MANUAL_REVIEW') {
    if (mode === 'dark') {
      return {
        bgcolor: 'transparent !important',
        backgroundColor: 'transparent !important',
        border: '1px solid',
        borderColor: MANUAL_REVIEW_ORANGE,
        color: MANUAL_REVIEW_ORANGE,
        '& .MuiChip-label': { color: 'inherit', px: 0.85, fontWeight: 800 },
      }
    }
    return {
      bgcolor: MANUAL_REVIEW_ORANGE,
      color: '#1a1a1a',
      border: '1px solid',
      borderColor: '#d97706',
      '& .MuiChip-label': { color: 'inherit', fontWeight: 800 },
    }
  }

  const tone = verdictTone(verdict)
  if (mode !== 'dark') return {}

  return {
    bgcolor: 'transparent !important',
    backgroundColor: 'transparent !important',
    backgroundImage: 'none',
    border: '1px solid',
    borderColor: `${tone}.main`,
    color: `${tone}.main`,
    '& .MuiChip-label': {
      color: 'inherit',
      px: 0.85,
    },
  }
}

export type QcVerdictChipProps = {
  verdict: QcVerdict
  /** Compact table chip vs slightly larger strip chip */
  density?: 'compact' | 'default'
  sx?: SxProps<Theme>
} & Omit<ChipProps, 'label' | 'color' | 'variant' | 'children'>

/**
 * Shared PASS / FAIL / MANUAL REVIEW chip for Live Output, Export, and Sandbox.
 */
export const QcVerdictChip = memo(function QcVerdictChip({
  verdict,
  density = 'compact',
  sx,
  size = 'small',
  ...rest
}: QcVerdictChipProps) {
  const theme = useTheme()
  const mode = theme.palette.mode
  const tone = verdictTone(verdict)
  const isDark = mode === 'dark'
  const isManual = verdict === 'MANUAL_REVIEW'

  const densitySx: SxProps<Theme> =
    density === 'compact'
      ? { height: 20, fontSize: '9.5px', fontWeight: 700, borderRadius: 0.5 }
      : { height: 28, fontSize: '12px', fontWeight: 800, borderRadius: 0.5, px: 0.5 }

  return (
    <Chip
      {...rest}
      size={size}
      label={formatVerdictLabel(verdict)}
      color={isManual ? undefined : tone}
      variant={isManual || isDark ? 'outlined' : 'filled'}
      sx={[
        densitySx,
        verdictChipSx(verdict, mode),
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ] as SxProps<Theme>}
    />
  )
})
