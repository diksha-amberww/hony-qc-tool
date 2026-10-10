import type { ListingQcPayload } from '../../types/listingExtract'
import type { QcResult } from '../../types/qc'
import type { SandboxQcResult } from '../../data/sandboxQc'
import { tokenCostUsd } from '../../utils/aiPricing'
import { sandboxQcResultToQcResult } from './sandboxToQcResult'
import type { InputRow } from '../../utils/inputParse'

/** Map backend listing QC payload into live `QcResult`. */
export function listingQcPayloadToSandboxQcResult(payload: ListingQcPayload): SandboxQcResult {
  const costUsd = tokenCostUsd(payload.inputTokens, payload.outputTokens)
  return {
    ...payload,
    fetched: payload.asinExtract,
    costUsd,
    estimatedX1000Usd: costUsd * 1000,
  }
}

export function listingQcPayloadToQcResult(payload: ListingQcPayload): QcResult {
  return sandboxQcResultToQcResult(listingQcPayloadToSandboxQcResult(payload))
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
  return {
    id: sku,
    identity: [
      { key: 'sku', label: 'SKU', value: sku },
      { key: 'listing_id', label: 'ASIN', value: asin },
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
