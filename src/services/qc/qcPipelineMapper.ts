import type { SandboxQcResult, SandboxComparison } from '../../data/sandboxQc'
import type { QcPipelineReport, QcPipelineSuccess } from '../../types/qcPipeline'
import type { AmazonListingExtract, VendorListingExtract } from '../../types/listingExtract'
import type { QcCompareOutcome } from '../../utils/qcThresholdComparison'
import {
  normalizeImageAiScorePercent,
  normalizeTitleAiScorePercent,
} from '../../utils/qcSimilarityDisplay'

const COMPARISON_LABELS: Record<string, string> = {
  pack: 'Pack Size',
  packSize: 'Pack Size',
  brand: 'Brand',
  model: 'Model Number',
  upc: 'UPC',
  title: 'Title',
  image: 'Image',
}

function canonicalComparisonKey(key: string): string {
  if (key === 'packSize') return 'pack'
  return key
}

function scoreToOutcome(pass: string | undefined): QcCompareOutcome {
  if (pass === 'PASS') return 'MATCH'
  if (pass === 'REVIEW') return 'REVIEW'
  return 'MISMATCH'
}

function comparisonValues(
  key: string,
  vendor: VendorListingExtract,
  asin: AmazonListingExtract,
): { sourceValue: string; targetValue: string } {
  switch (key) {
    case 'pack':
    case 'packSize':
      return { sourceValue: vendor.packSize, targetValue: asin.packSize }
    case 'brand':
      return { sourceValue: vendor.brand, targetValue: asin.brand }
    case 'model':
      return { sourceValue: vendor.modelNumber, targetValue: asin.modelNumber }
    case 'upc':
      return { sourceValue: vendor.upc, targetValue: asin.upc }
    case 'title':
      return {
        sourceValue: vendor.title,
        targetValue: asin.title,
      }
    case 'image':
      return { sourceValue: vendor.imageUrl, targetValue: asin.imageUrl }
    default:
      return { sourceValue: '—', targetValue: '—' }
  }
}

/** Map pipeline output into Sandbox UI models (comparisons + extracts). */
export function pipelineSuccessToSandboxQcResult(success: QcPipelineSuccess): SandboxQcResult {
  const { qcReport, vendorExtract, asinExtract } = success
  const comparisons: SandboxComparison[] = Object.entries(qcReport.conditionScores).map(
    ([rawKey, pass]) => {
      const key = canonicalComparisonKey(rawKey)
      const { sourceValue, targetValue } = comparisonValues(key, vendorExtract, asinExtract)
      return {
        key,
        label: COMPARISON_LABELS[key] ?? key,
        sourceValue,
        targetValue,
        outcome: scoreToOutcome(pass),
      }
    },
  )

  const inputTokens = Number((qcReport as { inputTokens?: number }).inputTokens) || 0
  const outputTokens = Number((qcReport as { outputTokens?: number }).outputTokens) || 0
  const costUsd = Number((qcReport as { costUsd?: number }).costUsd) || 0

  return {
    identity: [
      { key: 'sku', label: 'SKU', value: qcReport.sku },
      { key: 'listing_id', label: 'ASIN', value: qcReport.asin },
      { key: 'brand', label: 'Brand', value: vendorExtract.brand },
    ],
    verdict: qcReport.verdict,
    comparisons,
    asinExtract,
    vendorExtract,
    fetched: asinExtract,
    inputTokens,
    outputTokens,
    costUsd,
    estimatedX1000Usd: costUsd * 1000,
    titleScore: normalizeTitleAiScorePercent(qcReport),
    imageScore: normalizeImageAiScorePercent(qcReport),
    titleSameProduct: qcReport.titleSameProduct ?? null,
    titleTokenSimilarity: qcReport.titleTokenSimilarity ?? null,
    qcModel: qcReport.model,
    packEvidenceVendor: qcReport.packEvidenceVendor,
    packEvidenceAmazon: qcReport.packEvidenceAmazon,
  }
}
