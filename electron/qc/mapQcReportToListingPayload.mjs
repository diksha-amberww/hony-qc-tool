import {
  normalizeImageAiScorePercent,
  normalizeTitleAiScorePercent,
} from '../../scripts/qcSimilarityScores.mjs'
import {
  classifyImageConditionScore,
  classifyTitleConditionScore,
  conditionScoreToComparisonOutcome,
  deriveQcVerdictFromComparisons,
  deriveQcVerdictFromConditionScores,
} from '../../scripts/qcVerdictCore.mjs'

function pickRow(row, ...keys) {
  for (const key of keys) {
    const v = row?.[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

function formatPriceUsd(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

function outcomeFromConditionScore(condition) {
  return conditionScoreToComparisonOutcome(condition)
}

function outcomeFromAiScore(score, classify, threshold) {
  if (typeof score === 'number' && Number.isFinite(score)) {
    return outcomeFromConditionScore(classify(score, threshold, false))
  }
  return null
}

/**
 * @param {import('../vendor/vendorScrapeTypes.mjs').VendorListingExtract} vendorExtract
 * @param {object} amazonExtract
 * @param {Record<string, string>} row
 * @param {object} qcReport
 * @param {{ titleThreshold: number, imageThreshold: number }} thresholds
 * @param {{ inputTokens: number, outputTokens: number }} tokens
 */
export function mapQcReportToListingPayload(
  vendorExtract,
  amazonExtract,
  row,
  qcReport,
  thresholds,
  tokens,
) {
  const vendorPrice = formatPriceUsd(vendorExtract.rawAttributes?.priceUsd ?? 0)
  const amazonPrice = formatPriceUsd(amazonExtract.rawAttributes?.priceUsd ?? 0)

  const titleOutcome =
    outcomeFromAiScore(
      normalizeTitleAiScorePercent(qcReport),
      classifyTitleConditionScore,
      thresholds.titleThreshold,
    ) ?? outcomeFromConditionScore(qcReport.conditionScores?.title)
  const imageOutcome =
    outcomeFromAiScore(
      normalizeImageAiScorePercent(qcReport),
      classifyImageConditionScore,
      thresholds.imageThreshold,
    ) ?? outcomeFromConditionScore(qcReport.conditionScores?.image)

  const comparisons = [
    {
      key: 'title',
      label: 'Title',
      sourceValue: vendorExtract.title,
      targetValue: amazonExtract.title,
      outcome: titleOutcome,
    },
    {
      key: 'image',
      label: 'Image',
      sourceValue: vendorExtract.imageUrl,
      targetValue: amazonExtract.imageUrl,
      outcome: imageOutcome,
    },
    {
      key: 'price',
      label: 'Price',
      sourceValue: vendorPrice,
      targetValue: amazonPrice,
      outcome:
        vendorPrice === amazonPrice || Math.abs(Number(vendorPrice) - Number(amazonPrice)) < 0.01
          ? 'MATCH'
          : 'REVIEW',
    },
    {
      key: 'brand',
      label: 'Brand',
      sourceValue: vendorExtract.brand,
      targetValue: amazonExtract.brand,
      outcome: outcomeFromConditionScore(qcReport.conditionScores?.brand),
    },
    {
      key: 'model',
      label: 'Model Number',
      sourceValue: vendorExtract.modelNumber,
      targetValue: amazonExtract.modelNumber,
      outcome: outcomeFromConditionScore(qcReport.conditionScores?.model),
    },
    {
      key: 'pack',
      label: 'Pack Size',
      sourceValue: vendorExtract.packSize,
      targetValue: amazonExtract.packSize,
      outcome: outcomeFromConditionScore(qcReport.conditionScores?.packSize),
    },
    {
      key: 'upc',
      label: 'UPC',
      sourceValue: pickRow(row, 'upc', 'UPC', 'barcode') || vendorExtract.upc,
      targetValue: amazonExtract.upc,
      outcome: outcomeFromConditionScore(qcReport.conditionScores?.upc),
    },
  ]

  const sku = vendorExtract.sku || pickRow(row, 'part_sku', 'sku') || 'SKU-UNKNOWN'
  const asin = amazonExtract.asin || pickRow(row, 'asin')
  const brand = vendorExtract.brand || pickRow(row, 'brand')

  const identity = [
    { key: 'sku', label: 'SKU', value: sku },
    { key: 'listing_id', label: 'ASIN', value: asin },
    { key: 'brand', label: 'Brand', value: brand },
  ]

  const verdict =
    qcReport?.conditionScores && typeof qcReport.conditionScores === 'object'
      ? deriveQcVerdictFromConditionScores(qcReport.conditionScores)
      : deriveQcVerdictFromComparisons(comparisons)

  const inputRowUpc = pickRow(row, 'upc', 'UPC', 'barcode')

  return {
    identity,
    verdict,
    comparisons,
    asinExtract: amazonExtract,
    vendorExtract,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    inputRowUpc,
    titleScore: normalizeTitleAiScorePercent(qcReport),
    imageScore: normalizeImageAiScorePercent(qcReport),
    titleSameProduct: qcReport.titleSameProduct ?? null,
    titleTokenSimilarity: qcReport.titleTokenSimilarity ?? null,
    costUsd: qcReport.costUsd ?? null,
    qcModel: qcReport.model ?? null,
    packEvidenceVendor: qcReport.packEvidenceVendor ?? '',
    packEvidenceAmazon: qcReport.packEvidenceAmazon ?? '',
  }
}
