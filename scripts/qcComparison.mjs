import { comparePackSize } from './researchData.mjs'
import { loadAnthropicApiKey } from './qcCredentialReader.mjs'
import {
  coerceAiImageUrl,
  coerceAiPromptText,
  lenientModelNumberMatch,
  logDebugAiInputs,
  scoreModelNumberMatch,
  scoreProductMatch,
} from './qcAiSimilarity.mjs'
import { formatUsd, resolveAiQcConfig, tokenCostUsd } from './aiQcConfig.mjs'
import { logBatchMetricsSummary, recordAiSkuProcessed } from './aiUsageMetrics.mjs'
import {
  classifyImageConditionScore,
  classifyTitleConditionScore,
  deriveQcVerdictFromConditionScores,
} from './qcVerdictCore.mjs'
import { brandNamesMatch } from './brandNameMatch.mjs'

const PASS = 'PASS'
const FAIL = 'FAIL'

function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '')
}

function pickString(...values) {
  for (const v of values) {
    const s = String(v ?? '').trim()
    if (s) return s
  }
  return ''
}

const DEFAULT_SIMILARITY_THRESHOLD_PERCENT = 70

/** @param {unknown} value */
export function resolveSimilarityThresholdPercent(value, fallback = DEFAULT_SIMILARITY_THRESHOLD_PERCENT) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function resolveThresholds(settings) {
  return {
    titleThreshold: resolveSimilarityThresholdPercent(
      settings?.titleThreshold ?? settings?.titleSimilarityPercent,
    ),
    imageThreshold: resolveSimilarityThresholdPercent(
      settings?.imageThreshold ?? settings?.imageSimilarityPercent,
    ),
  }
}

function resolveQcAiSettings(settings) {
  return {
    qcTitleLexicalHybrid: settings?.qcTitleLexicalHybrid !== false,
    qcAggressiveAiCostMode: settings?.qcAggressiveAiCostMode === true,
    qcModelAiEnabled: settings?.qcModelAiEnabled === true,
  }
}

/**
 * @param {string} vendorUpc
 * @param {string} amazonUpc
 */
function upcExactMatch(vendorUpc, amazonUpc) {
  const v = digitsOnly(vendorUpc)
  const a = digitsOnly(amazonUpc)
  if (!v || !a) return false
  if (v === a) return true
  const stripLeading = (s) => s.replace(/^0+/, '') || '0'
  return stripLeading(v) === stripLeading(a)
}

function vendorSku(vendorData) {
  return pickString(
    vendorData?.sku,
    vendorData?.modelNumberSku,
    vendorData?.modelNumber,
    vendorData?.part_sku,
  )
}

function vendorTitle(vendorData) {
  return coerceAiPromptText(
    pickString(vendorData?.productTitle, vendorData?.title, vendorData?.name),
    'No Title Found',
  )
}

function vendorBrand(vendorData) {
  return pickString(vendorData?.brandName, vendorData?.brand)
}

function vendorImage(vendorData) {
  const fromAttrs = vendorData?.rawAttributes?.imageUrl ?? vendorData?.rawAttributes?.image
  return coerceAiImageUrl(
    pickString(vendorData?.image, vendorData?.imageUrl, fromAttrs),
  )
}

function amazonTitle(amazonData) {
  const fromSp = amazonData?.rawAttributes?.spApi
  const summaryTitle =
    fromSp && typeof fromSp === 'object'
      ? pickString(
          fromSp.summaries?.[0]?.itemName,
          Array.isArray(fromSp.summaries) ? fromSp.summaries[0]?.itemName : '',
        )
      : ''
  return coerceAiPromptText(
    pickString(amazonData?.title, amazonData?.itemName, summaryTitle),
    'No Title Found',
  )
}

function amazonBrand(amazonData) {
  return pickString(amazonData?.brand)
}

function amazonModel(amazonData) {
  return pickString(amazonData?.modelNumber, amazonData?.part_number)
}

function amazonImage(amazonData) {
  const urls = amazonData?.rawAttributes?.imageUrls
  const firstListed = Array.isArray(urls) ? pickString(urls[0]) : ''
  return coerceAiImageUrl(
    pickString(amazonData?.imageUrl, amazonData?.image, firstListed),
  )
}

/**
 * @param {unknown} err
 */
function aiErrorTokenUsage(err) {
  const e = err && typeof err === 'object' ? err : {}
  return {
    inputTokens: Number(e.inputTokens) || 0,
    outputTokens: Number(e.outputTokens) || 0,
  }
}

function scoreToCondition(pass) {
  return pass ? PASS : FAIL
}

function packEvidenceString(packResult) {
  const v = (packResult?.vendor?.evidence ?? []).join('; ')
  const a = (packResult?.amazon?.evidence ?? []).join('; ')
  return { vendor: v, amazon: a }
}

/**
 * Compare scraped vendor JSON with Amazon SP-API JSON.
 */
