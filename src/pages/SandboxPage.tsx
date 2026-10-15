import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import { PageFrame } from '../components/layout/PageFrame'
import { InputFieldChipSelect } from '../components/input/InputFieldChipSelect'
import { RawScrapeComparePair, SandboxQcComparisons, SandboxScrollReveal } from '../components/sandbox'
import { CopyLogTextButton } from '../components/logs'
import { QcVerdictChip } from '../components/status'
import { useToast } from '../components/toast'
import { useAiUsage } from '../context/AiUsageContext'
import { useBatchDemo } from '../context/BatchDemoContext'
import { useLogs } from '../context/LogsContext'
import { useSettings } from '../context/SettingsContext'
import { useSandboxRun } from '../context/SandboxRunContext'
import { useAppTheme } from '../theme'
import { fontFamilyMono } from '../theme/typography'
import {
  AVAILABLE_INPUT_FIELDS,
  fieldsFromIds,
  loadSavedFieldIds,
  loadSandboxFieldIds,
  saveSandboxFieldIds,
  type InputFieldDef,
} from '../data/inputFields'
import { type SandboxQcResult, type SandboxTerminalLine } from '../data/sandboxQc'
import { VENDOR_INTEGRATION_ID } from '../config/vendorIntegration'
import { buildFailedQcResult } from '../services/qc/listingQcMapper'
import { revealQcExportFile, runQcPipelineExport } from '../services/qc/qcPipelineApi'
import { pipelineSuccessToSandboxQcResult } from '../services/qc/qcPipelineMapper'
import { useLiveOutput } from '../context/LiveOutputContext'
import { sandboxQcResultToQcResult } from '../services/qc/sandboxToQcResult'
import { formatUsd } from '../utils/aiPricing'
import { getLogCategoryTone } from '../utils/logCategoryStyles'
import {
  buildSandboxSampleValues,
  buildSandboxValuesPlaceholder,
  parseSandboxValuesOnly,
} from '../utils/sandboxParse'
import type { QcLogEntry } from '../types/log'

const COLUMN_WIDTH_CH = 14

const TERMINAL_LEVELS = new Set<SandboxTerminalLine['level']>([
  'SYSTEM',
  'SCRAPING',
  'AI',
  'QC',
  'ERROR',
  'WARNING',
  'INFO',
])

function logCategoryToTerminalLevel(category: string): SandboxTerminalLine['level'] {
  const upper = category.toUpperCase()
  if (TERMINAL_LEVELS.has(upper as SandboxTerminalLine['level'])) {
    return upper as SandboxTerminalLine['level']
  }
  return 'INFO'
}

function inferRunStatusFromLog(message: string): { label: string; progress?: number } {
  const m = message.toLowerCase()
  if (m.includes('amazon') && m.includes('started')) {
    return { label: 'Fetching Amazon data...', progress: 12 }
  }
  if (m.includes('amazon') && m.includes('completed')) {
    return { label: 'Amazon catalog data ready', progress: 28 }
  }
  if (m.includes('vendor website scrape started') || m.includes('vendor scrape started')) {
    return { label: 'Scraping vendor site...', progress: 38 }
  }
  if (m.includes('vendor website scrape completed') || m.includes('vendor scrape completed')) {
    return { label: 'Vendor scrape complete', progress: 52 }
  }
  if (m.includes('qc comparison started')) {
    return { label: 'Running QC checks...', progress: 62 }
  }
  if (m.includes('qc comparison finished')) {
    return { label: 'QC checks complete', progress: 78 }
  }
  if (m.includes('writing excel') || m.includes('excel qc report')) {
    return { label: 'Generating Excel report...', progress: 88 }
  }
  if (m.includes('search results page loaded')) {
    return { label: 'Scraping vendor site...', progress: 45 }
  }
  return { label: message }
}

function sandboxTerminalClipboardText(
  lines: Array<{ level: string; text: string }>,
): string {
  return lines.map((line) => `[${line.level}] ${line.text}`).join('\n')
}

