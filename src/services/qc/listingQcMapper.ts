import type { ListingQcPayload } from '../../types/listingExtract'
import type { QcResult } from '../../types/qc'
import type { SandboxQcResult } from '../../data/sandboxQc'
import { tokenCostUsd } from '../../utils/aiPricing'
import {
  normalizeImageAiScorePercent,
  normalizeTitleAiScorePercent,
} from '../../utils/qcSimilarityDisplay'
import { sandboxQcResultToQcResult } from './sandboxToQcResult'
import type { InputRow } from '../../utils/inputParse'

/** Map backend listing QC payload into live `QcResult`. */
export function listingQcPayloadToSandboxQcResult(payload: ListingQcPayload): SandboxQcResult {
  const costUsd = payload.costUsd ?? tokenCostUsd(payload.inputTokens, payload.outputTokens)
  return {
    ...payload,
    fetched: payload.asinExtract,
    costUsd,
    estimatedX1000Usd: costUsd * 1000,
    qcModel: payload.qcModel ?? undefined,
  }
}

export function listingQcPayloadToQcResult(payload: ListingQcPayload): QcResult {
  const base = sandboxQcResultToQcResult(listingQcPayloadToSandboxQcResult(payload))
  return {
    ...base,
    inputRowUpc: payload.inputRowUpc,
    titleScore: normalizeTitleAiScorePercent(payload) ?? normalizeTitleAiScorePercent(base),
    imageScore: normalizeImageAiScorePercent(payload) ?? normalizeImageAiScorePercent(base),
    titleSameProduct: payload.titleSameProduct ?? null,
    titleTokenSimilarity: payload.titleTokenSimilarity ?? null,
    costUsd: payload.costUsd ?? null,
    qcModel: payload.qcModel ?? undefined,
    packEvidenceVendor: payload.packEvidenceVendor,
    packEvidenceAmazon: payload.packEvidenceAmazon,
  }
}

function pickRow(row: InputRow, ...keys: string[]): string {
  for (const key of keys) {
    const v = row[key]?.trim()
    if (v) return v
  }
  return ''
}

/** Minimal QC row when Amazon fetch or compare fails (batch does not stall). */
export function buildFailedQcResult(row: InputRow, errorMessage: string): QcResult {
  const sku = pickRow(row, 'part_sku', 'sku') || 'SKU-UNKNOWN'
  const asin = pickRow(row, 'asin') || '—'
  const inputRowUpc = pickRow(row, 'upc', 'UPC', 'barcode')
  return {
    id: sku,
    inputRowUpc: inputRowUpc || undefined,
    identity: [
      { key: 'sku', label: 'SKU', value: sku },
      { key: 'listing_id', label: 'ASIN', value: asin },
      ...(inputRowUpc ? [{ key: 'upc', label: 'UPC', value: inputRowUpc }] : []),
    ],
    verdict: 'MANUAL_REVIEW',
    comparisons: [
      {
        key: 'error',
        label: 'QC error',
        sourceValue: '—',
        targetValue: errorMessage.slice(0, 200),
      },
    ],
    sourceColumnLabel: 'Vendor',
    targetColumnLabel: 'Amazon',
  }
}
