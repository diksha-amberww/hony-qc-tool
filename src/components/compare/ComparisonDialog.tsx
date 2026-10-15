import { useMemo, useState, type ReactNode } from 'react'
import {
  Box,
  Dialog,
  IconButton,
  Link,
  Tab,
  Tabs,
  Typography,
  useTheme,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import type { QcResult, QcComparisonField } from '../../types/qc'
import type { AmazonListingExtract, VendorListingExtract } from '../../types/listingExtract'
import { useSettings } from '../../context/SettingsContext'
import { fontFamilyMono } from '../../theme/typography'
import { formatUsd, tokenCostUsd } from '../../utils/aiPricing'
import {
  comparisonForKey,
  comparisonOutcome,
  type ComparisonOutcomeContext,
  outcomeYesNoLabel,
} from '../../utils/liveOutputDisplay'
import {
  resolveImageSimilarityDisplayPercent,
  resolveTitleSimilarityDisplayPercent,
} from '../../utils/qcSimilarityDisplay'
import { QC_VERDICT_COMPARISON_KEYS } from '../../utils/qcVerdictKeys'
import { resolveQcImageUrls } from '../../utils/qcImages'
import { RawScrapeComparePair } from '../sandbox/RawScrapeComparePair'
import { QcVerdictChip } from '../status'
import { QcProductImage } from './QcProductImage'

type ComparisonDialogProps = {
  open: boolean
  result: QcResult | null
  onClose: () => void
}

const CORE_KEYS = ['title', 'brand', 'model', 'pack', 'image', 'upc'] as const

type DetailTab = 'identity' | 'packaging' | 'comparisons' | 'raw'

function identityValue(result: QcResult, key: string): string {
  return result.identity.find((f) => f.key === key)?.value?.trim() || '—'
}

function asVendorExtract(raw: unknown): VendorListingExtract | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as VendorListingExtract
  if (o.source === 'vendor_website') return o
  return null
}

function asAmazonExtract(raw: unknown): AmazonListingExtract | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as AmazonListingExtract
  if (o.source === 'amazon') return o
  return null
}

function priceFromExtract(raw: unknown): string {
  const vendor = asVendorExtract(raw)
  const amazon = asAmazonExtract(raw)
  const attrs = (vendor ?? amazon)?.rawAttributes
  if (attrs && typeof attrs.priceUsd === 'number' && Number.isFinite(attrs.priceUsd)) {
    return attrs.priceUsd.toFixed(2)
  }
  if (attrs && attrs.priceUsd != null) {
    const n = Number.parseFloat(String(attrs.priceUsd))
    if (Number.isFinite(n)) return n.toFixed(2)
  }
  return '—'
}

/** Matches among the six core verdict checks. */
function verdictMatchCount(result: QcResult, context?: ComparisonOutcomeContext): number {
  let n = 0
  for (const key of QC_VERDICT_COMPARISON_KEYS) {
    const field = comparisonForKey(result, key)
    if (field && comparisonOutcome(field, context) === 'MATCH') n += 1
  }
  return n
}

function computeConfidence(result: QcResult, context?: ComparisonOutcomeContext): number {
  const parts: number[] = []
  const titlePct = resolveTitleSimilarityDisplayPercent(result)
  const imagePct = resolveImageSimilarityDisplayPercent(result)
  if (titlePct != null) parts.push(titlePct)
  if (imagePct != null) parts.push(imagePct)
  parts.push(
    Math.round((verdictMatchCount(result, context) / QC_VERDICT_COMPARISON_KEYS.length) * 100),
  )
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length)
}

function verdictHeadline(result: QcResult, context?: ComparisonOutcomeContext): string {
  const matched = verdictMatchCount(result, context)
  const total = QC_VERDICT_COMPARISON_KEYS.length
  if (result.verdict === 'PASS') {
    return `ALL ${total} VERDICT CHECKS MATCHED`
  }
  if (result.verdict === 'FAIL') {
    return `${matched} OF ${total} VERDICT CHECKS MATCHED`
  }
  return `${matched} OF ${total} MATCHED · MANUAL REVIEW`
}

