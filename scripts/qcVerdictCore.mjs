/** Core checks for final PASS / FAIL / MANUAL_REVIEW. */
export const QC_CORE_VERDICT_KEYS = Object.freeze([
  'brand',
  'model',
  'title',
  'pack',
  'image',
  'upc',
])

export const IMAGE_GRAY_ZONE_MIN = 40
export const IMAGE_GRAY_ZONE_MAX = 60
/** AI / pixel fallback: different retail packaging (cap vs pump, box vs bottle, etc.). */
export const IMAGE_PACKAGING_MISMATCH_MAX = 35
export const TITLE_GRAY_ZONE_MIN = IMAGE_GRAY_ZONE_MIN
export const TITLE_GRAY_ZONE_MAX = IMAGE_GRAY_ZONE_MAX

/**
 * @param {string | undefined | null} condition
 * @returns {'MATCH' | 'MISMATCH' | 'REVIEW'}
 */
export function conditionScoreToComparisonOutcome(condition) {
  if (condition === 'PASS') return 'MATCH'
  if (condition === 'REVIEW') return 'REVIEW'
  return 'MISMATCH'
}

/**
 * Map a 0–100 similarity score to PASS/FAIL/REVIEW using the slider threshold.
 * Score >= threshold → PASS. Gray zone (40–60) below threshold → REVIEW. Very low → FAIL.
 * Between gray-zone max and threshold → REVIEW.
 * @param {number | null} parsedScore
 * @param {number} threshold
 * @param {boolean} unavailable
 * @returns {'PASS' | 'FAIL' | 'REVIEW'}
 */
export function classifySimilarityConditionScore(parsedScore, threshold, unavailable) {
  if (unavailable || parsedScore == null || !Number.isFinite(parsedScore)) return 'REVIEW'
  if (parsedScore >= threshold) return 'PASS'
  if (parsedScore >= IMAGE_GRAY_ZONE_MIN && parsedScore <= IMAGE_GRAY_ZONE_MAX) return 'REVIEW'
  if (parsedScore < IMAGE_GRAY_ZONE_MIN) return 'FAIL'
  if (parsedScore < threshold) return 'REVIEW'
  return 'PASS'
}

/**
 * Image PASS needs score above gray zone AND >= slider — low scores cannot PASS on a low threshold.
 * Packaging mismatch band (0–35) is always FAIL.
 */
export function classifyImageConditionScore(parsedScore, threshold, unavailable) {
  if (unavailable || parsedScore == null || !Number.isFinite(parsedScore)) return 'REVIEW'
  if (parsedScore <= IMAGE_PACKAGING_MISMATCH_MAX) return 'FAIL'
  if (parsedScore < IMAGE_GRAY_ZONE_MIN) return 'FAIL'
  if (parsedScore <= IMAGE_GRAY_ZONE_MAX) return 'REVIEW'
  if (parsedScore >= threshold) return 'PASS'
  return 'REVIEW'
}

/** Map title model 0–100 score against `titleSimilarityPercent`. */
export function classifyTitleConditionScore(parsedScore, threshold, unavailable) {
  return classifySimilarityConditionScore(parsedScore, threshold, unavailable)
}

/**
 * @param {Record<string, string>} conditionScores
 * @returns {'PASS' | 'FAIL' | 'MANUAL_REVIEW'}
 */
function conditionScoreForVerdictKey(conditionScores, key) {
  if (key === 'packSize') {
    return conditionScores?.packSize ?? conditionScores?.pack
  }
  return conditionScores?.[key]
}

export function deriveQcVerdictFromConditionScores(conditionScores) {
  const keys = ['brand', 'packSize', 'model', 'title', 'upc', 'image']
  let hasFail = false
  let hasReview = false
  for (const key of keys) {
    const v = conditionScoreForVerdictKey(conditionScores, key)
    if (v === 'FAIL') hasFail = true
    else if (v === 'REVIEW') hasReview = true
    else if (v !== 'PASS') hasFail = true
  }
  if (hasFail) return 'FAIL'
  if (hasReview) return 'MANUAL_REVIEW'
  return 'PASS'
}

/**
 * @param {Array<{ key?: string, outcome?: string }>} comparisons
 * @returns {'PASS' | 'FAIL' | 'MANUAL_REVIEW'}
 */
export function deriveQcVerdictFromComparisons(comparisons) {
  if (!Array.isArray(comparisons)) return 'FAIL'
  let hasMismatch = false
  let hasReview = false
  for (const key of QC_CORE_VERDICT_KEYS) {
    const row =
      comparisons.find((c) => c && c.key === key) ||
      (key === 'pack' ? comparisons.find((c) => c && c.key === 'packSize') : undefined)
    if (!row) return 'FAIL'
    const outcome = row.outcome
    if (!outcome) return 'FAIL'
    if (outcome === 'MISMATCH') hasMismatch = true
    else if (outcome === 'REVIEW') hasReview = true
    else if (outcome !== 'MATCH') hasMismatch = true
  }
  if (hasMismatch) return 'FAIL'
  if (hasReview) return 'MANUAL_REVIEW'
  return 'PASS'
}

/** @deprecated Use deriveQcVerdictFromComparisons */
export const deriveStrictQcVerdict = deriveQcVerdictFromComparisons
