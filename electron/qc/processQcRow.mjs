import { fetchAmazonListingByAsin } from '../amazon/fetchAmazonListingByAsin.mjs'
import { templateScrapeFailureFromRow } from '../errorEngineScrape.mjs'
import { getDecryptedValues } from '../credentialsStore.mjs'
import { getVendorScraper } from '../vendor/scrapeRegistry.mjs'
import { resolveThresholds, runQC } from '../../scripts/qcComparison.mjs'
import { mapQcReportToListingPayload } from './mapQcReportToListingPayload.mjs'

function pickAsin(row) {
  const asin = row?.asin
  if (typeof asin === 'string' && asin.trim()) return asin.trim().toUpperCase()
  return ''
}

async function loadAnthropicApiKeyFromStore() {
  const values = await getDecryptedValues(['ANTHROPIC_API_KEY'])
  const key = values.ANTHROPIC_API_KEY?.trim()
  if (!key) {
    throw new Error('Save Claude Haiku 5.5 credentials on the Credentials page before running QC.')
  }
  return key
}

function vendorExtractToVendorData(extract) {
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
    compliance: extract.rawAttributes?.compliance ?? 'COMPLIANT',
    remarks: extract.rawAttributes?.remarks ?? '',
    minOrderQty: extract.rawAttributes?.minOrderQty ?? undefined,
    pageUrl: extract.pageUrl,
    description: extract.rawAttributes?.description ?? '',
  }
}

function amazonExtractToAmazonData(extract) {
  return {
    asin: extract.asin,
    title: extract.title,
    brand: extract.brand,
    modelNumber: extract.modelNumber,
    packSize: extract.packSize,
    upc: extract.upc,
    imageUrl: extract.imageUrl,
    rawAttributes: extract.rawAttributes,
  }
}

/**
 * @param {object} payload
 * @param {(entry: { category: string, message: string, detail?: string }) => void} [appLog]
 */
export async function processQcRow(payload, appLog) {
  const emit = (category, message, detail) => {
    appLog?.({
      category,
      message: String(message),
      detail: detail != null && String(detail).trim() ? String(detail).trim() : undefined,
    })
  }

  const row = payload?.row
  if (!row || typeof row !== 'object') {
    return { ok: false, phase: 'compare', error: 'Invalid row payload.' }
  }

  const asin = pickAsin(row)
  if (!asin) {
    return { ok: false, phase: 'amazon', error: 'Row is missing a valid ASIN.' }
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

  const vendorId = typeof payload.vendorId === 'string' ? payload.vendorId : 'template'
  const scraper = getVendorScraper(vendorId)
  const vendorSku =
    String(row.part_sku ?? row.sku ?? row.upc ?? '').trim() || asin
  const vendorResult = await scraper({
    row,
    rowIndex: typeof payload.rowIndex === 'number' ? payload.rowIndex : 0,
    headless: payload.headless !== false,
    batchLabel: payload.batchLabel,
    keepBrowserAfterScrape: payload.keepBrowserAfterScrape === true,
    onLogLine: (line) => emit('SCRAPING', line, vendorSku),
  })

  if (!vendorResult.ok) {
    return {
      ok: false,
      phase: 'vendor',
      error: vendorResult.error,
      kind: vendorResult.kind,
    }
  }

  const settings = payload.settings && typeof payload.settings === 'object' ? payload.settings : {}
  const thresholds = resolveThresholds(settings)

  const sku =
    vendorResult.extract?.sku ||
    String(row.part_sku ?? row.sku ?? '').trim() ||
    asin

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

  emit('AI', 'Claude Haiku 5.5 QC comparison started', sku)
  try {
    const qcReport = await runQC(vendorData, amazonData, { ...settings, ...thresholds }, {
      apiKey,
      onDebugLog: (line) => emit('AI', line, sku),
    })
    const result = mapQcReportToListingPayload(
      vendorResult.extract,
      amazonResult.extract,
      row,
      qcReport,
      thresholds,
      {
        inputTokens: qcReport.inputTokens ?? 0,
        outputTokens: qcReport.outputTokens ?? 0,
      },
    )
    emit(
      'AI',
      `Claude Haiku 5.5 QC finished — ${result.verdict}`,
      `${result.inputTokens} in / ${result.outputTokens} out · ${qcReport.model ?? 'claude-haiku-5-5'}`,
    )
    return { ok: true, result }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Listing comparison failed.'
    emit('ERROR', 'Claude Haiku 5.5 QC comparison failed', message)
    return { ok: false, phase: 'compare', error: message }
  }
}