function fieldLabel(key: string): string {
  const map: Record<string, string> = {
    title: 'TITLE SIMILARITY',
    brand: 'BRAND',
    model: 'MODEL NUMBER',
    pack: 'PACK QUANTITY',
    image: 'IMAGE SIMILARITY',
    upc: 'UPC MATCH',
  }
  return map[key] ?? key.toUpperCase()
}

function metricPrimaryText(
  key: string,
  field: QcComparisonField | undefined,
  result: QcResult,
  context?: ComparisonOutcomeContext,
): string {
  if (!field) return '—'
  if (key === 'title') {
    const score = resolveTitleSimilarityDisplayPercent(result)
    return score != null ? `${Math.round(score)}%` : '—'
  }
  if (key === 'image') {
    const score = resolveImageSimilarityDisplayPercent(result)
    return score != null ? `${Math.round(score)}%` : outcomeYesNoLabel(comparisonOutcome(field, context))
  }
  if (key === 'pack') {
    const outcome = comparisonOutcome(field, context)
    if (outcome === 'MATCH') return outcomeYesNoLabel(outcome)
    const v = field.sourceValue?.trim() || '—'
    const a = field.targetValue?.trim() || '—'
    if (v === '—' && a === '—') return '—'
    return `${v} vs ${a}`
  }
  if (key === 'upc') {
    return field.sourceValue?.trim() || field.targetValue?.trim() || '—'
  }
  return outcomeYesNoLabel(comparisonOutcome(field, context))
}

function metricStatusLabel(
  key: string,
  field: QcComparisonField | undefined,
  titleThreshold: number,
  imageThreshold: number,
  outcome: 'MATCH' | 'MISMATCH' | 'REVIEW',
): string {
  if (!field) return 'REVIEW'
  if (key === 'title') {
    return outcome === 'MATCH' ? `PASS (≥${titleThreshold}%)` : outcome === 'REVIEW' ? 'REVIEW' : 'FAIL'
  }
  if (key === 'image') {
    return outcome === 'MATCH' ? `PASS (≥${imageThreshold}%)` : outcome === 'REVIEW' ? 'REVIEW' : 'FAIL'
  }
  if (key === 'upc') return outcome === 'MATCH' ? 'VERIFIED' : outcome === 'MISMATCH' ? 'MISMATCH' : 'REVIEW'
  return outcome === 'MATCH' ? 'MATCH' : outcome === 'MISMATCH' ? 'MISMATCH' : 'REVIEW'
}

