import type { QcResult } from '../types/qc'

type TitleScoreSource = {
  titleScore?: number | null
  titleSameProduct?: boolean | null
}

type ImageScoreSource = {
  imageScore?: number | null
}

/** Claude title 0–100 similarity for UI and export (not lexical token overlap). */
export function normalizeTitleAiScorePercent(source: TitleScoreSource): number | null {
  const raw = source.titleScore
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (source.titleSameProduct === true) return 100
  if (source.titleSameProduct === false) return 0
  return null
}

export function normalizeImageAiScorePercent(source: ImageScoreSource): number | null {
  const raw = source.imageScore
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  return null
}

export function resolveTitleSimilarityDisplayPercent(result: QcResult): number | null {
  return normalizeTitleAiScorePercent(result)
}

export function resolveImageSimilarityDisplayPercent(result: QcResult): number | null {
  return normalizeImageAiScorePercent(result)
}

const IMAGE_PACKAGING_MISMATCH_MAX = 35
const IMAGE_GRAY_ZONE_MIN = 40
const IMAGE_GRAY_ZONE_MAX = 60
const TITLE_GRAY_ZONE_MIN = IMAGE_GRAY_ZONE_MIN
const TITLE_GRAY_ZONE_MAX = IMAGE_GRAY_ZONE_MAX

/** Mirrors scripts/qcVerdictCore.mjs `classifyImageConditionScore` for UI labels. */
export function imageCompareOutcomeFromScore(
  score: number | null,
  threshold: number,
): 'MATCH' | 'MISMATCH' | 'REVIEW' {
  if (score == null || !Number.isFinite(score)) return 'REVIEW'
  if (score <= IMAGE_PACKAGING_MISMATCH_MAX) return 'MISMATCH'
  if (score < IMAGE_GRAY_ZONE_MIN) return 'MISMATCH'
  if (score <= IMAGE_GRAY_ZONE_MAX) return 'REVIEW'
  if (score >= threshold) return 'MATCH'
  return 'REVIEW'
}

/** Mirrors scripts/qcVerdictCore.mjs `classifyTitleConditionScore` for UI labels. */
export function titleCompareOutcomeFromScore(
  score: number | null,
  threshold: number,
): 'MATCH' | 'MISMATCH' | 'REVIEW' {
  if (score == null || !Number.isFinite(score)) return 'REVIEW'
  if (score >= threshold) return 'MATCH'
  if (score >= TITLE_GRAY_ZONE_MIN && score <= TITLE_GRAY_ZONE_MAX) return 'REVIEW'
  if (score < TITLE_GRAY_ZONE_MIN) return 'MISMATCH'
  if (score < threshold) return 'REVIEW'
  return 'MATCH'
}
