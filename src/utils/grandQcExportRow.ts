import type { QcResult } from '../types/qc'
import type { AmazonListingExtract, VendorListingExtract } from '../types/listingExtract'
import { titleSimilarityPercent } from './qcThresholdComparison'

export const GRAND_QC_EXPORT_HEADERS = [
  'ASIN',
  'VENDOR MODEL',
  'VERDICT',
  'Compliance',
  'Pack Size Vendor',
  'Pack Size Amazon',
  'Pack Size Result',
  'Brand Vendor',
  'Brand Amazon',
  'Brand Result',
  'Title Vendor',
  'Title Amazon',
  'Title Token Similarity %',
  'Title Comparison',
  'Title Comparison Percentage',
  'Title Result',
  'Model Number Vendor',
  'Model Number Amazon',
  'Model Number Result',
  'UPC Vendor',
  'UPC Amazon',
  'UPC Result',
  'Image Comparison Percentage',
  'Image Result',
  'Vendor_packLabel',
  'Vendor_caseQuantity',
  'Vendor_restrictionText',
  'Vendor_packagedQuantity',
  'Vendor_vendorPackagedQuantity',
  'Vendor_packSize',
  'Vendor_packQuantity',
  'Vendor_minOrderQty',
  'Amazon_item_package_quantity',
  'Amazon_number_of_items',
  'Amazon_size',
  'Amazon_unit_count',
  'Amazon_item_form',
  'Amazon_package_contains_identifier',
  'Amazon_packSize',
  'Amazon_packQuantity',
  'Pack Size Evidence Vendor',
  'Pack Size Evidence Amazon',
  'Specifications full list Amazon',
  'Specifications full list Vendor',
  'Specifications Result',
  'Description Vendor',
  'Description Amazon',
  'Description Result',
  'Price Vendor',
  'Price Amazon',
  'Price Result',
  'Vendor URL',
  'Amazon ASIN URL',
  'QC AI Input Tokens',
  'QC AI Output Tokens',
  'QC AI Cost USD',
  'QC Model',
  'Reason for Verdict',
  'Run Source',
] as const

const BLANK_MARKERS = new Set(['—', '-', 'n/a', 'na', 'null', 'undefined'])

function pickString(...values: unknown[]): string {
  for (const v of values) {
    if (v == null) continue
    const s = String(v).trim()
    if (!s) continue
    if (BLANK_MARKERS.has(s.toLowerCase())) continue
    return s
  }
  return ''
}

function outcomeToYesNo(outcome?: string): string {
  if (outcome === 'MATCH') return 'YES'
  if (outcome === 'MISMATCH') return 'NO'
  return ''
}