function MetricCard({
  label,
  primary,
  status,
  outcome,
  showBar,
  barValue,
}: {
  label: string
  primary: string
  status: string
  outcome: 'MATCH' | 'MISMATCH' | 'REVIEW'
  showBar?: boolean
  barValue?: number
}) {
  const tone =
    outcome === 'MATCH'
      ? 'success.main'
      : outcome === 'REVIEW'
        ? 'warning.main'
        : 'error.main'
  return (
    <Box
      sx={{
        flex: '1 1 140px',
        minWidth: 120,
        p: 1.25,
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Typography sx={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em', color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '18px', fontWeight: 800, mt: 0.35, fontFamily: fontFamilyMono }}>{primary}</Typography>
      <Typography sx={{ fontSize: '10px', fontWeight: 700, color: tone, mt: 0.25 }}>{status}</Typography>
      {showBar && barValue != null && (
        <Box
          sx={{
            mt: 0.75,
            height: 4,
            borderRadius: 1,
            bgcolor: 'action.hover',
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              width: `${Math.min(100, Math.max(0, barValue))}%`,
              height: '100%',
              bgcolor:
                outcome === 'MATCH'
                  ? 'success.main'
                  : outcome === 'REVIEW'
                    ? 'warning.main'
                    : 'error.main',
            }}
          />
        </Box>
      )}
    </Box>
  )
}

function IdentityColumn({
  heading,
  brand,
  model,
  upc,
  titleOutcome,
  imageOutcome,
}: {
  heading: string
  brand: string
  model: string
  upc: string
  titleOutcome: string
  imageOutcome: string
}) {
  const rows: [string, string][] = [
    ['Brand', brand],
    ['Model', model],
    ['UPC', upc],
    ['TITLE RESULT', titleOutcome],
    ['IMAGE RESULT', imageOutcome],
  ]
  return (
    <Box>
      <Typography
        sx={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.08em', color: 'text.secondary', mb: 1 }}
      >
        {heading}
      </Typography>
      {rows.map(([lbl, val]) => (
        <Box
          key={lbl}
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 1,
            py: 0.65,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography sx={{ fontSize: '11px', color: 'text.secondary' }}>{lbl}</Typography>
          <Typography sx={{ fontSize: '11px', fontWeight: 700, fontFamily: fontFamilyMono, textAlign: 'right' }}>
            {val}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

function PortalCard({
  accent,
  title,
  subtitle,
  imageUrl,
  imageLabel,
  price,
  packQty,
  upc,
  footerLeft,
  footerRight,
  topAction,
}: {
  accent: string
  title: string
  subtitle: string
  imageUrl?: string
  imageLabel: string
  price: string
  packQty: string
  upc: string
  footerLeft: string
  footerRight: string
  topAction?: ReactNode
}) {
  return (
    <Box
      sx={{
        flex: '1 1 280px',
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider',
        borderLeft: `4px solid ${accent}`,
        bgcolor: 'background.paper',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box>
          <Typography sx={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.08em', color: accent }}>
            {subtitle}
          </Typography>
        </Box>
        {topAction}
      </Box>
      <Box sx={{ p: 1.5, display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
        <QcProductImage src={imageUrl} alt={title} label={imageLabel} size="md" enlargeable />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: '13px', fontWeight: 700, lineHeight: 1.35 }}>{title}</Typography>
          <Box
            sx={{
              mt: 1.25,
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 1,
            }}
          >
            {[
              ['PRICE', price],
              ['PACK QTY', packQty],
              ['UPC', upc],
            ].map(([lbl, val]) => (
              <Box key={lbl}>
                <Typography sx={{ fontSize: '8px', fontWeight: 700, color: 'text.secondary', letterSpacing: '0.05em' }}>
                  {lbl}
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 700, fontFamily: fontFamilyMono, mt: 0.15 }}>
                  {val}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
      <Box
        sx={{
          px: 1.5,
          py: 0.85,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 1,
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: 'action.hover',
        }}
      >
        <Typography sx={{ fontSize: '10px', fontFamily: fontFamilyMono, color: 'text.secondary' }}>
          {footerLeft}
        </Typography>
        <Typography sx={{ fontSize: '10px', fontFamily: fontFamilyMono, color: 'text.secondary' }}>
          {footerRight}
        </Typography>
      </Box>
    </Box>
  )
}

export function ComparisonDialog({ open, result, onClose }: ComparisonDialogProps) {
  const theme = useTheme()
  const { settings } = useSettings()
  const [tab, setTab] = useState<DetailTab>('identity')

  const vendor = result ? asVendorExtract(result.sourceRawExtract) : null
  const amazon = result ? asAmazonExtract(result.targetRawExtract) : null

  const outcomeContext: ComparisonOutcomeContext | undefined = result
    ? { result, thresholds: settings }
    : undefined

  const derived = useMemo(() => {
    if (!result) return null
    const { sourceUrl, targetUrl } = resolveQcImageUrls(result)
    const sku = identityValue(result, 'sku')
    const asin = identityValue(result, 'listing_id')
    const titleField = comparisonForKey(result, 'title')
    const brandField = comparisonForKey(result, 'brand')
    const modelField = comparisonForKey(result, 'model')
    const packField = comparisonForKey(result, 'pack')
    const upcField = comparisonForKey(result, 'upc')
    const priceField = comparisonForKey(result, 'price')

    const vendorTitle = vendor?.title || titleField?.sourceValue || '—'
    const amazonTitle = amazon?.title || titleField?.targetValue || '—'
    const vendorPrice =
      priceField?.sourceValue && priceField.sourceValue !== '0.00'
        ? priceField.sourceValue
        : priceFromExtract(result.sourceRawExtract)
    const amazonPrice =
      priceField?.targetValue && priceField.targetValue !== '0.00'
        ? priceField.targetValue
        : priceFromExtract(result.targetRawExtract)

    const listingUrl =
      amazon?.listingUrl ||
      (asin && asin !== '—' ? `https://www.amazon.com/dp/${encodeURIComponent(asin)}` : '')

    return {
      sourceUrl,
      targetUrl,
      sku,
      asin,
      titleField,
      brandField,
      modelField,
      packField,
      upcField,
      vendorTitle,
      amazonTitle,
      vendorPrice,
      amazonPrice,
      listingUrl,
      confidence: computeConfidence(result, outcomeContext),
      headline: verdictHeadline(result, outcomeContext),
    }
  }, [result, vendor, amazon, outcomeContext])

  if (!result || !derived) return null

  const runLabel = result.runSource === 'sandbox' ? 'SANDBOX' : 'UPLOAD'
  const vendorAccent = theme.palette.info.main
  const amazonAccent = theme.palette.warning.main

  const hasRaw = result.sourceRawExtract != null || result.targetRawExtract != null
  const hasTokens = result.inputTokens != null || result.outputTokens != null
  const cost =
    result.inputTokens != null && result.outputTokens != null
      ? tokenCostUsd(result.inputTokens, result.outputTokens)
      : null

  const { brandField, modelField, packField, upcField, titleField } = derived

  const vendorBrand = brandField?.sourceValue || vendor?.brand || '—'
  const amazonBrand = brandField?.targetValue || amazon?.brand || '—'
  const vendorModel = modelField?.sourceValue || vendor?.modelNumber || '—'
  const amazonModel = modelField?.targetValue || amazon?.modelNumber || '—'
  const vendorUpc = upcField?.sourceValue || vendor?.upc || '—'
  const amazonUpc = upcField?.targetValue || amazon?.upc || '—'
  const vendorPack = packField?.sourceValue || vendor?.packSize || '—'
  const amazonPack = packField?.targetValue || amazon?.packSize || '—'

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: 1,
            maxHeight: '92vh',
            bgcolor: 'background.default',
            border: '1px solid',
            borderColor: 'divider',
          },
        },
      }}
    >
      <Box sx={{ px: 2, pt: 1.75, pb: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.12em', color: 'text.secondary' }}
            >
              ENGINE COMPARISON VERDICT · {runLabel}
            </Typography>
            <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
              <QcVerdictChip verdict={result.verdict} density="default" />
              <Typography sx={{ fontSize: '13px', fontWeight: 800, letterSpacing: '0.02em' }}>
                {derived.headline}
              </Typography>
            </Box>
            <Typography sx={{ fontSize: '11px', color: 'text.secondary', mt: 0.5, fontFamily: fontFamilyMono }}>
              SKU: {derived.sku} · ASIN: {derived.asin}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <Box sx={{ textAlign: 'right' }}>
              <Typography sx={{ fontSize: '9px', fontWeight: 700, color: 'text.secondary', letterSpacing: '0.06em' }}>
                CONFIDENCE SCORE
              </Typography>
              <Typography sx={{ fontSize: '22px', fontWeight: 800, fontFamily: fontFamilyMono }}>
                {derived.confidence}%
              </Typography>
            </Box>
            <IconButton size="small" onClick={onClose} aria-label="Close" sx={{ mt: -0.5 }}>
              <CloseIcon sx={{ fontSize: 20 }} />
            </IconButton>
          </Box>
        </Box>
      </Box>

      <Box sx={{ px: 2, py: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {CORE_KEYS.map((key) => {
          const field = comparisonForKey(result, key)
          const outcome = field ? comparisonOutcome(field, outcomeContext) : 'REVIEW'
          const primary = metricPrimaryText(key, field, result, outcomeContext)
          const status = metricStatusLabel(
            key,
            field,
            settings.titleSimilarityPercent,
            settings.imageSimilarityPercent,
            outcome,
          )
          const barVal =
            key === 'title'
              ? resolveTitleSimilarityDisplayPercent(result) ?? undefined
              : key === 'image'
                ? resolveImageSimilarityDisplayPercent(result) ?? undefined
                : undefined
          return (
            <MetricCard
              key={key}
              label={fieldLabel(key)}
              primary={primary}
              status={status}
              outcome={outcome}
              showBar={key === 'title' || key === 'image'}
              barValue={barVal}
            />
          )
        })}
      </Box>

      <Box sx={{ px: 2, pb: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
        <PortalCard
          accent={vendorAccent}
          subtitle="VENDOR PORTAL"
          title={derived.vendorTitle}
          imageUrl={derived.sourceUrl}
          imageLabel="Vendor"
          price={derived.vendorPrice}
          packQty={vendorPack}
          upc={vendorUpc}
          footerLeft={`MODEL / MPN: ${vendorModel}`}
          footerRight={`SKU: ${derived.sku}`}
        />
        <PortalCard
          accent={amazonAccent}
          subtitle="AMAZON LISTING"
          title={derived.amazonTitle}
          imageUrl={derived.targetUrl}
          imageLabel="Amazon"
          price={derived.amazonPrice}
          packQty={amazonPack}
          upc={amazonUpc}
          footerLeft={`CATALOG MODEL: ${amazonModel}`}
          footerRight={`ASIN: ${derived.asin}`}
          topAction={
            derived.listingUrl ? (
              <Link
                href={derived.listingUrl}
                target="_blank"
                rel="noopener noreferrer"
                sx={{
                  fontSize: '10px',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.35,
                }}
              >
                View ASIN
                <OpenInNewIcon sx={{ fontSize: 12 }} />
              </Link>
            ) : undefined
          }
        />
      </Box>

      <Box sx={{ px: 2, borderTop: '1px solid', borderColor: 'divider' }}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v as DetailTab)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            minHeight: 40,
            '& .MuiTab-root': {
              minHeight: 40,
              fontSize: '10px',
              fontWeight: 800,
              letterSpacing: '0.08em',
            },
          }}
        >
          <Tab value="identity" label="IDENTITY" />
          <Tab value="packaging" label="PACKAGING" />
          <Tab value="comparisons" label="COMPARISONS" />
          <Tab value="raw" label="RAW" disabled={!hasRaw} />
        </Tabs>
      </Box>

      <Box sx={{ px: 2, py: 1.5, overflow: 'auto', maxHeight: '34vh' }}>
        {tab === 'identity' && (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <IdentityColumn
              heading="VENDOR IDENTITY"
              brand={vendorBrand}
              model={vendorModel}
              upc={vendorUpc}
              titleOutcome={
                titleField ? outcomeYesNoLabel(comparisonOutcome(titleField, outcomeContext)) : '—'
              }
              imageOutcome={
                comparisonForKey(result, 'image')
                  ? outcomeYesNoLabel(
                      comparisonOutcome(comparisonForKey(result, 'image')!, outcomeContext),
                    )
                  : '—'
              }
            />
            <IdentityColumn
              heading="AMAZON IDENTITY"
              brand={amazonBrand}
              model={amazonModel}
              upc={amazonUpc}
              titleOutcome={
                titleField ? outcomeYesNoLabel(comparisonOutcome(titleField, outcomeContext)) : '—'
              }
              imageOutcome={
                comparisonForKey(result, 'image')
                  ? outcomeYesNoLabel(
                      comparisonOutcome(comparisonForKey(result, 'image')!, outcomeContext),
                    )
                  : '—'
              }
            />
          </Box>
        )}

        {tab === 'packaging' && (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <Box>
              <Typography sx={{ fontSize: '10px', fontWeight: 800, color: 'text.secondary', mb: 1 }}>
                VENDOR PACK
              </Typography>
              <Typography sx={{ fontSize: '20px', fontWeight: 800, fontFamily: fontFamilyMono }}>{vendorPack}</Typography>
              {result.packEvidenceVendor ? (
                <Typography sx={{ fontSize: '11px', color: 'text.secondary', mt: 1 }}>
                  {result.packEvidenceVendor}
                </Typography>
              ) : null}
            </Box>
            <Box>
              <Typography sx={{ fontSize: '10px', fontWeight: 800, color: 'text.secondary', mb: 1 }}>
                AMAZON PACK
              </Typography>
              <Typography sx={{ fontSize: '20px', fontWeight: 800, fontFamily: fontFamilyMono }}>{amazonPack}</Typography>
              {result.packEvidenceAmazon ? (
                <Typography sx={{ fontSize: '11px', color: 'text.secondary', mt: 1 }}>
                  {result.packEvidenceAmazon}
                </Typography>
              ) : null}
              {packField ? (
                <Typography sx={{ fontSize: '11px', mt: 1, color: comparisonOutcome(packField) === 'MATCH' ? 'success.main' : 'error.main', fontWeight: 700 }}>
                  Result: {outcomeYesNoLabel(comparisonOutcome(packField))}
                </Typography>
              ) : null}
            </Box>
          </Box>
        )}

        {tab === 'comparisons' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {result.comparisons.map((field) => {
              const outcome = comparisonOutcome(field, outcomeContext)
              const tone =
                outcome === 'MATCH' ? 'success.main' : outcome === 'MISMATCH' ? 'error.main' : 'warning.main'
              return (
                <Box
                  key={field.key}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '120px 1fr 1fr 72px' },
                    gap: 1,
                    py: 0.85,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    alignItems: 'start',
                  }}
                >
                  <Typography sx={{ fontSize: '11px', fontWeight: 700 }}>{field.label}</Typography>
                  <Typography sx={{ fontSize: '11px', fontFamily: fontFamilyMono, wordBreak: 'break-word' }}>
                    {field.sourceValue || '—'}
                  </Typography>
                  <Typography sx={{ fontSize: '11px', fontFamily: fontFamilyMono, wordBreak: 'break-word' }}>
                    {field.targetValue || '—'}
                  </Typography>
                  <Typography sx={{ fontSize: '10px', fontWeight: 800, color: tone }}>
                    {outcomeYesNoLabel(outcome)}
                  </Typography>
                </Box>
              )
            })}
          </Box>
        )}

        {tab === 'raw' && hasRaw && (
          <RawScrapeComparePair
            amazonData={result.targetRawExtract}
            vendorData={result.sourceRawExtract}
            asin={derived.asin}
            sku={derived.sku}
            maxHeight={{ xs: 220, lg: 280 }}
          />
        )}

        {hasTokens && tab === 'comparisons' && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 1,
              mt: 2,
              pt: 1.5,
              borderTop: '1px solid',
              borderColor: 'divider',
            }}
          >
            {[
              ['Input Tokens', (result.inputTokens ?? 0).toLocaleString()],
              ['Output Tokens', (result.outputTokens ?? 0).toLocaleString()],
              ['Cost (USD)', cost != null ? formatUsd(cost) : '—'],
            ].map(([label, value]) => (
              <Box key={label}>
                <Typography sx={{ fontSize: '9px', fontWeight: 700, color: 'text.secondary' }}>{label}</Typography>
                <Typography sx={{ fontSize: '13px', fontWeight: 700, fontFamily: fontFamilyMono }}>{value}</Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Dialog>
  )
}
