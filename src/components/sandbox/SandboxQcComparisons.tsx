import { Box, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { QcProductImage } from '../compare'
import { extractImageUrlFromText } from '../../utils/cleanImageUrl'
import type { SandboxComparison, SandboxCompareOutcome } from '../../data/sandboxQc'

const CHECK_DISPLAY_ORDER = ['title', 'brand', 'model', 'upc', 'pack', 'packSize', 'image'] as const

function outcomePillStyle(o: SandboxCompareOutcome, isDark: boolean) {
  if (o === 'MATCH') {
    return { bgcolor: isDark ? '#15803d' : '#16a34a', color: '#fff' }
  }
  if (o === 'MISMATCH') {
    return { bgcolor: isDark ? '#b91c1c' : '#dc2626', color: '#fff' }
  }
  return { bgcolor: isDark ? '#b45309' : '#d97706', color: '#fff' }
}

function outcomeLabel(o: SandboxCompareOutcome): string {
  if (o === 'MATCH') return 'PASS'
  if (o === 'MISMATCH') return 'FAIL'
  return ''
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

function cellDisplayText(key: string, value: string, column: 'vendor' | 'asin'): string {
  const raw = String(value ?? '').trim()
  if (!raw || raw === '—' || raw === '-') return ''
  if (key === 'title' && column === 'asin') {
    return raw.replace(/\s*\(score\s+\d+\)\s*$/i, '').trim()
  }
  return raw
}

function ComparisonValueCell({ value, imageAlt }: { value: string; imageAlt?: string }) {
  const imageSrc = extractImageUrlFromText(value) || (looksLikeUrl(value) ? value.trim() : '')
  if (imageSrc) {
    return (
      <Box sx={{ maxWidth: 140 }}>
        <QcProductImage src={imageSrc} alt={imageAlt ?? 'Product'} showUrl size="sm" enlargeable />
      </Box>
    )
  }
  return <>{value}</>
}

function rowTint(outcome: SandboxCompareOutcome, isDark: boolean): string | undefined {
  if (outcome === 'MATCH') {
    return isDark ? 'rgba(22, 163, 74, 0.06)' : 'rgba(22, 163, 74, 0.08)'
  }
  if (outcome === 'MISMATCH') {
    return isDark ? 'rgba(220, 38, 38, 0.08)' : 'rgba(220, 38, 38, 0.06)'
  }
  return isDark ? 'rgba(217, 119, 6, 0.08)' : 'rgba(217, 119, 6, 0.06)'
}

type SandboxQcComparisonsProps = {
  comparisons: SandboxComparison[]
  isDark: boolean
  titleScore?: number | null
  imageScore?: number | null
}

export function SandboxQcComparisons({
  comparisons,
  isDark,
  titleScore,
  imageScore,
}: SandboxQcComparisonsProps) {
  const ordered = [...comparisons].sort((a, b) => {
    const ia = CHECK_DISPLAY_ORDER.indexOf(a.key as (typeof CHECK_DISPLAY_ORDER)[number])
    const ib = CHECK_DISPLAY_ORDER.indexOf(b.key as (typeof CHECK_DISPLAY_ORDER)[number])
    const ai = ia === -1 ? 99 : ia
    const bi = ib === -1 ? 99 : ib
    return ai - bi
  })

  const summary = comparisons.reduce(
    (acc, c) => {
      if (c.outcome === 'MATCH') acc.match += 1
      else if (c.outcome === 'MISMATCH') acc.mismatch += 1
      else acc.review += 1
      return acc
    },
    { match: 0, mismatch: 0, review: 0 },
  )

  const panelBg = isDark ? '#0c0c0e' : 'background.paper'
  const headerBg = isDark ? 'rgba(255,255,255,0.04)' : 'action.hover'

  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: 1.5,
        border: '1px solid',
        borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'divider',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        bgcolor: panelBg,
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 1.25,
          borderBottom: '1px solid',
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'divider',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          bgcolor: headerBg,
        }}
      >
        <Typography sx={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.02em' }}>
          Comparison · {comparisons.length} checks
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <SummaryPill label={`PASS ${summary.match}`} tone="match" isDark={isDark} />
          <SummaryPill label={`FAIL ${summary.mismatch}`} tone="mismatch" isDark={isDark} />
          {summary.review > 0 && (
            <SummaryPill label={`Review ${summary.review}`} tone="review" isDark={isDark} />
          )}
        </Box>
      </Box>
      <Box sx={{ overflow: 'auto', minHeight: 0 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell
                sx={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'text.secondary',
                  width: 130,
                  borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'divider',
                  bgcolor: headerBg,
                }}
              >
                CHECK
              </TableCell>
              <TableCell
                sx={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'text.secondary',
                  borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'divider',
                  bgcolor: headerBg,
                }}
              >
                VENDOR
              </TableCell>
              <TableCell
                sx={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'text.secondary',
                  borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'divider',
                  bgcolor: headerBg,
                }}
              >
                ASIN
              </TableCell>
              <TableCell
                sx={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'text.secondary',
                  width: 140,
                  borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'divider',
                  bgcolor: headerBg,
                }}
              >
                RESULT
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {ordered.map((field, rowIndex) => (
              <TableRow
                key={field.key}
                sx={{
                  bgcolor: rowTint(field.outcome, isDark),
                  animation: `sandboxRowUp 0.45s cubic-bezier(0.22, 1, 0.36, 1) ${rowIndex * 0.05}s both`,
                  '@keyframes sandboxRowUp': {
                    from: { opacity: 0, transform: 'translateY(20px)' },
                    to: { opacity: 1, transform: 'translateY(0)' },
                  },
                }}
              >
                <TableCell
                  sx={{
                    fontSize: '12px',
                    fontWeight: 700,
                    verticalAlign: 'top',
                    borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'divider',
                  }}
                >
                  {field.key === 'title' && titleScore != null
                    ? `${field.label} (${titleScore}%)`
                    : field.key === 'image' && imageScore != null
                      ? `${field.label} (${imageScore}%)`
                      : field.label}
                </TableCell>
                <TableCell
                  sx={{
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    verticalAlign: 'top',
                    wordBreak: 'break-word',
                    borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'divider',
                    color: isDark ? '#e4e4e7' : 'text.primary',
                  }}
                >
                  <ComparisonValueCell
                    value={cellDisplayText(field.key, field.sourceValue, 'vendor')}
                    imageAlt="Vendor product image"
                  />
                </TableCell>
                <TableCell
                  sx={{
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    verticalAlign: 'top',
                    wordBreak: 'break-word',
                    borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'divider',
                    color: isDark ? '#e4e4e7' : 'text.primary',
                  }}
                >
                  <ComparisonValueCell
                    value={cellDisplayText(field.key, field.targetValue, 'asin')}
                    imageAlt="ASIN product image"
                  />
                </TableCell>
                <TableCell
                  sx={{
                    verticalAlign: 'top',
                    borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'divider',
                  }}
                >
                  <Box
                    component="span"
                    sx={{
                      display: 'inline-block',
                      px: 1.5,
                      py: 0.4,
                      borderRadius: '999px',
                      fontSize: '11px',
                      fontWeight: 700,
                      lineHeight: 1.2,
                      whiteSpace: 'nowrap',
                      ...outcomePillStyle(field.outcome, isDark),
                    }}
                  >
                    {outcomeLabel(field.outcome)}
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Paper>
  )
}

function SummaryPill({
  label,
  tone,
  isDark,
}: {
  label: string
  tone: 'match' | 'mismatch' | 'review'
  isDark: boolean
}) {
  const map = {
    match: isDark ? '#15803d' : '#16a34a',
    mismatch: isDark ? '#b91c1c' : '#dc2626',
    review: isDark ? '#b45309' : '#d97706',
  }
  return (
    <Box
      component="span"
      sx={{
        px: 1.25,
        py: 0.35,
        borderRadius: '999px',
        fontSize: '11px',
        fontWeight: 700,
        bgcolor: map[tone],
        color: '#fff',
      }}
    >
      {label}
    </Box>
  )
}
