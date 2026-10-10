import { useEffect, useMemo, useState } from 'react'
import { Box, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { PageFrame } from '../components/layout/PageFrame'
import { ExportVendorIdentity, FullExport, PartialExport } from '../components/export'
import { QcVerdictChip } from '../components/status'
import { useBatchDemo } from '../context/BatchDemoContext'
import { useAppTheme } from '../theme'

const EXPORT_PREVIEW_LIMIT = 10

type StatusBoxDef = {
  key: 'pass' | 'fail' | 'manual'
  label: string
  count: number
  border: string
  bg: string
  value: string
}

function formatSpeedPerSku(startedAt: number | null, completedCount: number, now: number): string {
  if (!startedAt || completedCount <= 0) return '—'
  const elapsedMs = Math.max(now - startedAt, 1)
  const secondsPerSku = elapsedMs / completedCount / 1000
  if (secondsPerSku < 0.01) return '<0.01s / SKU'
  return `${secondsPerSku.toFixed(2)}s / SKU`
}

function thinScrollbarSx(isDark: boolean) {
  return {
    scrollbarWidth: 'thin' as const,
    scrollbarColor: isDark ? 'rgba(82,82,91,0.85) transparent' : 'rgba(148,163,184,0.7) transparent',
    '&::-webkit-scrollbar': { width: 5, height: 5 },
    '&::-webkit-scrollbar-track': { background: 'transparent', marginBlock: 6 },
    '&::-webkit-scrollbar-thumb': {
      backgroundColor: isDark ? 'rgba(82,82,91,0.9)' : 'rgba(148,163,184,0.75)',
      borderRadius: 999,
      border: '1px solid transparent',
      backgroundClip: 'padding-box',
    },
    '&::-webkit-scrollbar-thumb:hover': {
      backgroundColor: isDark ? 'rgba(113,113,122,0.95)' : 'rgba(100,116,139,0.85)',
    },
    '&::-webkit-scrollbar-corner': { background: 'transparent' },
  }
}

export function ExportPage() {
  const { completed, total, status, startedAt } = useBatchDemo()
  const { mode } = useAppTheme()
  const [now, setNow] = useState(() => Date.now())
  const isDark = mode === 'dark'
  const border = isDark ? '#2a2a2a' : 'divider'

  useEffect(() => {
    if (status !== 'running') {
      setNow(Date.now())
      return
    }
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [status])

  const counts = useMemo(() => {
    let pass = 0
    let fail = 0
    let manual = 0
    for (const r of completed) {
      if (r.verdict === 'PASS') pass++
      else if (r.verdict === 'FAIL') fail++
      else manual++
    }
    return { pass, fail, manual }
  }, [completed])

  const remaining = Math.max(total - completed.length, 0)
  const speedLabel = formatSpeedPerSku(startedAt, completed.length, now)

  const previewRows = useMemo(
    () => [...completed].reverse().slice(0, EXPORT_PREVIEW_LIMIT),
    [completed],
  )

  const statusBoxes: StatusBoxDef[] = [
    {
      key: 'pass',
      label: 'PASS',
      count: counts.pass,
      border: 'success.main',
      bg: isDark ? '#141416' : 'rgba(34, 197, 94, 0.12)',
      value: 'success.main',
    },
    {
      key: 'manual',
      label: 'MANUAL REVIEW',
      count: counts.manual,
      border: 'warning.main',
      bg: isDark ? '#141416' : 'rgba(245, 158, 11, 0.14)',
      value: 'warning.main',
    },
    {
      key: 'fail',
      label: 'FAIL',
      count: counts.fail,
      border: 'error.main',
      bg: isDark ? '#141416' : 'rgba(239, 68, 68, 0.12)',
      value: 'error.main',
    },
  ]

  return (
    <PageFrame title="Export" subtitle="Partial · full batch · verdict filters">
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
          gap: 1.5,
        }}
      >
        <PartialExport />
        <ExportVendorIdentity />
        <FullExport />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 1.5 }}>
        {statusBoxes.map((box) => (
          <Paper
            key={box.key}
            sx={{
              p: 1.75,
              borderRadius: 0.5,
              border: '1px solid',
              borderColor: box.border,
              bgcolor: box.bg,
            }}
          >
            <Typography
              sx={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.04em', color: box.value }}
            >
              {box.label}
            </Typography>
            <Typography sx={{ fontSize: '22px', fontWeight: 700, color: box.value, mt: 0.25 }}>
              {box.count}
            </Typography>
          </Paper>
        ))}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 1.5 }}>
        <Paper sx={{ p: 1.75, borderRadius: 0.5, border: '1px solid', borderColor: border, bgcolor: isDark ? '#141416' : '#ffffff' }}>
          <Typography sx={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.04em', color: 'text.secondary' }}>
            TOTAL SKU PROGRESS
          </Typography>
          <Typography sx={{ fontSize: '22px', fontWeight: 700, mt: 0.25, fontVariantNumeric: 'tabular-nums' }}>
            {completed.length} / {total}
          </Typography>
          <Typography sx={{ fontSize: '12px', color: 'text.secondary', mt: 0.5 }}>
            {remaining} remaining
          </Typography>
        </Paper>

        <Paper sx={{ p: 1.75, borderRadius: 0.5, border: '1px solid', borderColor: border, bgcolor: isDark ? '#141416' : '#ffffff' }}>
          <Typography sx={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.04em', color: 'text.secondary' }}>
            QC SPEED PER SKU
          </Typography>
          <Typography sx={{ fontSize: '22px', fontWeight: 700, mt: 0.25, fontVariantNumeric: 'tabular-nums' }}>
            {speedLabel}
          </Typography>
          <Typography sx={{ fontSize: '12px', color: 'text.secondary', mt: 0.5 }}>
            {status === 'running'
              ? 'Updating live'
              : status === 'done'
                ? 'Batch complete'
                : status === 'paused'
                  ? 'Paused'
                  : 'Waiting for QC'}
          </Typography>
        </Paper>
      </Box>

      <Box>
        <Typography sx={{ fontSize: '13px', fontWeight: 700, mb: 1 }}>
          Preview
          <Typography component="span" sx={{ fontSize: '12px', fontWeight: 400, color: 'text.secondary', ml: 1 }}>
            Showing up to {EXPORT_PREVIEW_LIMIT} of {completed.length} results
          </Typography>
        </Typography>
        <Paper
          sx={{
            borderRadius: 0.5,
            border: '1px solid',
            borderColor: border,
            bgcolor: isDark ? '#141416' : '#ffffff',
            overflow: 'auto',
            maxHeight: 360,
            ...thinScrollbarSx(isDark),
          }}
        >
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {['Verdict', 'Result ID', 'Identity'].map((col) => (
                  <TableCell
                    key={col}
                    sx={{
                      fontSize: '11px',
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      color: 'text.secondary',
                      bgcolor: isDark ? '#141416' : '#ffffff',
                      borderColor: border,
                    }}
                  >
                    {col}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {previewRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} sx={{ fontSize: '12px', color: 'text.secondary', py: 3, borderColor: border }}>
                    {status === 'running'
                      ? 'QC in progress — preview fills as results complete…'
                      : 'No QC results yet. Start a batch from Live Output.'}
                  </TableCell>
                </TableRow>
              )}
              {previewRows.map((result) => (
                <TableRow key={result.id}>
                  <TableCell sx={{ borderColor: border }}>
                    <QcVerdictChip verdict={result.verdict} />
                  </TableCell>
                  <TableCell sx={{ fontSize: '12px', fontFamily: 'monospace', borderColor: border }}>
                    {result.id}
                  </TableCell>
                  <TableCell sx={{ fontSize: '12px', borderColor: border }}>
                    {result.identity.map((f) => f.value).filter(Boolean).join(' · ') || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      </Box>
    </PageFrame>
  )
}
