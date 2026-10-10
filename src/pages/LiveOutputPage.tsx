import { useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { PageFrame } from '../components/layout/PageFrame'
import { Pagination, getPageItemRange, DEFAULT_PAGE_SIZE_OPTIONS } from '../components/pagination'
import { useBatchDemo } from '../context/BatchDemoContext'
import { useLiveOutput } from '../context/LiveOutputContext'
import { useSandboxRun } from '../context/SandboxRunContext'
import { useErrorEngine } from '../context/ErrorEngineContext'
import { ComparisonDialog } from '../components/compare/ComparisonDialog'
import { CompareOutcomeChip } from '../components/live/CompareOutcomeChip'
import { QcControlBar, liveOutputControlBtnSx } from '../components/live/QcControlBar'
import { QcVerdictChip } from '../components/status'
import type { QcResult } from '../types/qc'
import {
  LIVE_RESULT_COLUMNS,
  buildVerdictReason,
  comparisonForKey,
  comparisonOutcome,
  formatProgressLabel,
  identityField,
  runSourceLabel,
  summarizeCounts,
} from '../utils/liveOutputDisplay'

const PAGE_SIZE_OPTIONS = [...DEFAULT_PAGE_SIZE_OPTIONS]
const DEFAULT_PAGE_SIZE = 25

const headerCellSx = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.05em',
  whiteSpace: 'nowrap',
  color: 'text.secondary',
  borderColor: 'divider',
  py: 1,
} as const

function SourceChip({ source }: { source: QcResult['runSource'] }) {
  const label = runSourceLabel(source)
  return (
    <Chip
      size="small"
      label={label}
      variant="outlined"
      sx={{
        height: 22,
        fontSize: '10px',
        fontWeight: 700,
        borderRadius: 0.5,
        color: 'text.secondary',
        borderColor: 'divider',
      }}
    />
  )
}

export function LiveOutputPage() {
  const { completed, total, status, pause, resume, stop, reset } = useBatchDemo()
  const { rows: allResults, clearRows: clearLiveOutput } = useLiveOutput()
  const { running: sandboxRunning } = useSandboxRun()
  const { phase, statusMessage } = useErrorEngine()
  const [viewResult, setViewResult] = useState<QcResult | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const counts = useMemo(() => summarizeCounts(allResults), [allResults])

  const displayOrder = useMemo(() => [...allResults].reverse(), [allResults])
  const { start: rangeStart, end: rangeEnd } = getPageItemRange(page, pageSize, displayOrder.length)
  const visibleRows = displayOrder.slice(rangeStart, rangeEnd)

  const colSpan =
    1 + 1 + 3 + LIVE_RESULT_COLUMNS.length + 2

  const progressLabel = formatProgressLabel(completed.length, total, allResults.length)

  return (
    <PageFrame
      title="Live output"
      subtitle="Unified results from Sandbox single-runs and Upload batch runs. Click a row for Vendor vs Amazon detail and the verdict reason."
      actions={
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            onClick={() => {
              clearLiveOutput()
              void reset()
            }}
            sx={liveOutputControlBtnSx}
          >
            Reset
          </Button>
          <QcControlBar
            status={status}
            allowStart={false}
            onStart={() => {}}
            onPause={() => void pause()}
            onResume={() => void resume()}
            onStop={() => void stop()}
          />
        </Box>
      }
    >
      {statusMessage && phase !== 'idle' && (
        <Alert
          severity={
            phase === 'recovery_failed' ? 'error' : phase === 'recovered' ? 'success' : 'warning'
          }
          sx={{ borderRadius: 0.5, '& .MuiAlert-message': { fontSize: '12px', fontWeight: 600 } }}
        >
          {statusMessage}
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 1.5 }}>
        {[
          ['Passed', counts.pass, 'success.main'],
          ['Failed', counts.fail, 'error.main'],
          ['Manual review', counts.manual, 'warning.main'],
          ['Progress', progressLabel, 'text.primary'],
        ].map(([label, value, color]) => (
          <Paper
            key={String(label)}
            sx={{ p: 1.5, borderRadius: 0.5, border: '1px solid', borderColor: 'divider' }}
          >
            <Typography sx={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', color: 'text.secondary' }}>
              {String(label).toUpperCase()}
            </Typography>
            <Typography sx={{ fontSize: '22px', fontWeight: 700, color: color as string, mt: 0.25 }}>
              {value}
            </Typography>
          </Paper>
        ))}
      </Box>

      <Paper
        sx={{
          borderRadius: 0.5,
          border: '1px solid',
          borderColor: 'divider',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={headerCellSx}>VERDICT</TableCell>
                <TableCell sx={headerCellSx}>SOURCE</TableCell>
                <TableCell sx={headerCellSx}>SKU</TableCell>
                <TableCell sx={headerCellSx}>ASIN</TableCell>
                <TableCell sx={headerCellSx}>BRAND</TableCell>
                {LIVE_RESULT_COLUMNS.map((col) => (
                  <TableCell key={col.key} sx={headerCellSx} align="center">
                    {col.header}
                  </TableCell>
                ))}
                <TableCell sx={headerCellSx}>REASON</TableCell>
                <TableCell sx={headerCellSx} align="right">VIEW</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {allResults.length === 0 && (
                <TableRow>
                  <TableCell colSpan={colSpan} sx={{ fontSize: '12px', color: 'text.secondary', py: 3 }}>
                    {status === 'running' || sandboxRunning
                      ? 'QC in progress — waiting for the first result…'
                      : 'Run Upload batch QC or Sandbox — results appear here with YES/NO per field.'}
                  </TableCell>
                </TableRow>
              )}
              {visibleRows.map((result, index) => (
                <TableRow
                  key={`${result.runSource ?? 'upload'}-${result.id}-${index}`}
                  hover
                  className="animate-fade-in"
                  sx={{ '& td': { borderColor: 'divider', fontSize: '12px', py: 1 } }}
                >
                  <TableCell>
                    <QcVerdictChip verdict={result.verdict} />
                  </TableCell>
                  <TableCell>
                    <SourceChip source={result.runSource} />
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                    {identityField(result, 'sku')}
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>
                    {identityField(result, 'listing_id')}
                  </TableCell>
                  <TableCell>{identityField(result, 'brand')}</TableCell>
                  {LIVE_RESULT_COLUMNS.map((col) => {
                    const field = comparisonForKey(result, col.key)
                    const outcome = field ? comparisonOutcome(field) : 'REVIEW'
                    return (
                      <TableCell key={col.key} align="center">
                        <CompareOutcomeChip outcome={outcome} />
                      </TableCell>
                    )
                  })}
                  <TableCell sx={{ fontSize: '11px', fontWeight: 600, maxWidth: 200 }}>
                    {buildVerdictReason(result)}
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      variant="outlined"
                      onClick={() => setViewResult(result)}
                      sx={liveOutputControlBtnSx}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
        <Pagination
          totalItems={displayOrder.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageSizeChange={(next) => {
            setPageSize(next)
            setPage(1)
          }}
          boundaryCount={3}
        />
      </Paper>

      <ComparisonDialog open={Boolean(viewResult)} result={viewResult} onClose={() => setViewResult(null)} />
    </PageFrame>
  )
}
