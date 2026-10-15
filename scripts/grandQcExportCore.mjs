import { titleSimilarityPercent } from './qcTitleLexical.mjs'

/** Full QC Excel/CSV column layout (Export page + Sandbox pipeline). */
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
]

const BLANK_MARKERS = new Set(['—', '-', 'n/a', 'na', 'null', 'undefined'])

export function pickString(...values) {
  for (const v of values) {
    if (v == null) continue
    const s = String(v).trim()
    if (!s) continue
    if (BLANK_MARKERS.has(s.toLowerCase())) continue
    return s
  }
  return ''
}

export function outcomeToYesNo(outcome) {
  if (outcome === 'MATCH') return 'YES'
  if (outcome === 'MISMATCH') return 'NO'
  return ''
}

export function passToYesNo(pass) {
  if (pass === true || pass === 'PASS') return 'YES'
  if (pass === false || pass === 'FAIL') return 'NO'
  return ''
}

function normalizeTextBlob(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Export-only informational YES/NO for long text fields.
 * @param {string} a
 * @param {string} b
 */
export function exportTextOverlapYesNo(a, b) {
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

export function exportSpecsYesNo(vendorSpecsJson, amazonSpecsJson) {
  if (!vendorSpecsJson?.trim() || !amazonSpecsJson?.trim()) return ''
  return exportTextOverlapYesNo(vendorSpecsJson, amazonSpecsJson)
}

export function titleComparisonYesNo(result, titleScore) {
  if (result?.titleSameProduct === true) return 'YES'
  if (result?.titleSameProduct === false) return 'NO'
  if (titleScore === 100) return 'YES'
  if (titleScore === 0) return 'NO'
  return ''
}

export function titleTokenSimilarityFromResult(result, vendorTitle, amazonTitle) {
  if (result?.titleTokenSimilarity != null && Number.isFinite(Number(result.titleTokenSimilarity))) {
    return Number(result.titleTokenSimilarity)
  }
  return titleSimilarityPercent(vendorTitle, amazonTitle)
}

export function formatPriceUsd(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return n.toFixed(2)
}

export function amazonAsinUrl(asin) {
  const id = pickString(asin)
  if (!id) return ''
  return `https://www.amazon.com/dp/${id}`
}

/**
 * Compliance column for QC Excel/CSV: RESTRICTION when vendor scrape found a sales restriction, else OK.
 * @param {object} [vendor]
 */
export function exportComplianceColumn(vendor) {
  const v = vendor ?? {}
  const attrs = v.rawAttributes && typeof v.rawAttributes === 'object' ? v.rawAttributes : {}
  const compliance = pickString(v.compliance, attrs.compliance)
  const remarks = pickString(v.remarks, attrs.remarks)
  const restrictionText = pickString(attrs.restrictionText)
  if (restrictionText) return 'RESTRICTION'
  if (remarks) return 'RESTRICTION'
  if (/non\s*compliant/i.test(compliance)) return 'RESTRICTION'
  return 'OK'
}
