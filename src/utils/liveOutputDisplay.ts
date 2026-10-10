import type { QcComparisonField, QcResult } from '../types/qc'
import type { QcCompareOutcome } from './qcThresholdComparison'
import { normalizeLoose } from './qcThresholdComparison'

export const LIVE_RESULT_COLUMNS: { key: string; header: string }[] = [
  { key: 'brand', header: 'BRAND RESULT' },
  { key: 'model', header: 'MODEL NUMBER RESULT' },
  { key: 'pack', header: 'PACK SIZE RESULT' },
  { key: 'upc', header: 'UPC RESULT' },
  { key: 'title', header: 'TITLE RESULT' },
  { key: 'image', header: 'IMAGE RESULT' },
]

export function comparisonOutcome(field: QcComparisonField): QcCompareOutcome {
  if (field.outcome) return field.outcome
  const source = field.sourceValue?.trim()
  const target = field.targetValue?.trim()
  if (!source || source === '—' || !target || target === '—') return 'REVIEW'
  return normalizeLoose(source) === normalizeLoose(target) ? 'MATCH' : 'MISMATCH'
}

export function outcomeYesNoLabel(outcome: QcCompareOutcome): 'YES' | 'NO' | 'REVIEW' {
  if (outcome === 'MATCH') return 'YES'
  if (outcome === 'MISMATCH') return 'NO'
  return 'REVIEW'
}

export function identityField(result: QcResult, key: string): string {
  return result.identity.find((f) => f.key === key)?.value ?? '—'
}

export function comparisonForKey(result: QcResult, key: string): QcComparisonField | undefined {
  return result.comparisons.find((c) => c.key === key)
}

export function buildVerdictReason(result: QcResult): string {
  if (result.verdict === 'PASS') {
    return 'PASS: All fields match'
  }

  const mismatch = result.comparisons.find((c) => comparisonOutcome(c) === 'MISMATCH')
  if (mismatch) {
    const label = mismatch.label.replace(/\s+$/g, '')
    return `FAIL: ${label} Mismatch`
  }

  const review = result.comparisons.find((c) => comparisonOutcome(c) === 'REVIEW')
  if (review) {
    return `REVIEW: ${review.label}`
  }

  if (result.verdict === 'MANUAL_REVIEW') {
    return 'MANUAL REVIEW: Check comparison detail'
  }

  return result.verdict.replace(/_/g, ' ')
}

export function summarizeCounts(results: QcResult[]) {
  let pass = 0
  let fail = 0
  let manual = 0
  for (const r of results) {
    if (r.verdict === 'PASS') pass += 1
    else if (r.verdict === 'FAIL') fail += 1
    else manual += 1
  }
  return { pass, fail, manual }
}

export function formatProgressLabel(completedBatch: number, batchTotal: number, allCount: number): string {
  if (batchTotal > 0) {
    return `${completedBatch} / ${batchTotal}`
  }
  if (allCount > 0) {
    return `${allCount} run${allCount === 1 ? '' : 's'}`
  }
  return '0 / 0'
}

export function runSourceLabel(source: QcResult['runSource']): string {
  if (source === 'sandbox') return 'Sandbox'
  return 'Upload'
}
