import {
  GRAND_QC_EXPORT_HEADERS,
  amazonAsinUrl,
  exportSpecsYesNo,
  exportTextOverlapYesNo,
  exportComplianceColumn,
  formatPriceUsd,
  outcomeToYesNo,
  pickString,
  titleComparisonYesNo,
  titleTokenSimilarityFromResult,
} from './grandQcExportCore.mjs'

export { GRAND_QC_EXPORT_HEADERS }

function identityValue(result, ...keys) {
  for (const key of keys) {
    const field = (result?.identity ?? []).find((f) => f.key === key)
    if (field?.value?.trim()) return field.value.trim()
  }
  return ''
}

function findComparison(result, key) {
  const list = result?.comparisons ?? []
  return (
    list.find((c) => c.key === key) ??
    (key === 'packSize' ? list.find((c) => c.key === 'pack') : undefined)
  )
}

function verdictLabel(verdict) {
  const v = String(verdict ?? '').trim()
  if (!v) return ''
  return v.replace(/_/g, ' ')
}

function attrString(attrs, key) {
  if (!attrs || typeof attrs !== 'object') return ''
  const v = attrs[key]
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

function amazonSpAttribute(amazonExtract, attrKey) {
  const sp = amazonExtract?.rawAttributes?.spApi
  const attributes = sp?.attributes ?? amazonExtract?.rawAttributes
  if (!attributes || typeof attributes !== 'object') return ''
  const node = attributes[attrKey]
  if (!node) return ''
  if (Array.isArray(node) && node[0]?.value != null) return String(node[0].value).trim()
  if (typeof node === 'string') return node.trim()
  return ''
}

function stringifySpecs(obj) {
  if (!obj || typeof obj !== 'object') return ''
  try {
    const keys = Object.keys(obj)
    if (keys.length === 0) return ''
    const json = JSON.stringify(obj)
    if (json === '{}' || json === '[]') return ''
    return json
  } catch {
    return ''
  }
}

function amazonSpecifications(amazonExtract) {
  const sp = amazonExtract?.rawAttributes?.spApi
  const attributes = sp?.attributes
  if (attributes && typeof attributes === 'object') return stringifySpecs(attributes)
  return stringifySpecs(amazonExtract?.rawAttributes)
}

function vendorSpecifications(vendorExtract) {
  const attrs = vendorExtract?.rawAttributes
  if (attrs && typeof attrs === 'object') return stringifySpecs(attrs)
  return ''
}

function titleScoreFromResult(result) {
  if (result?.titleScore != null && Number.isFinite(Number(result.titleScore))) {
    return Number(result.titleScore)
  }
  const field = findComparison(result, 'title')
  const m = field?.targetValue?.match(/\(score\s+(\d+)\)/i)
  if (m && Number.isFinite(Number(m[1]))) return Number(m[1])
  if (result?.titleMatchScore != null && Number.isFinite(Number(result.titleMatchScore))) {
    return Number(result.titleMatchScore)
  }
  return ''
}

function imageScoreFromResult(result) {
  if (result?.imageScore != null && Number.isFinite(Number(result.imageScore))) {
    return Number(result.imageScore)
  }
  if (result?.imageMatchScore != null) return Number(result.imageMatchScore)
  return ''
}

function stripTitleScoreSuffix(title) {
  return String(title ?? '').replace(/\s*\(score\s+\d+\)\s*$/i, '').trim()
}

function buildReasonForVerdict(result) {
  const errorField = findComparison(result, 'error')
  if (errorField?.targetValue) return errorField.targetValue
  if (result?.verdict === 'PASS') return ''
  const failed = (result?.comparisons ?? [])
    .filter((c) => c.key !== 'error' && c.outcome === 'MISMATCH')
    .map((c) => c.label)
  if (failed.length) return failed.join(', ')
  return ''
}

function runSourceLabel(source) {
  if (source === 'sandbox') return 'Sandbox'
  if (source === 'upload') return 'Upload'
  return pickString(source) || ''
}

function vendorUpcForExport(result, vendor, upcComparison) {
  return pickString(
    result?.inputRowUpc,
    identityValue(result, 'upc', 'input_upc'),
    upcComparison?.sourceValue,
    vendor?.upc,
  )
}

function priceComparison(result) {
  return findComparison(result, 'price')
}

/**
 * @param {object} result — QcResult-shaped row (Export / Live Output)
 * @returns {(string|number)[]}
 */
export function mapGrandQcExportRowFromQcResult(result) {
  const vendor = result?.sourceRawExtract ?? {}
  const amazon = result?.targetRawExtract ?? {}

  const pack = findComparison(result, 'packSize')
  const brand = findComparison(result, 'brand')
  const title = findComparison(result, 'title')
  const model = findComparison(result, 'model')
  const upc = findComparison(result, 'upc')
  const image = findComparison(result, 'image')
  const price = priceComparison(result)

  const vendorAttrs = vendor?.rawAttributes ?? {}
  const titleScore = titleScoreFromResult(result)
  const imageScore = imageScoreFromResult(result)

  const titleVendor = pickString(title?.sourceValue, vendor?.title, vendor?.productTitle)
  const titleAmazon = pickString(stripTitleScoreSuffix(title?.targetValue), amazon?.title)
  const titleTokenSim = titleTokenSimilarityFromResult(result, titleVendor, titleAmazon)
  const titleCompareYn = titleComparisonYesNo(result, titleScore)

  const vendorSpecs = vendorSpecifications(vendor)
  const amazonSpecs = amazonSpecifications(amazon)
  const vendorDesc = pickString(vendor?.description, attrString(vendorAttrs, 'description'))
  const amazonDesc = pickString(amazon?.description, amazonSpAttribute(amazon, 'product_description'))

  const asin = pickString(identityValue(result, 'listing_id', 'asin'), amazon?.asin)

  const vendorPrice = pickString(
    price?.sourceValue,
    formatPriceUsd(vendorAttrs?.priceUsd),
  )
  const amazonPrice = pickString(
    price?.targetValue,
    formatPriceUsd(amazon?.rawAttributes?.priceUsd),
  )

  const costUsd = result?.costUsd
  const costStr =
    costUsd != null && Number.isFinite(Number(costUsd)) ? Number(costUsd).toFixed(4) : ''

  return [
    asin,
    pickString(identityValue(result, 'sku', 'part_sku'), vendor?.sku, vendor?.modelNumber),
    verdictLabel(result?.verdict),
    exportComplianceColumn(vendor),
    pickString(pack?.sourceValue, vendor?.packSize),
    pickString(pack?.targetValue, amazon?.packSize),
    outcomeToYesNo(pack?.outcome),
    pickString(brand?.sourceValue, vendor?.brand),
    pickString(brand?.targetValue, amazon?.brand),
    outcomeToYesNo(brand?.outcome),
    titleVendor,
    titleAmazon,
    titleTokenSim,
    titleCompareYn,
    titleScore,
    titleCompareYn,
    pickString(model?.sourceValue, vendor?.modelNumber),
    pickString(model?.targetValue, amazon?.modelNumber),
    outcomeToYesNo(model?.outcome),
    vendorUpcForExport(result, vendor, upc),
    pickString(upc?.targetValue, amazon?.upc),
    outcomeToYesNo(upc?.outcome),
    imageScore,
    outcomeToYesNo(image?.outcome),
    attrString(vendorAttrs, 'packLabel'),
    attrString(vendorAttrs, 'caseQuantity'),
    attrString(vendorAttrs, 'restrictionText'),
    attrString(vendorAttrs, 'packagedQuantity'),
    attrString(vendorAttrs, 'vendorPackagedQuantity'),
    pickString(attrString(vendorAttrs, 'packSize'), vendor?.packSize),
    attrString(vendorAttrs, 'packQuantity'),
    attrString(vendorAttrs, 'minOrderQty'),
    amazonSpAttribute(amazon, 'item_package_quantity'),
    amazonSpAttribute(amazon, 'number_of_items'),
    amazonSpAttribute(amazon, 'size'),
    amazonSpAttribute(amazon, 'unit_count'),
    amazonSpAttribute(amazon, 'item_form'),
    amazonSpAttribute(amazon, 'package_contains_identifier'),
    pickString(amazonSpAttribute(amazon, 'item_package_quantity'), amazon?.packSize),
    amazonSpAttribute(amazon, 'number_of_items'),
    pickString(result?.packEvidenceVendor),
    pickString(result?.packEvidenceAmazon),
    amazonSpecs,
    vendorSpecs,
    exportSpecsYesNo(vendorSpecs, amazonSpecs),
    vendorDesc,
    amazonDesc,
    exportTextOverlapYesNo(vendorDesc, amazonDesc),
    vendorPrice,
    amazonPrice,
    outcomeToYesNo(price?.outcome),
    pickString(vendor?.pageUrl, vendorAttrs?.pageUrl, vendorAttrs?.url),
    amazonAsinUrl(asin),
    result?.inputTokens ?? '',
    result?.outputTokens ?? '',
    costStr,
    pickString(result?.qcModel, result?.model),
    buildReasonForVerdict(result),
    runSourceLabel(result?.runSource),
  ]
}

/**
 * Pipeline Excel row (qcReport + vendorData + optional amazon extract).
 * @param {{ qcReport?: object, vendorData?: object, amazonData?: object, inputRow?: object }} entry
 */
export function mapGrandQcExportRowFromPipeline(entry) {
  const report = entry?.qcReport ?? {}
  const vendorData = entry?.vendorData ?? {}
  const amazonExtract = entry?.amazonData ?? {}
  const inputRow = entry?.inputRow ?? {}

  const inputUpc = pickString(inputRow?.upc, inputRow?.UPC, inputRow?.barcode)

  const synthetic = {
    verdict: report.verdict,
    titleScore: report.titleScore,
    imageScore: report.imageScore,
    titleSameProduct: report.titleSameProduct,
    titleTokenSimilarity: report.titleTokenSimilarity,
    inputTokens: report.inputTokens,
    outputTokens: report.outputTokens,
    costUsd: report.costUsd,
    qcModel: report.model,
    packEvidenceVendor: report.packEvidenceVendor,
    packEvidenceAmazon: report.packEvidenceAmazon,
    inputRowUpc: inputUpc,
    runSource: 'sandbox',
    identity: [
      { key: 'listing_id', label: 'ASIN', value: pickString(report.asin, amazonExtract.asin) },
      { key: 'sku', label: 'SKU', value: pickString(report.sku, vendorData.sku) },
      { key: 'upc', label: 'UPC', value: inputUpc },
    ],
    comparisons: Object.entries(report.conditionScores ?? {}).map(([key, pass]) => {
      const labels = {
        packSize: 'Pack Size',
        brand: 'Brand',
        model: 'Model Number',
        upc: 'UPC',
        title: 'Title',
        image: 'Image',
      }
      const outcome = pass === 'PASS' ? 'MATCH' : 'MISMATCH'
      return {
        key,
        label: labels[key] ?? key,
        sourceValue: pickString(vendorData[key], vendorData[key === 'packSize' ? 'packSize' : key]),
        targetValue: pickString(amazonExtract[key === 'model' ? 'modelNumber' : key]),
        outcome,
      }
    }),
    sourceRawExtract: {
      ...vendorData,
      sku: vendorData.sku,
      title: vendorData.productTitle ?? vendorData.title,
      brand: vendorData.brandName ?? vendorData.brand,
      modelNumber: vendorData.modelNumber ?? vendorData.modelNumberSku,
      packSize: vendorData.packSize,
      upc: vendorData.upc,
      description: vendorData.description,
      compliance: vendorData.compliance,
      pageUrl: vendorData.pageUrl,
      rawAttributes: vendorData.rawAttributes ?? {},
    },
    targetRawExtract: amazonExtract,
  }

  for (const c of synthetic.comparisons) {
    if (c.key === 'title') {
      c.sourceValue = pickString(vendorData.productTitle, vendorData.title)
      c.targetValue = pickString(amazonExtract.title)
    }
    if (c.key === 'brand') {
      c.sourceValue = pickString(vendorData.brandName, vendorData.brand)
      c.targetValue = pickString(amazonExtract.brand)
    }
    if (c.key === 'model') {
      c.sourceValue = pickString(vendorData.modelNumber, vendorData.sku)
      c.targetValue = pickString(amazonExtract.modelNumber)
    }
    if (c.key === 'packSize') {
      c.sourceValue = pickString(vendorData.packSize)
      c.targetValue = pickString(amazonExtract.packSize)
    }
    if (c.key === 'upc') {
      c.sourceValue = pickString(inputUpc, vendorData.upc)
      c.targetValue = pickString(amazonExtract.upc)
    }
    if (c.key === 'image') {
      c.sourceValue = pickString(vendorData.imageUrl, vendorData.image)
      c.targetValue = pickString(amazonExtract.imageUrl)
    }
  }

  return mapGrandQcExportRowFromQcResult(synthetic)
}