function normalizeTextBlob(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function exportTextOverlapYesNo(a: string, b: string): string {
  const left = normalizeTextBlob(a)
  const right = normalizeTextBlob(b)
  if (!left || !right) return ''
  const tokensA = left.split(' ').filter(Boolean)
  const tokensB = new Set(right.split(' ').filter(Boolean))
  if (tokensA.length === 0 || tokensB.size === 0) return ''
  const matches = tokensA.filter((t) => tokensB.has(t)).length
  const pct = matches / Math.max(tokensA.length, tokensB.size)
  return pct >= 0.45 ? 'YES' : 'NO'
}

function exportSpecsYesNo(vendorSpecsJson: string, amazonSpecsJson: string): string {
  if (!vendorSpecsJson.trim() || !amazonSpecsJson.trim()) return ''
  return exportTextOverlapYesNo(vendorSpecsJson, amazonSpecsJson)
}

function identityValue(result: QcResult, ...keys: string[]): string {
  for (const key of keys) {
    const field = result.identity.find((f) => f.key === key)
    if (field?.value?.trim()) return field.value.trim()
  }
  return ''
}

function findComparison(result: QcResult, key: string) {
  return (
    result.comparisons.find((c) => c.key === key) ??
    (key === 'packSize' ? result.comparisons.find((c) => c.key === 'pack') : undefined)
  )
}

function verdictLabel(verdict: string): string {
  return verdict.replace(/_/g, ' ')
}

function attrString(attrs: Record<string, unknown> | undefined, key: string): string {
  if (!attrs) return ''
  const v = attrs[key]
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

function amazonSpAttribute(amazon: AmazonListingExtract | undefined, attrKey: string): string {
  const sp = amazon?.rawAttributes?.spApi as { attributes?: Record<string, unknown> } | undefined
  const attributes = sp?.attributes ?? amazon?.rawAttributes
  if (!attributes || typeof attributes !== 'object') return ''
  const node = (attributes as Record<string, unknown>)[attrKey]
  if (!node) return ''
  if (Array.isArray(node) && node[0] && typeof node[0] === 'object' && 'value' in node[0]) {
    return String((node[0] as { value: unknown }).value).trim()
  }
  if (typeof node === 'string') return node.trim()
  return ''
}

function stringifySpecs(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return ''
  try {
    if (Object.keys(obj as object).length === 0) return ''
    const json = JSON.stringify(obj)
    if (json === '{}' || json === '[]') return ''
    return json
  } catch {
    return ''
  }
}

function stripTitleScoreSuffix(title: string): string {
  return title.replace(/\s*\(score\s+\d+\)\s*$/i, '').trim()
}

function buildReasonForVerdict(result: QcResult): string {
  const errorField = findComparison(result, 'error')
  if (errorField?.targetValue) return errorField.targetValue
  if (result.verdict === 'PASS') return ''
  const failed = result.comparisons
    .filter((c) => c.key !== 'error' && c.outcome === 'MISMATCH')
    .map((c) => c.label)
  if (failed.length) return failed.join(', ')
  return ''
}

function titleComparisonYesNo(result: QcResult, titleScore: number | ''): string {
  if (result.titleSameProduct === true) return 'YES'
  if (result.titleSameProduct === false) return 'NO'
  if (titleScore === 100) return 'YES'
  if (titleScore === 0) return 'NO'
  return ''
}

function formatPriceUsd(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return n.toFixed(2)
}

function amazonAsinUrl(asin: string): string {
  const id = pickString(asin)
  if (!id) return ''
  return `https://www.amazon.com/dp/${id}`
}

function exportComplianceColumn(
  vendor: {
    compliance?: string
    remarks?: string
    rawAttributes?: Record<string, unknown>
  } | null
  | undefined,
): 'RESTRICTION' | 'OK' {
  const v = vendor ?? {}
  const attrs = v.rawAttributes ?? {}
  const compliance = pickString(v.compliance, attrString(attrs, 'compliance'))
  const remarks = pickString(v.remarks, attrString(attrs, 'remarks'))
  const restrictionText = pickString(attrString(attrs, 'restrictionText'))
  if (restrictionText) return 'RESTRICTION'
  if (remarks) return 'RESTRICTION'
  if (/non\s*compliant/i.test(compliance)) return 'RESTRICTION'
  return 'OK'
}

export function mapGrandQcExportRowFromQcResult(result: QcResult): (string | number)[] {
  const vendor = (result.sourceRawExtract ?? {}) as VendorListingExtract & {
    description?: string
    compliance?: string
    remarks?: string
    pageUrl?: string
    productTitle?: string
    rawAttributes?: Record<string, unknown>
  }
  const amazon = (result.targetRawExtract ?? {}) as AmazonListingExtract

  const pack = findComparison(result, 'packSize')
  const brand = findComparison(result, 'brand')
  const title = findComparison(result, 'title')
  const model = findComparison(result, 'model')
  const upc = findComparison(result, 'upc')
  const image = findComparison(result, 'image')
  const price = findComparison(result, 'price')

  const vendorAttrs = vendor.rawAttributes ?? {}

  const titleScore =
    result.titleScore != null && Number.isFinite(result.titleScore)
      ? result.titleScore
      : (() => {
          const m = title?.targetValue?.match(/\(score\s+(\d+)\)/i)
          return m ? Number(m[1]) : ''
        })()

  const imageScore =
    result.imageScore != null && Number.isFinite(result.imageScore) ? result.imageScore : ''

  const titleVendor = pickString(title?.sourceValue, vendor.title, vendor.productTitle)
  const titleAmazon = pickString(stripTitleScoreSuffix(title?.targetValue ?? ''), amazon.title)
  const titleTokenSim =
    result.titleTokenSimilarity != null && Number.isFinite(result.titleTokenSimilarity)
      ? result.titleTokenSimilarity
      : titleSimilarityPercent(titleVendor, titleAmazon)

  const amazonSpecs = stringifySpecs(
    (amazon.rawAttributes?.spApi as { attributes?: unknown })?.attributes ?? amazon.rawAttributes,
  )
  const vendorSpecsCorrect = stringifySpecs(vendorAttrs)
  const vendorDesc = pickString(vendor.description, attrString(vendorAttrs, 'description'))
  const amazonDesc = pickString(amazonSpAttribute(amazon, 'product_description'))

  const asin = pickString(identityValue(result, 'listing_id', 'asin'), amazon.asin)

  const costStr =
    result.costUsd != null && Number.isFinite(result.costUsd) ? result.costUsd.toFixed(4) : ''

  return [
    asin,
    pickString(identityValue(result, 'sku', 'part_sku'), vendor.sku, vendor.modelNumber),
    verdictLabel(result.verdict),
    exportComplianceColumn(vendor),
    pickString(pack?.sourceValue, vendor.packSize),
    pickString(pack?.targetValue, amazon.packSize),
    outcomeToYesNo(pack?.outcome),
    pickString(brand?.sourceValue, vendor.brand),
    pickString(brand?.targetValue, amazon.brand),
    outcomeToYesNo(brand?.outcome),
    titleVendor,
    titleAmazon,
    titleTokenSim,
    titleComparisonYesNo(result, titleScore),
    titleScore,
    titleComparisonYesNo(result, titleScore),
    pickString(model?.sourceValue, vendor.modelNumber),
    pickString(model?.targetValue, amazon.modelNumber),
    outcomeToYesNo(model?.outcome),
    pickString(result.inputRowUpc, identityValue(result, 'upc'), upc?.sourceValue, vendor.upc),
    pickString(upc?.targetValue, amazon.upc),
    outcomeToYesNo(upc?.outcome),
    imageScore,
    outcomeToYesNo(image?.outcome),
    attrString(vendorAttrs, 'packLabel'),
    attrString(vendorAttrs, 'caseQuantity'),
    attrString(vendorAttrs, 'restrictionText'),
    attrString(vendorAttrs, 'packagedQuantity'),
    attrString(vendorAttrs, 'vendorPackagedQuantity'),
    pickString(attrString(vendorAttrs, 'packSize'), vendor.packSize),
    attrString(vendorAttrs, 'packQuantity'),
    attrString(vendorAttrs, 'minOrderQty'),
    amazonSpAttribute(amazon, 'item_package_quantity'),
    amazonSpAttribute(amazon, 'number_of_items'),
    amazonSpAttribute(amazon, 'size'),
    amazonSpAttribute(amazon, 'unit_count'),
    amazonSpAttribute(amazon, 'item_form'),
    amazonSpAttribute(amazon, 'package_contains_identifier'),
    pickString(amazonSpAttribute(amazon, 'item_package_quantity'), amazon.packSize),
    amazonSpAttribute(amazon, 'number_of_items'),
    pickString(result.packEvidenceVendor),
    pickString(result.packEvidenceAmazon),
    amazonSpecs,
    vendorSpecsCorrect,
    exportSpecsYesNo(vendorSpecsCorrect, amazonSpecs),
    vendorDesc,
    amazonDesc,
    exportTextOverlapYesNo(vendorDesc, amazonDesc),
    pickString(price?.sourceValue, formatPriceUsd(vendorAttrs.priceUsd)),
    pickString(price?.targetValue, formatPriceUsd(amazon.rawAttributes?.priceUsd)),
    outcomeToYesNo(price?.outcome),
    pickString(vendor.pageUrl, attrString(vendorAttrs, 'pageUrl'), attrString(vendorAttrs, 'url')),
    amazonAsinUrl(asin),
    result.inputTokens ?? '',
    result.outputTokens ?? '',
    costStr,
    pickString(result.qcModel),
    buildReasonForVerdict(result),
    result.runSource === 'sandbox'
      ? 'Sandbox'
      : result.runSource === 'upload'
        ? 'Upload'
        : pickString(result.runSource),
  ]
}