/** Single-SKU paste — fixed one-line height so the row never gets clipped under the terminal. */
const pasteInputSx = {
  width: '100%',
  bgcolor: 'background.paper',
  '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
  '& .MuiInputBase-root': {
    width: '100%',
    fontFamily: fontFamilyMono,
    fontSize: '12px',
    fontWeight: 600,
    borderRadius: 0,
    alignItems: 'center',
    bgcolor: 'background.paper',
    color: 'text.primary',
    tabSize: COLUMN_WIDTH_CH,
    MozTabSize: COLUMN_WIDTH_CH,
    minHeight: 40,
  },
  '& .MuiInputBase-input': {
    width: '100% !important',
    boxSizing: 'border-box',
    px: 1.5,
    py: 1.15,
    lineHeight: 1.45,
    whiteSpace: 'pre',
    overflowX: 'auto',
    overflowY: 'hidden',
    bgcolor: 'background.paper',
    color: 'text.primary',
    tabSize: COLUMN_WIDTH_CH,
    MozTabSize: COLUMN_WIDTH_CH,
    WebkitTextFillColor: 'inherit',
    '&.Mui-disabled': {
      WebkitTextFillColor: 'inherit',
      opacity: 0.9,
    },
  },
} as const

const TabularColumnHeader = memo(function TabularColumnHeader({
  fields,
}: {
  fields: InputFieldDef[]
}) {
  if (fields.length === 0) return null
  const tableWidthCh = fields.length * COLUMN_WIDTH_CH
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box
        component="table"
        sx={{
          width: `${tableWidthCh}ch`,
          tableLayout: 'fixed',
          borderCollapse: 'collapse',
          fontFamily: fontFamilyMono,
          fontSize: '11px',
          '& th': {
            width: `${COLUMN_WIDTH_CH}ch`,
            maxWidth: `${COLUMN_WIDTH_CH}ch`,
            fontFamily: fontFamilyMono,
            fontSize: '11px',
            fontWeight: 500,
            letterSpacing: '0.04em',
            lineHeight: 1.5,
            textAlign: 'left',
            verticalAlign: 'middle',
            // Muted label — clearly distinct from the brighter paste values below
            color: 'text.secondary',
            px: 0,
            py: 0.85,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        }}
      >
        <Box component="colgroup">
          {fields.map((field) => (
            <Box component="col" key={field.id} sx={{ width: `${COLUMN_WIDTH_CH}ch` }} />
          ))}
        </Box>
        <Box component="thead">
          <Box component="tr">
            {fields.map((field) => (
              <Box component="th" key={field.id} scope="col" title={field.label}>
                {field.label}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  )
})

const TerminalLineRow = memo(function TerminalLineRow({
  line,
  isDark,
}: {
  line: SandboxTerminalLine
  isDark: boolean
}) {
  const tone = getLogCategoryTone(line.level, isDark)
  const time = new Date(line.at).toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  return (
    <Box
      className="animate-fade-in"
      sx={{
        display: 'grid',
        gridTemplateColumns: '64px 88px minmax(0, 1fr)',
        gap: 1,
        alignItems: 'start',
        px: 1.25,
        py: 0.55,
        borderBottom: '1px solid',
        borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'divider',
        fontFamily: fontFamilyMono,
        fontSize: '11px',
        lineHeight: 1.45,
      }}
    >
      <Typography
        component="span"
        sx={{ fontSize: '11px', fontFamily: fontFamilyMono, color: 'text.secondary', whiteSpace: 'nowrap' }}
      >
        {time}
      </Typography>
      <Chip
        size="small"
        label={line.level}
        sx={{
          height: 18,
          maxWidth: '100%',
          fontSize: '9px',
          fontWeight: 700,
          borderRadius: 0.5,
          border: '1px solid',
          borderColor: tone.border,
          bgcolor: tone.bg,
          color: tone.text,
          '& .MuiChip-label': { px: 0.6 },
        }}
      />
      <Typography
        sx={{
          fontSize: '11px',
          fontFamily: fontFamilyMono,
          color: isDark ? '#e4e4e7' : 'text.primary',
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {line.text}
      </Typography>
    </Box>
  )
})

export function SandboxPage() {
  const { showToast } = useToast()
  const { recordUsage } = useAiUsage()
  const { appendLog } = useLogs()
  const { settings } = useSettings()
  const { mode } = useAppTheme()
  const isDark = mode === 'dark'

  const [draftIds, setDraftIds] = useState<string[]>(() => loadSandboxFieldIds())
  const [savedIds, setSavedIds] = useState<string[]>(() => loadSandboxFieldIds())
  const savedFields = useMemo(() => fieldsFromIds(savedIds), [savedIds])

  const initialPaste = useMemo(
    () => buildSandboxSampleValues(fieldsFromIds(loadSandboxFieldIds())),
    [],
  )
  const [pasteDefault, setPasteDefault] = useState(initialPaste)
  const [pasteResetKey, setPasteResetKey] = useState(0)
  const pasteInputRef = useRef<HTMLTextAreaElement | null>(null)
  const pasteTextRef = useRef(initialPaste)

  const {
    running,
    setRunning,
    runStatusMessage,
    setRunStatusMessage,
    runProgress,
    setRunProgress,
    terminalLines,
    setTerminalLines,
    qcResult,
    setQcResult,
    showResults,
    setShowResults,
    runErrors: errors,
    setRunErrors: setErrors,
    clearTimers,
    bumpRunGeneration,
  } = useSandboxRun()
  const { appendRow: appendLiveOutputRow } = useLiveOutput()
  const { registerExportResult, purgeQcResultsForExport } = useBatchDemo()
  const { logs } = useLogs()

  const terminalRef = useRef<HTMLDivElement | null>(null)
  const liveOutputSectionRef = useRef<HTMLDivElement | null>(null)
  const runLogBaselineRef = useRef(0)
  const activeSandboxRunGenRef = useRef(0)

  const pushTerminalLine = useCallback(
    (level: SandboxTerminalLine['level'], text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      setTerminalLines((prev) => [
        ...prev,
        {
          id: `term-${Date.now()}-${prev.length}`,
          at: Date.now(),
          level,
          text: trimmed,
        },
      ])
      const status = inferRunStatusFromLog(trimmed)
      setRunStatusMessage(status.label)
      if (typeof status.progress === 'number') {
        setRunProgress(status.progress)
      }
    },
    [setRunProgress, setRunStatusMessage, setTerminalLines],
  )

  const pushVendorLogText = useCallback(
    (vendorLog?: string) => {
      if (!vendorLog?.trim()) return
      for (const line of vendorLog.split('\n')) {
        const trimmed = line.trim()
        if (trimmed) pushTerminalLine('SCRAPING', trimmed)
      }
    },
    [pushTerminalLine],
  )
  const [excelExportPath, setExcelExportPath] = useState<string | null>(null)

  const draftDirty = useMemo(
    () => draftIds.join('\0') !== savedIds.join('\0'),
    [draftIds, savedIds],
  )

  useEffect(() => {
    const el = terminalRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [terminalLines, runStatusMessage])

  const applyLogToRunUi = useCallback(
    (entry: QcLogEntry) => {
      const text = entry.detail ? `${entry.message} · ${entry.detail}` : entry.message
      setTerminalLines((prev) => [
        ...prev,
        {
          id: entry.id,
          at: entry.at,
          level: logCategoryToTerminalLevel(entry.category),
          text,
        },
      ])
      const status = inferRunStatusFromLog(entry.message)
      setRunStatusMessage(status.label)
      if (typeof status.progress === 'number') {
        setRunProgress(status.progress)
      }
    },
    [setRunProgress, setRunStatusMessage, setTerminalLines],
  )

  useEffect(() => {
    if (!running) return
    for (let i = runLogBaselineRef.current; i < logs.length; i += 1) {
      applyLogToRunUi(logs[i])
    }
    runLogBaselineRef.current = logs.length
  }, [logs, running, applyLogToRunUi])

  const syncPasteText = useCallback(() => {
    const el = pasteInputRef.current
    if (el) pasteTextRef.current = el.value
  }, [])

  const toggleDraft = useCallback((id: string) => {
    setDraftIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      return [...prev, id]
    })
  }, [])

  const applySavedFields = useCallback(
    (ordered: string[], toastMessage: string) => {
      saveSandboxFieldIds(ordered)
      setSavedIds(ordered)
      setDraftIds(ordered)
      const nextFields = fieldsFromIds(ordered)
      const sample = buildSandboxSampleValues(nextFields)
      pasteTextRef.current = sample
      setPasteDefault(sample)
      setPasteResetKey((k) => k + 1)
      setErrors([])
      setQcResult(null)
      setShowResults(false)
      setTerminalLines([])
      setExcelExportPath(null)
      showToast(toastMessage, 'success')
    },
    [showToast],
  )

  const handleSaveFields = () => {
    if (draftIds.length === 0) {
      showToast('Select at least one field', 'warning')
      return
    }
    const ordered = draftIds.filter((id) => Boolean(AVAILABLE_INPUT_FIELDS.find((f) => f.id === id)))
    applySavedFields(ordered, 'Sandbox columns saved')
  }

  const handleAutoCopyFromUpload = () => {
    const uploadIds = loadSavedFieldIds()
    if (uploadIds.length === 0) {
      showToast('Upload has no saved columns to copy', 'warning')
      return
    }
    applySavedFields(uploadIds, 'Copied columns from Upload')
  }

  const finishSandboxRun = useCallback(
    (result: SandboxQcResult) => {
      const qcRow = sandboxQcResultToQcResult(result)
      appendLiveOutputRow(qcRow, 'sandbox')
      registerExportResult({ ...qcRow, runSource: 'sandbox' })
      setQcResult(result)
      setShowResults(true)
      setRunProgress(100)
      setRunStatusMessage('QC run complete')
      setTerminalLines((prev) => [
        ...prev,
        {
          id: `done-${Date.now()}`,
          at: Date.now(),
          level: result.verdict === 'FAIL' ? 'ERROR' : result.verdict === 'MANUAL_REVIEW' ? 'WARNING' : 'QC',
          text: `Final verdict: ${result.verdict.replace(/_/g, ' ')}`,
        },
      ])

      if (result.inputTokens > 0 || result.outputTokens > 0) {
        recordUsage(result.inputTokens, result.outputTokens)
      }

      const sku = result.identity.find((f) => f.key === 'sku')?.value ?? result.identity[0]?.value
      if (result.verdict === 'FAIL') {
        appendLog({ category: 'ERROR', message: `Sandbox FAIL — ${sku}` })
      } else if (result.verdict === 'MANUAL_REVIEW') {
        appendLog({ category: 'WARNING', message: `Sandbox MANUAL REVIEW — ${sku}` })
      } else {
        appendLog({ category: 'QC', message: `Sandbox PASS — ${sku}` })
      }
      showToast(
        `Sandbox ${result.verdict.replace(/_/g, ' ')}`,
        result.verdict === 'PASS' ? 'success' : 'warning',
      )
    },
    [
      appendLiveOutputRow,
      registerExportResult,
      appendLog,
      recordUsage,
      setQcResult,
      setRunProgress,
      setRunStatusMessage,
      setShowResults,
      setTerminalLines,
      showToast,
    ],
  )

  const handleRun = async () => {
    if (running) return
    if (savedFields.length === 0) {
      setErrors(['Save column configuration before running Sandbox QC'])
      return
    }

    syncPasteText()
    const raw = pasteInputRef.current?.value ?? pasteTextRef.current
    const { row, errors: parseErrors } = parseSandboxValuesOnly(raw, savedFields)
    if (!row || parseErrors.length > 0) {
      setErrors(parseErrors)
      setQcResult(null)
      setShowResults(false)
      setTerminalLines([])
      return
    }

    clearTimers()
    const gen = bumpRunGeneration()

    setErrors([])
    setQcResult(null)
    setShowResults(false)
    setExcelExportPath(null)
    setRunning(true)
    setRunProgress(4)
    setRunStatusMessage('Starting QC pipeline...')
    runLogBaselineRef.current = logs.length
    setTerminalLines([
      {
        id: `start-${Date.now()}`,
        at: Date.now(),
        level: 'SYSTEM',
        text: 'Sandbox QC run started — streaming live steps below.',
      },
    ])

    requestAnimationFrame(() => {
      liveOutputSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })

    appendLog({
      category: 'SYSTEM',
      message: 'Sandbox QC started',
      detail: savedFields.map((f) => row[f.id] ?? '').filter(Boolean).join(' · '),
    })

    const qcBridge = window.electronAPI?.qc
    activeSandboxRunGenRef.current = gen

    const unsubAppLog = window.electronAPI?.onAppLog?.((payload) => {
      if (activeSandboxRunGenRef.current !== gen) return
      const message = String(payload?.message ?? '').trim()
      if (!message) return
      const detail = payload?.detail ? String(payload.detail).trim() : ''
      const text = detail ? `${message} · ${detail}` : message
      pushTerminalLine(logCategoryToTerminalLevel(String(payload?.category ?? 'INFO')), text)
    })

    try {
      if (!qcBridge?.runPipelineExport) {
        setErrors(['Sandbox QC requires the Electron app (qc:runPipelineExport).'])
        pushTerminalLine('ERROR', 'QC pipeline IPC is not available in this environment.')
        setRunStatusMessage('QC run failed')
        return
      }

      pushTerminalLine('SYSTEM', 'Pipeline: runQcPipelineExport (SP-API → vendor scrape → QC → Excel)')
      setRunStatusMessage('Fetching Amazon data...')

      const pipeline = await runQcPipelineExport({
        row,
        rowIndex: 0,
        headless: settings.headlessScraping,
        vendorId: VENDOR_INTEGRATION_ID,
        settings: {
          titleSimilarityPercent: settings.titleSimilarityPercent,
          imageSimilarityPercent: settings.imageSimilarityPercent,
          qcTitleLexicalHybrid: settings.qcTitleLexicalHybrid,
          qcAggressiveAiCostMode: settings.qcAggressiveAiCostMode,
          qcModelAiEnabled: settings.qcModelAiEnabled,
          aiQcModelId: settings.aiQcModelId,
          aiInputPricePerMillionUsd: settings.aiInputPricePerMillionUsd,
          aiOutputPricePerMillionUsd: settings.aiOutputPricePerMillionUsd,
        },
      })

      if (!pipeline.ok) {
        pushVendorLogText(pipeline.vendorLog)
        const failedRow = { ...buildFailedQcResult(row, pipeline.error), runSource: 'sandbox' as const }
        appendLiveOutputRow(failedRow, 'sandbox')
        registerExportResult(failedRow)
        setErrors([pipeline.error])
        setQcResult(null)
        setShowResults(false)
        pushTerminalLine('ERROR', pipeline.error ?? 'QC pipeline failed.')
        setRunStatusMessage('QC run failed')
        return
      }

      setExcelExportPath(pipeline.excelFilePath)
      finishSandboxRun(pipelineSuccessToSandboxQcResult(pipeline))
      return
    } finally {
      unsubAppLog?.()
      activeSandboxRunGenRef.current = 0
      setRunning(false)
    }
  }

  const handleClear = () => {
    clearTimers()
    bumpRunGeneration()
    setRunning(false)
    setRunStatusMessage('')
    setRunProgress(0)
    setTerminalLines([])
    setQcResult(null)
    setShowResults(false)
    setErrors([])
    setExcelExportPath(null)
    purgeQcResultsForExport('sandbox')
  }

  const placeholder =
    savedFields.length > 0
      ? buildSandboxValuesPlaceholder(savedFields)
      : 'Save columns first — paste values only (no headers)'

  return (
    <PageFrame
      title="Sandbox"
      subtitle="Single-SKU QC lab · SP-API + vendor scrape + AI QC · Excel test export · live terminal."
      actions={
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            onClick={handleClear}
            disabled={running || (terminalLines.length === 0 && !showResults)}
            sx={{ height: 32, fontSize: '12px', borderRadius: 0.5 }}
          >
            Clear
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleRun()}
            disabled={running || savedFields.length === 0}
            startIcon={
              running ? <CircularProgress size={14} thickness={5} color="inherit" /> : undefined
            }
            sx={{
              height: 32,
              fontSize: '12px',
              borderRadius: 0.5,
              boxShadow: 'none',
              minWidth: 108,
            }}
          >
            {running ? 'Running…' : 'Run QC'}
          </Button>
          {showResults && qcResult && !running && (
            <QcVerdictChip verdict={qcResult.verdict} density="compact" />
          )}
        </Box>
      }
    >
      {/* Column configurator — compact */}
      <Paper
        sx={{
          p: 2,
          borderRadius: 2,
          border: '1px solid',
          borderColor: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(15,23,42,0.08)',
          bgcolor: isDark ? '#141416' : '#ffffff',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: { xs: 'flex-start', sm: 'center' },
            justifyContent: 'space-between',
            gap: 1.25,
            flexWrap: 'wrap',
            mb: 1.5,
          }}
        >
          <Box>
            <Typography sx={{ fontSize: '14px', fontWeight: 650, letterSpacing: '-0.01em' }}>
              Column Configurator
            </Typography>
            <Typography sx={{ fontSize: '12px', color: 'text.secondary', mt: 0.3 }}>
              Defines paste value order. Headers are not accepted.
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<ContentCopyOutlinedIcon sx={{ fontSize: 14 }} />}
              onClick={handleAutoCopyFromUpload}
              disabled={running}
              sx={{
                height: 32,
                fontSize: '12px',
                fontWeight: 600,
                textTransform: 'none',
                borderRadius: 1.75,
                px: 1.25,
              }}
            >
              Auto Copy from Upload
            </Button>
            <Button
              variant="contained"
              size="small"
              onClick={handleSaveFields}
              disabled={draftIds.length === 0 || !draftDirty || running}
              sx={{
                height: 32,
                fontSize: '12px',
                fontWeight: 600,
                textTransform: 'none',
                borderRadius: 1.75,
                boxShadow: 'none',
                px: 1.5,
              }}
            >
              Save
            </Button>
          </Box>
        </Box>
        <Box
          sx={{
            p: 1.35,
            borderRadius: 2,
            border: '1px solid',
            borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)',
            bgcolor: isDark ? 'rgba(0,0,0,0.18)' : 'rgba(15,23,42,0.025)',
          }}
        >
          <InputFieldChipSelect
            fields={AVAILABLE_INPUT_FIELDS}
            selectedIds={draftIds}
            onToggle={toggleDraft}
            disabled={running}
            compact
          />
        </Box>
      </Paper>

      {errors.length > 0 && (
        <Alert severity="error" sx={{ borderRadius: 0.5, '& .MuiAlert-message': { fontSize: '12px' } }}>
          {errors.map((e, i) => (
            <Box key={`${i}-${e.slice(0, 40)}`}>{e}</Box>
          ))}
        </Alert>
      )}

      {/*
        Stacked workspace (rows): SKU input on top, terminal below.
        Input stays a fixed compact band; terminal scrolls in its own pane — no overlap.
      */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          minWidth: 0,
        }}
      >
        {/* SKU input — full-width row, fixed height so values never get hidden */}
        <Paper
          sx={{
            borderRadius: 0.5,
            border: '1px solid',
            borderColor: 'divider',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            flexShrink: 0,
            opacity: savedFields.length === 0 ? 0.65 : 1,
          }}
        >
          <Box
            sx={{
              px: 1.5,
              py: 0.85,
              borderBottom: '1px solid',
              borderColor: 'divider',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              flexShrink: 0,
              bgcolor: isDark ? 'rgba(0,0,0,0.22)' : 'action.hover',
            }}
          >
            <Typography sx={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em' }}>
              SKU INPUT
            </Typography>
            <Typography sx={{ fontSize: '10px', fontWeight: 700, color: 'text.secondary', letterSpacing: '0.04em' }}>
              1 ROW · VALUES ONLY
            </Typography>
          </Box>

          <Box
            sx={{
              px: 1.5,
              py: 0.75,
              borderBottom: '1px solid',
              borderColor: 'divider',
              flexShrink: 0,
              overflowX: 'auto',
            }}
          >
            {savedFields.length === 0 ? (
              <Typography sx={{ fontSize: '12px', color: 'text.secondary' }}>
                Save columns to show the expected value order
              </Typography>
            ) : (
              <TabularColumnHeader fields={savedFields} />
            )}
          </Box>

          <Box sx={{ flexShrink: 0 }}>
            <TextField
              key={pasteResetKey}
              multiline
              minRows={1}
              maxRows={1}
              fullWidth
              defaultValue={pasteDefault}
              inputRef={pasteInputRef}
              onInput={syncPasteText}
              placeholder={placeholder}
              disabled={savedFields.length === 0 || running}
              sx={pasteInputSx}
            />
          </Box>
        </Paper>

        {/* Terminal — full-width row under SKU input; scrolls internally */}
        <Paper
          ref={liveOutputSectionRef}
          sx={{
            borderRadius: 0.5,
            border: '1px solid',
            borderColor: running ? 'primary.main' : 'divider',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            height: { xs: 260, md: 300 },
            flexShrink: 0,
            transition: 'border-color 0.2s ease',
          }}
        >
          <Box
            sx={{
              px: 1.5,
              py: 0.85,
              borderBottom: '1px solid',
              borderColor: 'divider',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
              bgcolor: isDark ? 'rgba(0,0,0,0.35)' : 'action.hover',
              gap: 1,
              flexWrap: 'wrap',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em' }}>
                TERMINAL · LIVE QC OUTPUT
              </Typography>
              {running && (
                <Chip
                  size="small"
                  label="RUNNING"
                  color="primary"
                  sx={{ height: 20, fontSize: '9px', fontWeight: 800, borderRadius: 0.5 }}
                />
              )}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography sx={{ fontSize: '10px', color: 'text.secondary', fontFamily: fontFamilyMono }}>
                {running
                  ? runStatusMessage || 'Working…'
                  : terminalLines.length > 0
                    ? `${terminalLines.length} lines`
                    : 'idle'}
              </Typography>
              <CopyLogTextButton
                getText={() => sandboxTerminalClipboardText(terminalLines)}
                copyTooltip="Copy terminal log (scraping + AI + QC)"
                emptyTooltip="Run QC first — no terminal lines yet"
                onCopied={() => showToast('Terminal log copied', 'success')}
                onCopyFailed={() => showToast('No terminal log to copy', 'info')}
              />
            </Box>
          </Box>
          {running && (
            <Box sx={{ px: 1.5, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                <CircularProgress size={14} thickness={5} />
                <Typography sx={{ fontSize: '11px', fontWeight: 600, color: 'text.primary' }}>
                  {runStatusMessage || 'Processing…'}
                </Typography>
              </Box>
              <LinearProgress
                variant={runProgress > 0 ? 'determinate' : 'indeterminate'}
                value={runProgress > 0 ? runProgress : undefined}
                sx={{ height: 4, borderRadius: 1 }}
              />
            </Box>
          )}
          <Box
            ref={terminalRef}
            sx={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              bgcolor: isDark ? '#09090b' : '#fafafa',
              userSelect: 'text',
            }}
          >
            {terminalLines.length === 0 ? (
              <Typography
                sx={{ px: 1.5, py: 2, fontSize: '12px', color: 'text.secondary', fontFamily: fontFamilyMono }}
              >
                Press Run QC — live steps stream here below the SKU input row.
              </Typography>
            ) : (
              terminalLines.map((line) => (
                <TerminalLineRow key={line.id} line={line} isDark={isDark} />
              ))
            )}
          </Box>
        </Paper>
      </Box>

      {/* Final verdict strip */}
      {showResults && qcResult && (
        <Paper
          sx={{
            p: 1.5,
            borderRadius: 0.5,
            border: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1.5,
            flexWrap: 'wrap',
          }}
        >
          <Box>
            <Typography sx={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em', color: 'text.secondary' }}>
              FINAL VERDICT
            </Typography>
            <Typography sx={{ fontSize: '12px', color: 'text.secondary', mt: 0.25 }}>
              {qcResult.identity.map((f) => `${f.label}: ${f.value}`).join(' · ')}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {excelExportPath && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<FileDownloadOutlinedIcon sx={{ fontSize: 16 }} />}
                onClick={() => {
                  void revealQcExportFile(excelExportPath).then((res) => {
                    if (!res.ok) {
                      showToast('Could not open export folder', 'warning')
                    }
                  })
                }}
                sx={{ height: 32, fontSize: '12px', borderRadius: 0.5 }}
              >
                Open Excel report
              </Button>
            )}
            <QcVerdictChip verdict={qcResult.verdict} density="default" />
          </Box>
        </Paper>
      )}

      {/* Results: raw JSON on top, comparison table below (slides up on scroll) */}
      {showResults && qcResult && (
        <SandboxScrollReveal active={showResults}>
          <RawScrapeComparePair
            amazonData={qcResult.asinExtract}
            vendorData={qcResult.vendorExtract}
            asin={qcResult.asinExtract.asin}
            sku={qcResult.vendorExtract.sku}
            maxHeight={{ xs: 260, lg: 300 }}
            amazonEmptyMessage="No ASIN extract yet — run Sandbox QC"
            vendorEmptyMessage="No vendor extract yet — run Sandbox QC"
          />

          <SandboxQcComparisons
            comparisons={qcResult.comparisons}
            isDark={isDark}
            titleScore={qcResult.titleScore}
            imageScore={qcResult.imageScore}
          />

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' },
              gap: 1,
              minWidth: 0,
            }}
          >
            {[
              ['Input Tokens', qcResult.inputTokens.toLocaleString()],
              ['Output Tokens', qcResult.outputTokens.toLocaleString()],
              ['Cost (USD)', formatUsd(qcResult.costUsd)],
              ['Est. ×1000 Cost', formatUsd(qcResult.estimatedX1000Usd)],
            ].map(([label, value]) => (
              <Paper
                key={label}
                elevation={0}
                sx={{
                  p: 1.25,
                  borderRadius: 1.5,
                  border: '1px solid',
                  borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'divider',
                  minWidth: 0,
                  bgcolor: isDark ? '#0c0c0e' : 'background.paper',
                }}
              >
                <Typography
                  sx={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.04em', color: 'text.secondary' }}
                >
                  {label.toUpperCase()}
                </Typography>
                <Typography sx={{ fontSize: '15px', fontWeight: 700, mt: 0.35, fontFamily: fontFamilyMono }}>
                  {value}
                </Typography>
              </Paper>
            ))}
          </Box>
        </SandboxScrollReveal>
      )}
    </PageFrame>
  )
}
