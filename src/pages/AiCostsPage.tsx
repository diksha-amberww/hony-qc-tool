import { useEffect, useMemo, useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Paper,
  Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { PageFrame } from '../components/layout/PageFrame'
import { ConfirmDialog } from '../components/confirm'
import { useAiUsage } from '../context/AiUsageContext'
import { useBatchDemo } from '../context/BatchDemoContext'
import { useSettings } from '../context/SettingsContext'
import { AI_QC_MODEL_DISPLAY_NAME } from '../config/aiQc'
import { formatUsd, tokenCostUsd } from '../utils/aiPricing'
import { fontFamilyMono } from '../theme/typography'

function sectionPaperSx() {
  return {
    p: { xs: 2, md: 2.5 },
    borderRadius: 1,
    border: '1px solid',
    borderColor: 'divider',
    bgcolor: (theme: { palette: { mode: string } }) =>
      theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.03)' : 'background.paper',
  }
}

function metricCardSx() {
  return {
    p: { xs: 1.75, md: 2 },
    borderRadius: 1,
    border: '1px solid',
    borderColor: 'divider',
    bgcolor: (theme: { palette: { mode: string } }) =>
      theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.35)' : 'action.hover',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
  }
}

function CostMetric({
  label,
  value,
  valueSize = '22px',
  align = 'left',
}: {
  label: string
  value: string
  valueSize?: string
  align?: 'left' | 'center'
}) {
  return (
    <Box sx={{ ...metricCardSx(), textAlign: align }}>
      <Typography
        sx={{
          fontSize: '10px',
          fontWeight: 700,
          letterSpacing: '0.06em',
          color: 'text.secondary',
          lineHeight: 1.3,
        }}
      >
        {label.toUpperCase()}
      </Typography>
      <Typography
        sx={{
          fontSize: valueSize,
          fontWeight: 700,
          mt: 0.75,
          fontFamily: fontFamilyMono,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.02em',
        }}
      >
        {value}
      </Typography>
    </Box>
  )
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <Box>
      <Typography
        sx={{
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: 'text.secondary',
        }}
      >
        {title}
      </Typography>
      <Typography sx={{ fontSize: '12px', color: 'text.secondary', mt: 0.5, maxWidth: 720, lineHeight: 1.45 }}>
        {description}
      </Typography>
    </Box>
  )
}

