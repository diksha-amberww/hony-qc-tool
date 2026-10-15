import type { SandboxQcResult } from '../../data/sandboxQc'
import type { QcResult } from '../../types/qc'
import {
  normalizeImageAiScorePercent,
  normalizeTitleAiScorePercent,
} from '../../utils/qcSimilarityDisplay'

/** Map sandbox QC engine output into the live-results `QcResult` shape. */
export function sandboxQcResultToQcResult(result: SandboxQcResult): QcResult {
  const sku =
    result.identity.find((f) => f.key === 'sku')?.value ??
    result.identity.find((f) => f.key === 'listing_id')?.value ??
    result.identity[0]?.value ??
    'SKU'
  const id = `sandbox_${Date.now()}_${sku}`

  return {
    id,
    identity: result.identity,
    verdict: result.verdict,
    comparisons: result.comparisons.map(({ key, label, sourceValue, targetValue, outcome }) => ({
      key,
      label,
      sourceValue,
      targetValue,
      outcome,
    })),
    sourceColumnLabel: 'Vendor',
    targetColumnLabel: 'Amazon',
    sourceImageUrl: result.vendorExtract.imageUrl,
    targetImageUrl: result.asinExtract.imageUrl,
    sourceRawExtract: result.vendorExtract,
    targetRawExtract: result.asinExtract,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    titleScore: normalizeTitleAiScorePercent(result),
    imageScore: normalizeImageAiScorePercent(result),
    inputRowUpc: result.inputRowUpc,
    titleSameProduct: result.titleSameProduct ?? null,
    titleTokenSimilarity: result.titleTokenSimilarity ?? null,
    costUsd: result.costUsd ?? null,
    runSource: 'sandbox',
    qcModel: result.qcModel ?? undefined,
    packEvidenceVendor: result.packEvidenceVendor,
    packEvidenceAmazon: result.packEvidenceAmazon,
  }
}
