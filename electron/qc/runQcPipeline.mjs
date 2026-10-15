import path from 'node:path'
import { app } from 'electron'
import { fetchAmazonListingByAsin } from '../amazon/fetchAmazonListingByAsin.mjs'
import { getDecryptedValues } from '../credentialsStore.mjs'
import { templateScrapeFailureFromRow } from '../errorEngineScrape.mjs'
import { getVendorScraper } from '../vendor/scrapeRegistry.mjs'
import { resolveThresholds, runQC } from '../../scripts/qcComparison.mjs'
import { formatAndExportToExcel } from '../../scripts/exportFormatter.mjs'

function pick(row, ...keys) {
  for (const key of keys) {
    const v = row?.[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

/**
 * @param {object} payload
 * @returns {Record<string, string>}
 */
function resolveInputRow(payload) {
  if (payload?.row && typeof payload.row === 'object') {
    return payload.row
  }
  const row = {}
  const asin = pick(payload, 'asin')
  const sku = pick(payload, 'part_sku', 'sku')
  const upc = pick(payload, 'upc')
  const brand = pick(payload, 'brand')
  const line = pick(payload, 'line')
  if (asin) row.asin = asin
  if (sku) row.part_sku = sku
  if (upc) row.upc = upc
  if (brand) row.brand = brand
  if (line) row.line = line
  return row
}

/**
 * Vendor scrape extract → shape expected by runQC / exportFormatter.
 * @param {import('../vendor/vendorScrapeTypes.mjs').VendorListingExtract} extract
 * @param {object} [extras]
 */
function vendorExtractToVendorData(extract, extras = {}) {
  return {
    sku: extract.sku,
    modelNumberSku: extract.modelNumber,
    modelNumber: extract.modelNumber,
    productTitle: extract.title,
    title: extract.title,
    brandName: extract.brand,
    brand: extract.brand,
    packSize: extract.packSize,
    upc: extract.upc,
    image: extract.imageUrl,
    imageUrl: extract.imageUrl,
    compliance: extras.compliance ?? extract.rawAttributes?.compliance ?? 'COMPLIANT',
    remarks: extras.remarks ?? extract.rawAttributes?.remarks ?? '',
    minOrderQty: extras.minOrderQty ?? extract.rawAttributes?.minOrderQty ?? undefined,
    pageUrl: extract.pageUrl,
    description: extract.description ?? extract.rawAttributes?.description ?? '',
    rawAttributes: extract.rawAttributes,
  }
}

/**
 * @param {import('../amazon/normalizeAmazonListing.mjs').AmazonListingExtract} extract
 */
function amazonExtractToAmazonData(extract) {
  const imageUrls = extract.rawAttributes?.imageUrls
  const fallbackImage =
    Array.isArray(imageUrls) && imageUrls.length > 0 ? String(imageUrls[0]).trim() : ''
  const imageUrl =
    extract.imageUrl && extract.imageUrl !== '—' ? extract.imageUrl : fallbackImage
  return {
    asin: extract.asin,
    title: extract.title,
    itemName: extract.title,
    brand: extract.brand,
    modelNumber: extract.modelNumber,
    packSize: extract.packSize,
    upc: extract.upc,
    imageUrl,
    image: imageUrl,
    rawAttributes: extract.rawAttributes,
  }
}

async function loadAnthropicApiKeyFromStore() {
  const values = await getDecryptedValues(['ANTHROPIC_API_KEY'])
  const key = values.ANTHROPIC_API_KEY?.trim()
  if (!key) {
    throw new Error('Save Claude Haiku 5.5 credentials on the Credentials page before running QC.')
  }
  return key
}

function buildExportPath(qcReport, customPath) {
  if (customPath && typeof customPath === 'string') {
    return path.resolve(customPath)
  }
  const dir = path.join(app.getPath('userData'), 'qc-exports')
  const safeSku = String(qcReport.sku || 'sku').replace(/[^\w.-]+/g, '_').slice(0, 40)
  const safeAsin = String(qcReport.asin || 'ASIN').replace(/[^\w.-]+/g, '_')
  const fileName = `QC_${safeAsin}_${safeSku}_${Date.now()}.xlsx`
  return path.join(dir, fileName)
}

/**
 * Full QC pipeline: Amazon SP-API → vendor scrape → runQC → Excel export.
 *
 * @param {object} payload
 * @param {(entry: { category: string, message: string, detail?: string }) => void} [appLog]
 */
export async function runQcPipelineExport(payload, appLog) {
  const emit = (category, message, detail) => {
    appLog?.({
      category,
      message: String(message),
      detail: detail != null && String(detail).trim() ? String(detail).trim() : undefined,
    })
  }

  const row = resolveInputRow(payload ?? {})
  const asin = pick(row, 'asin').toUpperCase()
  if (!asin) {
    return { ok: false, phase: 'input', error: 'ASIN is required.' }
  }

  const skuOrUpc = pick(row, 'part_sku', 'sku', 'model_number', 'modelNumber', 'model', 'upc')
  if (!skuOrUpc) {
    return { ok: false, phase: 'input', error: 'SKU or UPC is required for vendor lookup.' }
  }

  emit('SCRAPING', 'Amazon SP-API catalog fetch started', asin)
  const amazonResult = await fetchAmazonListingByAsin(asin)
  if (!amazonResult.ok) {
    emit('ERROR', 'Amazon SP-API catalog fetch failed', amazonResult.error)
    return {
      ok: false,
      phase: 'amazon',
      error: amazonResult.error,
      kind: amazonResult.kind,
    }
  }
  emit('SCRAPING', 'Amazon SP-API catalog fetch completed', asin)

  const templateErr = templateScrapeFailureFromRow(row)
  if (templateErr) {
    return {
      ok: false,
      phase: 'vendor',
      error: templateErr.message,
      kind: templateErr.kind,
    }
  }

  const vendorId = typeof payload.vendorId === 'string' ? payload.vendorId : 'honeys'
  const scraper = getVendorScraper(vendorId)

  emit('SCRAPING', `Vendor website scrape started (${vendorId})`, skuOrUpc)
  const vendorResult = await scraper({
    row,
    rowIndex: typeof payload.rowIndex === 'number' ? payload.rowIndex : 0,
    headless: payload.headless !== false,
    batchLabel: payload.batchLabel,
    onLogLine: (line) => emit('SCRAPING', line, skuOrUpc),
  })

  if (!vendorResult.ok) {
    emit('ERROR', 'Vendor scrape failed', vendorResult.error)
    if (vendorResult.scrapeLog) {
      for (const line of String(vendorResult.scrapeLog).split('\n')) {
        const trimmed = line.trim()
        if (trimmed) emit('SCRAPING', trimmed, skuOrUpc)
      }
    }
    return {
      ok: false,
      phase: 'vendor',
      error: vendorResult.error,
      kind: vendorResult.kind,
      vendorLog: vendorResult.scrapeLog,
    }
  }
  emit('SCRAPING', 'Vendor website scrape completed', vendorResult.extract?.sku ?? skuOrUpc)

  const settings = payload.settings && typeof payload.settings === 'object' ? payload.settings : {}
  const thresholds = resolveThresholds(settings)

  let apiKey
  try {
    apiKey = await loadAnthropicApiKeyFromStore()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Claude Haiku 5.5 credentials missing.'
    emit('ERROR', 'Claude Haiku 5.5 credentials', message)
    return { ok: false, phase: 'compare', error: message, kind: 'credentials' }
  }

  const vendorData = vendorExtractToVendorData(vendorResult.extract)
  const amazonData = amazonExtractToAmazonData(amazonResult.extract)

  emit('AI', 'Claude Haiku 5.5 QC started (pack / brand / model / UPC / title / image)', skuOrUpc)
  let qcReport
  try {
    qcReport = await runQC(vendorData, amazonData, { ...settings, ...thresholds }, {
      apiKey,
      onDebugLog: (line) => emit('AI', line, skuOrUpc),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'QC comparison failed.'
    emit('ERROR', 'QC comparison failed', message)
    return { ok: false, phase: 'compare', error: message }
  }
  const aiDetail = `${qcReport.inputTokens ?? 0} in / ${qcReport.outputTokens ?? 0} out · ${qcReport.model ?? 'claude-haiku-5-5'}`
  emit('AI', `Claude Haiku 5.5 QC finished — ${qcReport.verdict}`, aiDetail)
  if ((qcReport.inputTokens ?? 0) === 0 && (qcReport.outputTokens ?? 0) === 0) {
    emit(
      'ERROR',
      'QC AI used 0 tokens — title/image calls likely failed',
      'Check sandbox log for DEBUG AI INPUT and [QC title AI] / [QC image AI] in devtools',
    )
  }

  const outputFilePath = buildExportPath(qcReport, payload.outputFilePath)
  try {
    emit('QC', 'Writing Excel QC report', path.basename(outputFilePath))
    await formatAndExportToExcel(qcReport, vendorData, outputFilePath, amazonData)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Excel export failed.'
    emit('ERROR', 'Excel export failed', message)
    return { ok: false, phase: 'export', error: message }
  }

  return {
    ok: true,
    qcReport,
    vendorData,
    amazonData,
    vendorExtract: vendorResult.extract,
    asinExtract: amazonResult.extract,
    excelFilePath: outputFilePath,
  }
}