export async function runQC(vendorData, amazonData, settings = {}, options = {}) {
  const thresholds = resolveThresholds(settings)
  const aiSettings = resolveQcAiSettings(settings)
  const conditionScores = {
    packSize: FAIL,
    brand: FAIL,
    model: FAIL,
    upc: FAIL,
    title: FAIL,
    image: FAIL,
  }

  const packResult = comparePackSize(vendorData ?? {}, amazonData ?? {})
  conditionScores.packSize = scoreToCondition(packResult.pass)
  const packEvidence = packEvidenceString(packResult)

  const brandMatch = brandNamesMatch(vendorBrand(vendorData), amazonBrand(amazonData))
  conditionScores.brand = scoreToCondition(brandMatch)
  const upcMatch = upcExactMatch(vendorData?.upc, amazonData?.upc)
  conditionScores.upc = scoreToCondition(upcMatch)

  const apiKey = options.apiKey?.trim() || (await loadAnthropicApiKey())
  const aiConfig = resolveAiQcConfig({ ...settings, ...options })
  const aiOptions = {
    aiQcModelId: aiConfig.model,
    model: aiConfig.model,
    rates: { inputPerM: aiConfig.inputPerM, outputPerM: aiConfig.outputPerM },
  }

  let titleScore = null
  let imageScore = null
  let titleSameProduct = null
  let inputTokens = 0
  let outputTokens = 0
  let modelUsed = aiConfig.model

  const sku = vendorSku(vendorData)
  const vendorModelValue = sku
  const amazonModelValue = amazonModel(amazonData)

  let modelPass = lenientModelNumberMatch(vendorModelValue, amazonModelValue)
  if (!modelPass && aiSettings.qcModelAiEnabled) {
    try {
      const modelResult = await scoreModelNumberMatch(
        vendorModelValue,
        amazonModelValue,
        apiKey,
        aiOptions,
      )
      modelPass = modelResult.match
      inputTokens += modelResult.inputTokens
      outputTokens += modelResult.outputTokens
      modelUsed = modelResult.model || modelUsed
    } catch {
      modelPass = false
    }
  }
  conditionScores.model = scoreToCondition(modelPass)

  const resolvedVendorTitle = vendorTitle(vendorData)
  const resolvedAmazonTitle = amazonTitle(amazonData)
  const resolvedVendorImage = vendorImage(vendorData)
  const resolvedAmazonImage = amazonImage(amazonData)

  logDebugAiInputs(
    vendorData,
    amazonData,
    {
      vendorTitle: resolvedVendorTitle,
      amazonTitle: resolvedAmazonTitle,
      vendorImage: resolvedVendorImage || '(missing image URL)',
      amazonImage: resolvedAmazonImage || '(missing image URL)',
    },
    typeof options.onDebugLog === 'function' ? options.onDebugLog : undefined,
  )

  let titleTokenSimilarity = 0
  try {
    const match = await scoreProductMatch(
      resolvedVendorTitle,
      resolvedAmazonTitle,
      resolvedVendorImage,
      resolvedAmazonImage,
      apiKey,
      {
        ...aiOptions,
        onDebugLog: options.onDebugLog,
      },
    )
    inputTokens += match.inputTokens
    outputTokens += match.outputTokens
    modelUsed = match.model || modelUsed
    titleScore = match.titleScore
    imageScore = match.imageScore
    titleTokenSimilarity = match.titleScore
    titleSameProduct = match.titleSameProduct
    conditionScores.title = classifyTitleConditionScore(
      titleScore,
      thresholds.titleThreshold,
      false,
    )
    conditionScores.image = classifyImageConditionScore(
      imageScore,
      thresholds.imageThreshold,
      false,
    )
  } catch (err) {
    const usage = aiErrorTokenUsage(err)
    inputTokens += usage.inputTokens
    outputTokens += usage.outputTokens
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[QC product match]', msg)
    options.onDebugLog?.(`[QC product match] ${msg}`)
    titleScore = 0
    imageScore = 0
    titleTokenSimilarity = 0
    titleSameProduct = false
    conditionScores.title = FAIL
    conditionScores.image = FAIL
  }

  const verdict = deriveQcVerdictFromConditionScores(conditionScores)
  const callCost = tokenCostUsd(inputTokens, outputTokens, aiOptions.rates)

  console.log(`QC AI model used: ${modelUsed}`)
  console.log(`QC SKU ${sku} — input tokens: ${inputTokens}, output tokens: ${outputTokens}`)
  console.log(`QC SKU ${sku} — cost: ${formatUsd(callCost)}`)

  recordAiSkuProcessed()
  logBatchMetricsSummary(aiOptions.rates)

  return {
    asin: pickString(amazonData?.asin),
    sku,
    verdict,
    conditionScores,
    titleScore,
    imageScore,
    titleSameProduct,
    titleTokenSimilarity,
    compliance: pickString(vendorData?.compliance, 'COMPLIANT'),
    remarks: String(vendorData?.remarks ?? ''),
    inputTokens,
    outputTokens,
    model: modelUsed,
    costUsd: callCost,
    packEvidenceVendor: packEvidence.vendor,
    packEvidenceAmazon: packEvidence.amazon,
  }
}