export function AiCostsPage() {
  const { completed, total, running } = useBatchDemo()
  const { settings } = useSettings()
  const {
    allTimeInputTokens,
    allTimeOutputTokens,
    allTimeCostUsd,
    sessionInputTokens,
    sessionOutputTokens,
    sessionSkus,
    sessionCostUsd,
    resetSessionUsage,
    resetAllTimeUsage,
  } = useAiUsage()
  const [resetLifetimeOpen, setResetLifetimeOpen] = useState(false)
  const [resetSessionOpen, setResetSessionOpen] = useState(false)
  const [byLabel, setByLabel] = useState<
    Record<string, { inputTokens: number; outputTokens: number; calls: number }>
  >({})

  useEffect(() => {
    void window.electronAPI?.qc?.getAiUsageMetrics?.().then((res) => {
      if (res?.ok && res.metrics?.byLabel) {
        setByLabel(res.metrics.byLabel)
      }
    })
  }, [sessionSkus, sessionInputTokens, sessionOutputTokens])

  const ratesLabel = `$${settings.aiInputPricePerMillionUsd}/M input · $${settings.aiOutputPricePerMillionUsd}/M output`

  const { inputTokens, outputTokens, batchCost, skuCount } = useMemo(() => {
    let input = 0
    let output = 0
    completed.forEach((r) => {
      input += r.inputTokens ?? 0
      output += r.outputTokens ?? 0
    })
    return {
      inputTokens: input,
      outputTokens: output,
      batchCost: tokenCostUsd(input, output, settings),
      skuCount: completed.length,
    }
  }, [completed, settings])

  const perSku = skuCount > 0 ? batchCost / skuCount : 0
  const per1000 = perSku * 1000
  const per10000 = perSku * 10000

  const sessionPerSku = sessionSkus > 0 ? sessionCostUsd / sessionSkus : 0

  const hasAdvanced =
    sessionSkus > 0 ||
    sessionInputTokens > 0 ||
    sessionOutputTokens > 0 ||
    Object.keys(byLabel).length > 0

  return (
    <PageFrame
      title="AI costs"
      subtitle={`${AI_QC_MODEL_DISPLAY_NAME} · ${ratesLabel}`}
      actions={
        <Typography
          sx={{
            fontSize: '12px',
            color: running ? 'primary.main' : 'text.secondary',
            fontWeight: 600,
            fontFamily: fontFamilyMono,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {skuCount} / {total} SKUs in current run
        </Typography>
      }
    >
      <Paper sx={sectionPaperSx()}>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 1.5,
            flexWrap: 'wrap',
            mb: 2,
          }}
        >
          <SectionHeading
            title="LIVE RUN DETAILS"
            description="Current QC batch usage from completed SKUs. Totals update as each AI comparison finishes."
          />
          <Button
            variant="outlined"
            size="small"
            color="inherit"
            onClick={() => setResetSessionOpen(true)}
            sx={{
              height: 32,
              fontSize: '11px',
              fontWeight: 600,
              borderRadius: 1,
              flexShrink: 0,
              borderColor: 'divider',
              color: 'text.secondary',
            }}
          >
            Reset metrics
          </Button>
        </Box>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, 1fr)',
              md: 'repeat(3, 1fr)',
              lg: 'repeat(5, 1fr)',
            },
            gap: 1.5,
          }}
        >
          <CostMetric label="Input tokens" value={inputTokens.toLocaleString()} />
          <CostMetric label="Output tokens" value={outputTokens.toLocaleString()} />
          <CostMetric label="Cost incurred (USD)" value={formatUsd(batchCost)} valueSize="20px" />
          <CostMetric
            label="Est. ×1,000 SKUs (USD)"
            value={skuCount > 0 ? formatUsd(per1000) : '—'}
          />
          <CostMetric
            label="Est. ×10,000 SKUs (USD)"
            value={skuCount > 0 ? formatUsd(per10000) : '—'}
          />
        </Box>
      </Paper>

      <Paper sx={sectionPaperSx()}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 1.5,
            flexWrap: 'wrap',
            mb: 2.5,
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <SectionHeading
              title="LIFETIME AI COSTS"
              description="Cumulative AI tokens recorded by the QC engine (Live Output batch + Sandbox). Updates live as SKUs finish."
            />
          </Box>
          <Button
            variant="outlined"
            size="small"
            color="inherit"
            onClick={() => setResetLifetimeOpen(true)}
            sx={{
              height: 32,
              fontSize: '11px',
              fontWeight: 600,
              borderRadius: 1,
              flexShrink: 0,
              borderColor: 'divider',
              color: 'text.secondary',
              mt: 0.25,
            }}
          >
            Reset lifetime costs
          </Button>
        </Box>

        <Box sx={{ mb: 2.5 }}>
          <Typography
            sx={{
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.06em',
              color: 'text.secondary',
            }}
          >
            LIFETIME AI COSTS INCURRED (USD)
          </Typography>
          <Typography
            sx={{
              fontSize: { xs: '32px', md: '40px' },
              fontWeight: 700,
              mt: 0.5,
              fontFamily: fontFamilyMono,
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.03em',
            }}
          >
            {formatUsd(allTimeCostUsd)}
          </Typography>
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
            gap: 1.5,
          }}
        >
          <CostMetric
            label="Lifetime input tokens"
            value={allTimeInputTokens.toLocaleString()}
            valueSize="24px"
          />
          <CostMetric
            label="Lifetime output tokens"
            value={allTimeOutputTokens.toLocaleString()}
            valueSize="24px"
          />
        </Box>
      </Paper>

      {hasAdvanced ? (
        <Accordion
          disableGutters
          elevation={0}
          sx={{
            ...sectionPaperSx(),
            '&:before': { display: 'none' },
            overflow: 'hidden',
          }}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon fontSize="small" />}
            sx={{
              minHeight: 48,
              px: 0,
              '& .MuiAccordionSummary-content': { my: 1 },
            }}
          >
            <Typography sx={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', color: 'text.secondary' }}>
              SESSION & CALL BREAKDOWN
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 0, pt: 0, pb: 0.5 }}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
                gap: 1.5,
                mb: Object.keys(byLabel).length > 0 ? 2 : 0,
              }}
            >
              <CostMetric label="Session SKUs" value={sessionSkus.toLocaleString()} valueSize="18px" />
              <CostMetric
                label="Session input tokens"
                value={sessionInputTokens.toLocaleString()}
                valueSize="18px"
              />
              <CostMetric
                label="Session output tokens"
                value={sessionOutputTokens.toLocaleString()}
                valueSize="18px"
              />
              <CostMetric label="Session cost (USD)" value={formatUsd(sessionCostUsd)} valueSize="18px" />
              <CostMetric
                label="Session cost / SKU"
                value={sessionSkus > 0 ? formatUsd(sessionPerSku) : '—'}
                valueSize="18px"
              />
              <CostMetric label="SKUs processed (batch)" value={skuCount.toLocaleString()} valueSize="18px" />
            </Box>

            {Object.keys(byLabel).length > 0 ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {Object.entries(byLabel)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([label, row]) => {
                    const cost = tokenCostUsd(row.inputTokens, row.outputTokens, settings)
                    return (
                      <Box
                        key={label}
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: { xs: '1fr', sm: '2fr repeat(3, 1fr)' },
                          gap: 1,
                          alignItems: 'center',
                          py: 1,
                          px: 1.5,
                          borderRadius: 1,
                          border: '1px solid',
                          borderColor: 'divider',
                          bgcolor: (theme) =>
                            theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.25)' : 'action.hover',
                        }}
                      >
                        <Typography sx={{ fontSize: '12px', fontWeight: 600 }}>{label}</Typography>
                        <Typography sx={{ fontSize: '11px', fontFamily: fontFamilyMono }}>
                          {row.calls} calls
                        </Typography>
                        <Typography sx={{ fontSize: '11px', fontFamily: fontFamilyMono }}>
                          {row.inputTokens.toLocaleString()} in / {row.outputTokens.toLocaleString()} out
                        </Typography>
                        <Typography sx={{ fontSize: '11px', fontFamily: fontFamilyMono, fontWeight: 600 }}>
                          {formatUsd(cost)}
                        </Typography>
                      </Box>
                    )
                  })}
              </Box>
            ) : null}
          </AccordionDetails>
        </Accordion>
      ) : null}

      <ConfirmDialog
        open={resetSessionOpen}
        title="Reset batch metrics?"
        message="Clears session token counters in the app and resets terminal running-cost metrics. Completed SKUs in the live run table are not removed."
        confirmLabel="Reset metrics"
        cancelLabel="Cancel"
        onClose={() => setResetSessionOpen(false)}
        onConfirm={() => {
          resetSessionUsage()
          setResetSessionOpen(false)
        }}
      />

      <ConfirmDialog
        open={resetLifetimeOpen}
        title="Reset lifetime AI costs?"
        message="This permanently clears all persisted lifetime token totals and recalculates lifetime cost to $0.00. The current live run is not changed."
        confirmLabel="Reset lifetime data"
        cancelLabel="Keep lifetime totals"
        confirmColor="error"
        onClose={() => setResetLifetimeOpen(false)}
        onConfirm={resetAllTimeUsage}
      >
        <Alert severity="warning" sx={{ mt: 1.5, borderRadius: 0.5, fontSize: '11px', py: 0.25 }}>
          Warning: lifetime AI cost and token history will be erased. This cannot be undone.
        </Alert>
      </ConfirmDialog>
    </PageFrame>
  )
}
