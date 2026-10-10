import {
  Dialog,
  DialogContent,
  DialogTitle,
  Box,
  Typography,
  Table,
  TableBody,
  TableRow,
  TableCell,
  TableHead,
  IconButton,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import type { QcResult } from '../../types/qc'
import { fontFamilyMono } from '../../theme/typography'
import { formatUsd, tokenCostUsd } from '../../utils/aiPricing'
import { resolveQcImageUrls } from '../../utils/qcImages'
import { RawScrapeComparePair } from '../sandbox/RawScrapeComparePair'
import { QcVerdictChip } from '../status'
import { QcProductImage } from './QcProductImage'

type ComparisonDialogProps = {
  open: boolean
  result: QcResult | null
  onClose: () => void
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

function identityValue(result: QcResult, key: string): string | undefined {
  return result.identity.find((f) => f.key === key)?.value
}

export function ComparisonDialog({ open, result, onClose }: ComparisonDialogProps) {
  if (!result) return null

  const sourceLabel = result.sourceColumnLabel ?? 'Vendor'
  const targetLabel = result.targetColumnLabel ?? 'Amazon'
  const titleParts = result.identity.map((f) => f.value).filter(Boolean)
  const { sourceUrl, targetUrl } = resolveQcImageUrls(result)
  const hasTokens = result.inputTokens != null || result.outputTokens != null
  const cost =
    result.inputTokens != null && result.outputTokens != null
      ? tokenCostUsd(result.inputTokens, result.outputTokens)
      : null

  const sku = identityValue(result, 'sku')
  const asin = identityValue(result, 'listing_id')
  const hasRawScrapes = result.sourceRawExtract != null || result.targetRawExtract != null

  /** Prefer comparison rows; inject Image from top-level URLs if missing. */
  const rows = [...result.comparisons]
  if (!rows.some((r) => r.key === 'image') && (sourceUrl || targetUrl)) {
    rows.splice(1, 0, {
      key: 'image',
      label: 'Image',
      sourceValue: sourceUrl ?? '',
      targetValue: targetUrl ?? '',
    })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 0.5, maxHeight: '90vh' } } }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '14px',
          fontWeight: 700,
          py: 1.5,
          gap: 1,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: '14px',
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {titleParts.join(' · ') || result.id}
          </Typography>
          <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <QcVerdictChip verdict={result.verdict} />
            {result.identity.map((f) => (
              <Typography
                key={f.key}
                sx={{ fontSize: '10px', color: 'text.secondary', fontFamily: fontFamilyMono }}
              >
                {f.label}: {f.value}
              </Typography>
            ))}
          </Box>
        </Box>
        <IconButton size="small" onClick={onClose} aria-label="Close">
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: 0, display: 'flex', flexDirection: 'column', gap: 2, overflow: 'auto' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1.5,
            flexWrap: 'wrap',
            px: 1.25,
            py: 1,
            borderRadius: 0.5,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'action.hover',
          }}
        >
          <Box>
            <Typography sx={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em', color: 'text.secondary' }}>
              FINAL VERDICT
            </Typography>
            <Typography sx={{ fontSize: '11px', color: 'text.secondary', mt: 0.2 }}>
              {rows.length} compared field{rows.length === 1 ? '' : 's'} · {sourceLabel} vs {targetLabel}
            </Typography>
          </Box>
          <QcVerdictChip verdict={result.verdict} density="default" />
        </Box>

        {hasRawScrapes && (
          <Box>
            <Typography
              sx={{
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.05em',
                color: 'text.secondary',
                mb: 1,
              }}
            >
              RAW SCRAPE DATA
            </Typography>
            <RawScrapeComparePair
              amazonData={result.targetRawExtract}
              vendorData={result.sourceRawExtract}
              asin={asin}
              sku={sku}
              maxHeight={{ xs: 200, lg: 240 }}
            />
          </Box>
        )}

        {rows.length === 0 ? (
          <Typography sx={{ fontSize: '12px', color: 'text.secondary' }}>
            No comparison fields for this result.
          </Typography>
        ) : (
          <Box>
            <Typography
              sx={{
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.05em',
                color: 'text.secondary',
                mb: 1,
              }}
            >
              QC COMPARISONS · {rows.length} FIELDS
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontSize: '11px', fontWeight: 500, color: 'text.secondary', width: 100 }}>
                    Field
                  </TableCell>
                  <TableCell sx={{ fontSize: '11px', fontWeight: 500, color: 'text.secondary' }}>
                    {sourceLabel}
                  </TableCell>
                  <TableCell sx={{ fontSize: '11px', fontWeight: 500, color: 'text.secondary' }}>
                    {targetLabel}
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((field) => {
                  const isImage =
                    field.key === 'image' ||
                    looksLikeUrl(field.sourceValue) ||
                    looksLikeUrl(field.targetValue)

                  return (
                    <TableRow key={field.key}>
                      <TableCell
                        sx={{
                          fontSize: '11px',
                          fontWeight: 700,
                          width: 100,
                          borderColor: 'divider',
                          verticalAlign: 'top',
                        }}
                      >
                        {field.label}
                      </TableCell>
                      <TableCell
                        sx={{
                          fontSize: '12px',
                          fontFamily: fontFamilyMono,
                          borderColor: 'divider',
                          verticalAlign: 'top',
                          wordBreak: 'break-word',
                        }}
                      >
                        {isImage && looksLikeUrl(field.sourceValue) ? (
                          <QcProductImage
                            src={field.sourceValue}
                            alt={`${sourceLabel} image`}
                            showUrl
                            size="sm"
                          />
                        ) : (
                          field.sourceValue
                        )}
                      </TableCell>
                      <TableCell
                        sx={{
                          fontSize: '12px',
                          fontFamily: fontFamilyMono,
                          borderColor: 'divider',
                          verticalAlign: 'top',
                          wordBreak: 'break-word',
                        }}
                      >
                        {isImage && looksLikeUrl(field.targetValue) ? (
                          <QcProductImage
                            src={field.targetValue}
                            alt={`${targetLabel} image`}
                            showUrl
                            size="sm"
                          />
                        ) : (
                          field.targetValue
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Box>
        )}

        {hasTokens && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 1,
              pt: 0.5,
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
                <Typography
                  sx={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.04em', color: 'text.secondary' }}
                >
                  {label.toUpperCase()}
                </Typography>
                <Typography sx={{ fontSize: '13px', fontWeight: 700, fontFamily: fontFamilyMono, mt: 0.25 }}>
                  {value}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  )
}
