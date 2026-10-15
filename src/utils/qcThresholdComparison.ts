import type { BrandAliasPair } from '../types/brandAlias'
import type { AppSettings, QcThresholdSettings } from '../types/settings'
import type { QcComparisonField, QcResult, QcVerdict } from '../types/qc'
import { isBrandAliasMatch } from './brandAliasMatch'
import { brandNamesMatch } from './brandNameMatch'
import {
  imageCompareOutcomeFromScore,
  normalizeImageAiScorePercent,
  normalizeTitleAiScorePercent,
  titleCompareOutcomeFromScore,
} from './qcSimilarityDisplay'
import { QC_VERDICT_COMPARISON_KEYS } from './qcVerdictKeys'

export type QcComparisonOptions = {
  brandAliases?: readonly BrandAliasPair[]
}

export type QcCompareOutcome = 'MATCH' | 'MISMATCH' | 'REVIEW'

/** Fixed price tolerance in QC comparisons (not exposed in Settings). */
const DEFAULT_PRICE_VARIANCE_PERCENT = 15

export function normalizeLoose(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokenSet(value: string): string[] {
  return normalizeLoose(value).split(' ').filter(Boolean)
}

/** 0–100 similarity based on shared tokens vs the longer token list. */
export function titleSimilarityPercent(source: string, target: string): number {
  const a = tokenSet(source)
  const b = tokenSet(target)
  if (a.length === 0 && b.length === 0) return 100
  if (a.length === 0 || b.length === 0) return 0
  const setB = new Set(b)
  const matches = a.filter((w) => setB.has(w)).length
  return Math.round((matches / Math.max(a.length, b.length)) * 100)
}

function picsumSeed(url: string): string {
  const match = url.match(/\/seed\/([^/]+)\//)
  return match ? decodeURIComponent(match[1]) : url
}

/** Demo-friendly image similarity from URL seeds (0–100). */
export function imageSimilarityPercent(sourceUrl: string, targetUrl: string): number {
  if (!sourceUrl || !targetUrl) return 0
  if (sourceUrl === targetUrl) return 100
  return titleSimilarityPercent(picsumSeed(sourceUrl), picsumSeed(targetUrl))
}

/** Absolute percent difference between two prices (0–100+). */
export function priceVariancePercent(source: string, target: string): number {
  const parse = (value: string) => {
    const n = Number.parseFloat(value.replace(/[^0-9.-]+/g, ''))
    return Number.isFinite(n) ? n : null
  }
  const s = parse(source)
  const t = parse(target)
  if (s === null || t === null) return 100
  if (s === 0 && t === 0) return 0
  const base = Math.max(Math.abs(s), Math.abs(t))
  if (base === 0) return 0
  return Math.round((Math.abs(s - t) / base) * 100)
}

export function exactCompareOutcome(source: string, target: string): QcCompareOutcome {
  if (!source || source === '—' || !target || target === '—') return 'REVIEW'
  return normalizeLoose(source) === normalizeLoose(target) ? 'MATCH' : 'MISMATCH'
}

export function comparisonOutcomeForKey(
  key: string,
  sourceValue: string,
  targetValue: string,
  thresholds: QcThresholdSettings,
  options?: QcComparisonOptions,
): QcCompareOutcome {
  switch (key) {
    case 'title': {
      const sim = titleSimilarityPercent(sourceValue, targetValue)
      if (sim >= thresholds.titleSimilarityPercent) return 'MATCH'
      if (sim >= Math.round(thresholds.titleSimilarityPercent * 0.65)) return 'REVIEW'
      return 'MISMATCH'
    }
    case 'image': {
      const sim = imageSimilarityPercent(sourceValue, targetValue)
      if (sim >= thresholds.imageSimilarityPercent) return 'MATCH'
      if (sim >= Math.round(thresholds.imageSimilarityPercent * 0.65)) return 'REVIEW'
      return 'MISMATCH'
    }
    case 'price': {
      const variance = priceVariancePercent(sourceValue, targetValue)
      if (variance <= DEFAULT_PRICE_VARIANCE_PERCENT) return 'MATCH'
      if (variance <= DEFAULT_PRICE_VARIANCE_PERCENT + 10) return 'REVIEW'
      return 'MISMATCH'
    }
    case 'brand': {
      const aliases = options?.brandAliases
      if (aliases?.length && isBrandAliasMatch(sourceValue, targetValue, aliases)) {
        return 'MATCH'
      }
      if (!sourceValue || sourceValue === '—' || !targetValue || targetValue === '—') {
        return 'REVIEW'
      }
      if (brandNamesMatch(sourceValue, targetValue)) return 'MATCH'
      return 'MISMATCH'
    }
    default:
      return exactCompareOutcome(sourceValue, targetValue)
  }
}

function outcomeForVerdictField(
  field: QcComparisonField,
  thresholds: QcThresholdSettings,
  options?: QcComparisonOptions,
  scoreContext?: Pick<QcResult, 'imageScore' | 'titleScore' | 'titleSameProduct'>,
): QcCompareOutcome {
  if (field.key === 'image') {
    return imageCompareOutcomeFromScore(
      normalizeImageAiScorePercent(scoreContext ?? {}),
      thresholds.imageSimilarityPercent,
    )
  }
  if (field.key === 'title') {
    return titleCompareOutcomeFromScore(
      normalizeTitleAiScorePercent(scoreContext ?? {}),
      thresholds.titleSimilarityPercent,
    )
  }
  // Brand, model, pack, UPC: trust engine comparison outcome (lenient rules already applied in runQC).
  if (field.outcome) return field.outcome
  return comparisonOutcomeForKey(
    field.key,
    field.sourceValue,
    field.targetValue,
    thresholds,
    options,
  )
}

/** PASS / FAIL / MANUAL_REVIEW from the six core comparison outcomes. */
export function deriveVerdictFromComparisons(
  comparisons: QcComparisonField[],
  thresholds: QcThresholdSettings,
  options?: QcComparisonOptions,
  scoreContext?: Pick<QcResult, 'imageScore' | 'titleScore' | 'titleSameProduct'>,
): QcVerdict {
  let hasMismatch = false
  let hasReview = false
  for (const key of QC_VERDICT_COMPARISON_KEYS) {
    const field =
      comparisons.find((c) => c.key === key) ??
      comparisons.find((c) => c.key === 'packSize' && key === 'pack')
    if (!field) return 'FAIL'
    const outcome = outcomeForVerdictField(field, thresholds, options, scoreContext)
    if (outcome === 'MISMATCH') hasMismatch = true
    else if (outcome === 'REVIEW') hasReview = true
    else if (outcome !== 'MATCH') hasMismatch = true
  }
  if (hasMismatch) return 'FAIL'
  if (hasReview) return 'MANUAL_REVIEW'
  return 'PASS'
}

/** Sync title/image outcomes and verdict with AI scores and Settings thresholds. */
export function applyQcThresholdsToResult(
  result: QcResult,
  thresholds: Pick<AppSettings, keyof QcThresholdSettings>,
  options?: QcComparisonOptions,
): QcResult {
  const comparisons = result.comparisons.map((field) => {
    if (field.key === 'image') {
      const outcome = imageCompareOutcomeFromScore(
        normalizeImageAiScorePercent(result),
        thresholds.imageSimilarityPercent,
      )
      if (outcome === field.outcome) return field
      return { ...field, outcome }
    }
    if (field.key === 'title') {
      const outcome = titleCompareOutcomeFromScore(
        normalizeTitleAiScorePercent(result),
        thresholds.titleSimilarityPercent,
      )
      if (outcome === field.outcome) return field
      return { ...field, outcome }
    }
    return field
  })
  const verdict = deriveVerdictFromComparisons(comparisons, thresholds, options, {
    imageScore: result.imageScore,
    titleScore: result.titleScore,
    titleSameProduct: result.titleSameProduct,
  })
  if (
    verdict === result.verdict &&
    comparisons.every((c, i) => c === result.comparisons[i])
  ) {
    return result
  }
  return { ...result, comparisons, verdict }
}
