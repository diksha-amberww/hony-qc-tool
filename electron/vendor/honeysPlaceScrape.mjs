import {
  ensureHoneysPortalSession,
  honeysAuthenticatedFetch,
  loadPortalCredentials,
} from './honeysPlaceSession.mjs'
import {
  isHoneysAuthOrBlockPage,
  isHoneysProductPageHtml,
  parseHoneysProductHtml,
} from './honeysPlaceParse.mjs'
import { withHoneysRequestCooldown } from './honeysRequestGate.mjs'

const CATALOG_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'

function pick(row, ...keys) {
  for (const key of keys) {
    const v = row[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

function catalogHeaders(referer) {
  const headers = {
    accept: CATALOG_ACCEPT,
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'max-age=0',
    'upgrade-insecure-requests': '1',
  }
  if (referer) headers.referer = referer
  return headers
}

function classifyFetchError(err) {
  const msg = err instanceof Error ? err.message : 'Vendor request failed.'
  if (err instanceof Error && err.name === 'AbortError') {
    return { kind: 'timeout', error: msg }
  }
  return { kind: 'network', error: msg }
}

/**
 * @param {Response} res
 * @param {string} html
 */
function classifyHttpFailure(res, html, context) {
  if (res.status === 401 || res.status === 403 || isHoneysAuthOrBlockPage(html)) {
    return {
      ok: false,
      kind: 'authentication',
      error: `Vendor session expired or blocked during ${context}.`,
    }
  }
  if (!res.ok) {
    return {
      ok: false,
      kind: 'network',
      error: `${context} HTTP ${res.status}`,
    }
  }
  return null
}

/**
 * @param {string} html
 * @param {string} portalUrl
 * @param {string} query
 */
function findProductUrl(html, portalUrl, query) {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return null

  const escaped = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const slugRe = new RegExp(`href="(/product/\\d+/[^"]*${escaped}[^"]*)"`, 'i')
  const slugMatch = html.match(slugRe)
  if (slugMatch?.[1]) return `${portalUrl}${slugMatch[1]}`

  const linkRe = /href="(\/product\/\d+\/[^"]+)"/gi
  let m
  const needle = normalizedQuery.toLowerCase()
  while ((m = linkRe.exec(html))) {
    if (m[1].toLowerCase().includes(needle)) {
      return `${portalUrl}${m[1]}`
    }
  }
  return null
}

/**
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number }} options
 */
async function gatedHoneysFetch(url, options) {
  return withHoneysRequestCooldown(() => honeysAuthenticatedFetch(url, options))
}

/**
 * @param {import('./vendorScrapeTypes.mjs').VendorScrapeContext} ctx
 */
export async function honeysPlaceScrapeListing(ctx) {
  const row = ctx.row ?? {}
  const skuQuery = pick(row, 'part_sku', 'sku', 'upc')
  if (!skuQuery) {
    return { ok: false, kind: 'parse', error: 'Row is missing SKU/UPC for vendor search.' }
  }

  const session = await ensureHoneysPortalSession({ reuseSession: true })
  if (!session.ok) {
    return {
      ok: false,
      kind: 'authentication',
      error: session.error ?? 'Vendor login required.',
    }
  }

  const creds = await loadPortalCredentials()
  const portalUrl = creds.portalUrl.replace(/\/+$/, '')
  const encoded = encodeURIComponent(skuQuery)
  const searchUrl = `${portalUrl}/advance-search/${encoded}?items%5Bquery%5D=${encoded}`

  let searchRes
  let searchHtml
  try {
    searchRes = await gatedHoneysFetch(searchUrl, {
      method: 'GET',
      headers: catalogHeaders(`${portalUrl}/home`),
    })
    searchHtml = await searchRes.text()
  } catch (err) {
    const classified = classifyFetchError(err)
    return { ok: false, ...classified }
  }

  const searchHttpErr = classifyHttpFailure(searchRes, searchHtml, 'search')
  if (searchHttpErr) return searchHttpErr

  let productUrl = null
  let productHtml = ''
  let productPageUrl = ''

  if (isHoneysProductPageHtml(searchHtml) || searchRes.url.includes('/product/')) {
    productHtml = searchHtml
    productPageUrl = searchRes.url
  } else {
    productUrl = findProductUrl(searchHtml, portalUrl, skuQuery)
    if (!productUrl) {
      return { ok: false, kind: 'parse', error: `No product found for ${skuQuery}.` }
    }

    let productRes
    try {
      productRes = await gatedHoneysFetch(productUrl, {
        method: 'GET',
        headers: catalogHeaders(searchUrl),
      })
      productHtml = await productRes.text()
      productPageUrl = productRes.url
    } catch (err) {
      const classified = classifyFetchError(err)
      return { ok: false, ...classified }
    }

    const productHttpErr = classifyHttpFailure(productRes, productHtml, 'product page')
    if (productHttpErr) return productHttpErr
  }

  const parsed = parseHoneysProductHtml(productHtml, productPageUrl)
  if (!parsed) {
    return {
      ok: false,
      kind: 'parse',
      error: `Could not parse product page for ${skuQuery}.`,
    }
  }

  const line = pick(row, 'line') || ''
  const upc = parsed.upc || pick(row, 'upc') || ''
  const brand = parsed.brand || pick(row, 'brand') || 'Unknown'

  return {
    ok: true,
    extract: {
      source: 'vendor_website',
      sku: parsed.sku || skuQuery,
      title: parsed.title,
      brand,
      line,
      modelNumber: parsed.modelNumber || parsed.manufacturerPartNumber || skuQuery,
      packSize: parsed.packSize,
      upc,
      imageUrl: parsed.imageUrl || '',
      pageUrl: productPageUrl,
      rawAttributes: {
        catalogStatus: 'Published',
        scrapeConfidence: parsed.title && parsed.imageUrl ? 0.94 : 0.8,
        vendor: 'honeysplace',
        searchUrl,
        lastCrawledAt: new Date().toISOString(),
        priceUsd: parsed.priceUsd,
        msrpUsd: parsed.msrpUsd,
        manufacturerPartNumber: parsed.manufacturerPartNumber,
        originalModelNumber: parsed.originalModelNumber,
        packSizeSource: parsed.packSizeSource,
      },
    },
  }
}
