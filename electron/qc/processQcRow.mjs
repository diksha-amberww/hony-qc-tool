import { fetchAmazonListingByAsin } from '../amazon/fetchAmazonListingByAsin.mjs'
import { templateScrapeFailureFromRow } from '../errorEngineScrape.mjs'
import { getVendorScraper } from '../vendor/scrapeRegistry.mjs'
import { compareListings } from './listingCompare.mjs'

const DEFAULT_THRESHOLDS = {
  titleSimilarityPercent: 70,
  imageSimilarityPercent: 70,
}

function pickAsin(row) {
  const asin = row?.asin
  if (typeof asin === 'string' && asin.trim()) return asin.trim().toUpperCase()
  return ''
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
  const vendorResult = await scraper({
    row,
    rowIndex: typeof payload.rowIndex === 'number' ? payload.rowIndex : 0,
    headless: payload.headless !== false,
    batchLabel: payload.batchLabel,
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
  const thresholds = {
    titleSimilarityPercent:
      Number(settings.titleSimilarityPercent) || DEFAULT_THRESHOLDS.titleSimilarityPercent,
    imageSimilarityPercent:
      Number(settings.imageSimilarityPercent) || DEFAULT_THRESHOLDS.imageSimilarityPercent,
  }
  const brandAliases = Array.isArray(payload.brandAliases) ? payload.brandAliases : []

  const sku =
    vendorResult.extract?.sku ||
    String(row.part_sku ?? row.sku ?? '').trim() ||
    asin

  emit('AI', 'Claude model comparison started', sku)
  try {
    const result = compareListings(
      vendorResult.extract,
      amazonResult.extract,
      row,
      thresholds,
      brandAliases,
    )
    emit(
      'AI',
      `Claude model comparison finished — ${result.verdict}`,
      `${result.inputTokens} in / ${result.outputTokens} out`,
    )
    return { ok: true, result }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Listing comparison failed.'
    emit('ERROR', 'Claude model comparison failed', message)
    return { ok: false, phase: 'compare', error: message }
  }
}
