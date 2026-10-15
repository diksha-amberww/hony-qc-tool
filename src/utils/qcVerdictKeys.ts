import type { QcComparisonField, QcVerdict } from '../types/qc'
import { comparisonOutcome } from './liveOutputDisplay'

/**
 * Six core checks for final PASS / FAIL / MANUAL_REVIEW.
 */
export const QC_VERDICT_COMPARISON_KEYS = [
  'brand',
  'model',
  'title',
  'pack',
  'image',
  'upc',
] as const

export type QcVerdictComparisonKey = (typeof QC_VERDICT_COMPARISON_KEYS)[number]

export function isQcVerdictComparisonKey(key: string): boolean {
  return (QC_VERDICT_COMPARISON_KEYS as readonly string[]).includes(key)
}

function fieldForVerdictKey(comparisons: QcComparisonField[], key: string): QcComparisonField | undefined {
  const found = comparisons.find((c) => c.key === key)
  if (found) return found
  if (key === 'pack') return comparisons.find((c) => c.key === 'packSize')
  return undefined
}

function deriveFromOutcomes(
  resolve: (field: QcComparisonField) => 'MATCH' | 'MISMATCH' | 'REVIEW',
  comparisons: QcComparisonField[],
): QcVerdict {
  for (const key of QC_VERDICT_COMPARISON_KEYS) {
    const field = fieldForVerdictKey(comparisons, key)
    if (!field) return 'FAIL'
    const outcome = resolve(field)
    if (outcome === 'MISMATCH') return 'FAIL'
    if (outcome === 'REVIEW') {
      // continue — need to check all; any review without mismatch → MANUAL_REVIEW
    } else if (outcome !== 'MATCH') return 'FAIL'
  }
  for (const key of QC_VERDICT_COMPARISON_KEYS) {
    const field = fieldForVerdictKey(comparisons, key)
    if (!field) return 'FAIL'
    const outcome = resolve(field)
    if (outcome === 'REVIEW') return 'MANUAL_REVIEW'
  }
  return 'PASS'
}

/** When comparison outcomes are already set (engine payload). */
export function deriveQcVerdictFromComparisons(comparisons: QcComparisonField[]): QcVerdict {
  return deriveFromOutcomes((field) => comparisonOutcome(field), comparisons)
}
