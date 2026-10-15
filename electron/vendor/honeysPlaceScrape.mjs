import {
  ensureHoneysPortalSession,
  getActiveCookieJar,
  getHoneysPortalSessionFilePath,
  loadPortalCredentials,
  loadSessionJarFromDisk,
  refreshHoneysJarFromBrowser,
} from './honeysPlaceSession.mjs'
import {
  isHoneysAuthOrBlockPage,
  isHoneysProductDetailPage,
  parseHoneysProductHtml,
  diagnoseEmptyStructuredSearchCards,
  extractHoneysSearchResultCards,
  honeysDetailPageMatchesIdentifier,
  htmlContainsHoneysProductLinks,
  isHoneysGenericLivewireShell,
  resolveHoneysSearchProductDetailUrl,
} from './honeysPlaceParse.mjs'
import {
  getSharedHoneysPortalBrowserWindow,
  loadHoneysPortalPageHtml,
  releaseHoneysPortalBrowserWindow,
} from './honeysPortalBrowser.mjs'
import { HoneysPortalSessionExpiredError } from './honeysPortalSessionSignals.mjs'

function pick(row, ...keys) {
  for (const key of keys) {
    const v = row[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

const NO_MATCHING_PRODUCT = 'No product found with matching SKU/UPC in search results'

/** Row SKU/UPC used for search-result verification (same as manual pick). */
function searchMatchCriteriaFromRow(row) {
  return {
    sku: pick(row, 'part_sku', 'sku', 'model_number', 'modelNumber', 'model'),
    upc: pick(row, 'upc'),
  }
}

/** Values that must appear on the loaded product detail page. */
function detailMatchTargetsFromRow(row) {
  const criteria = searchMatchCriteriaFromRow(row)
  const targets = []
  const seen = new Set()
  for (const value of [criteria.sku, criteria.upc]) {
    if (!value) continue
    const id = value.toLowerCase()
    if (seen.has(id)) continue
    seen.add(id)
    targets.push(value)
  }
  return targets
}

function classifyBrowserNavigationError(err) {
  const msg = err instanceof Error ? err.message : 'Vendor browser navigation failed.'
  if (/timeout/i.test(msg)) {
    return { kind: 'timeout', error: msg }
  }
  return { kind: 'network', error: msg }
}

function classifyRenderedHtmlFailure(html, context) {
  if (isHoneysAuthOrBlockPage(html)) {
    return {
      ok: false,
      kind: 'authentication',
      error: `Vendor session expired or blocked during ${context}.`,
    }
  }
  return null
}

function scrapeLog(ctx, message) {
  if (typeof ctx.onLogLine === 'function') {
    ctx.onLogLine(message)
  }
}

/**
 * @param {import('./vendorScrapeTypes.mjs').VendorScrapeContext} ctx
 */
export async function honeysPlaceScrapeListing(ctx) {
  const row = ctx.row ?? {}
  const searchCriteria = searchMatchCriteriaFromRow(row)
  const matchTargets = detailMatchTargetsFromRow(row)
  const skuQuery = searchCriteria.sku || searchCriteria.upc || ''
  const headless = ctx.headless !== false
  const scrapeLogLines = []
  const log = (message) => {
    scrapeLogLines.push(message)
    scrapeLog(ctx, message)
  }
  const fail = (payload) => ({
    ...payload,
    scrapeLog: scrapeLogLines.join('\n'),
  })

  if (!skuQuery) {
    return fail({ ok: false, kind: 'parse', error: 'Row is missing SKU/UPC for vendor search.' })
  }

  log(`Honey's Place scrape started for SKU/UPC query: ${skuQuery}`)
  log(`Session cookie file: ${getHoneysPortalSessionFilePath()}`)
  log('Using Electron browser (Livewire) — not Node fetch — for search and product pages.')

  try {
    const session = await ensureHoneysPortalSession({
      reuseSession: true,
      freshSession: false,
      headless,
      keepBrowserForScraping: true,
      onLogLine: log,
    })
    if (!session.ok) {
      return fail({
        ok: false,
        kind: 'authentication',
        error: session.error ?? 'Vendor login required.',
      })
    }

    const creds = await loadPortalCredentials()
    const portalUrl = creds.portalUrl.replace(/\/+$/, '')
    const sessionJar = getActiveCookieJar() ?? (await loadSessionJarFromDisk())
    if (!sessionJar || sessionJar.countStored() === 0) {
      return fail({
        ok: false,
        kind: 'authentication',
        error: 'Honey\'s Place session cookies are missing after login.',
      })
    }

    const encoded = encodeURIComponent(skuQuery)
    const searchUrl = `${portalUrl}/advance-search/${encoded}?items%5Bquery%5D=${encoded}`

    let searchHtml = ''
    let searchResponseUrl = searchUrl

    try {
      const searchPage = await loadHoneysPortalPageHtml(searchUrl, {
        headless,
        log,
        jar: sessionJar,
        portalOrigin: portalUrl,
        waitForProductLinks: true,
        productLinkTimeoutMs: 15_000,
      })
      searchHtml = searchPage.html
      searchResponseUrl = searchPage.finalUrl || searchUrl
    } catch (err) {
      if (err instanceof HoneysPortalSessionExpiredError) {
        return fail({ ok: false, kind: 'authentication', error: err.message })
      }
      const classified = classifyBrowserNavigationError(err)
      return fail({ ok: false, ...classified })
    }

    const searchAuthErr = classifyRenderedHtmlFailure(searchHtml, 'search')
    if (searchAuthErr) return fail(searchAuthErr)

    log(`Vendor search: ${searchUrl}`)
    log(`Search response URL: ${searchResponseUrl}`)
    if (searchResponseUrl !== searchUrl) {
      log(`Search was redirected from ${searchUrl} to ${searchResponseUrl}`)
    }
    if (isHoneysGenericLivewireShell(searchHtml)) {
      log(
        'WARNING: Received generic Livewire shell. Session cookies are likely missing or invalid.',
      )
    }

    const searchCards = extractHoneysSearchResultCards(searchHtml)
    log(`Parsed ${searchCards.length} product cards in search HTML`)
    if (searchCards.length > 0) {
      log(`Search results page loaded with ${searchCards.length} products`)
    }

    if (searchCards.length === 0) {
      const titleMatch = searchHtml.match(/<title[^>]*>([^<]*)<\/title>/i)
      const pageTitle = titleMatch?.[1] ? titleMatch[1].replace(/\s+/g, ' ').trim() : '(no title)'
      log(`Search HTML page title: ${pageTitle}`)

      const diag = diagnoseEmptyStructuredSearchCards(searchHtml)
      if (diag.noResultsMessage) {
        log(`Search page indicates no results (matched text: "${diag.noResultsMessage}")`)
      }
      const snippet = diag.bodySnippet || '(empty body)'
      if (!htmlContainsHoneysProductLinks(searchHtml)) {
        log(`Search HTML has no /product/ links; body snippet (first 500 chars): ${snippet}`)
      } else {
        log(`Search HTML body snippet (first 1000 chars): ${snippet}`)
      }
    }

    let productHtml = ''
    let productPageUrl = ''

    const redirectedToProduct =
      /\/product\/\d+/i.test(searchResponseUrl) && !/\/advance-search/i.test(searchResponseUrl)
    const detailMatchesTarget =
      redirectedToProduct &&
      isHoneysProductDetailPage(searchHtml, searchResponseUrl) &&
      honeysDetailPageMatchesIdentifier(searchHtml, matchTargets)

    if (detailMatchesTarget) {
      log('Loaded product detail page directly from search navigation.')
      productHtml = searchHtml
      productPageUrl = searchResponseUrl
    } else {
      const resolved = resolveHoneysSearchProductDetailUrl(searchHtml, portalUrl, searchCriteria)
      if (!resolved.ok) {
        log(NO_MATCHING_PRODUCT)
        return fail({ ok: false, kind: 'parse', error: NO_MATCHING_PRODUCT })
      }

      const productDetailUrl = resolved.productDetailUrl || resolved.url
      log(
        `Found matching product (${resolved.matchType}) "${resolved.matchedIdentifier || resolved.matchedSku}" at #${resolved.productIndex}, clicking…`,
      )
      log(`Product detail URL: ${productDetailUrl}`)

      try {
        const productPage = await loadHoneysPortalPageHtml(productDetailUrl, {
          headless,
          log,
          jar: sessionJar,
          portalOrigin: portalUrl,
          waitForProductLinks: false,
        })
        productHtml = productPage.html
        productPageUrl = productPage.finalUrl || productDetailUrl
      } catch (err) {
        if (err instanceof HoneysPortalSessionExpiredError) {
          return fail({ ok: false, kind: 'authentication', error: err.message })
        }
        const classified = classifyBrowserNavigationError(err)
        return fail({ ok: false, ...classified })
      }

      const productAuthErr = classifyRenderedHtmlFailure(productHtml, 'product page')
      if (productAuthErr) return fail(productAuthErr)

      if (!isHoneysProductDetailPage(productHtml, productPageUrl)) {
        return fail({
          ok: false,
          kind: 'parse',
          error: `Product detail page did not load for ${skuQuery}.`,
        })
      }

      if (!honeysDetailPageMatchesIdentifier(productHtml, matchTargets)) {
        const mismatch = `Product detail page did not contain matching SKU/UPC for ${skuQuery}.`
        log(mismatch)
        return fail({ ok: false, kind: 'parse', error: mismatch })
      }

      log(`Navigated to product detail page (${productPageUrl})`)
    }

    const sharedWin = getSharedHoneysPortalBrowserWindow()
    if (sharedWin && !sharedWin.isDestroyed()) {
      try {
        await refreshHoneysJarFromBrowser(sharedWin.webContents, portalUrl)
        log('Synced portal browser cookies back to saved session file.')
      } catch {
        // non-fatal
      }
    }

    const parsed = parseHoneysProductHtml(productHtml, productPageUrl)
    if (!parsed) {
      return fail({
        ok: false,
        kind: 'parse',
        error: `Could not parse product page for ${skuQuery}.`,
      })
    }

    const line = pick(row, 'line') || ''
    const upc = parsed.upc || pick(row, 'upc') || ''
    const brand = parsed.brand || pick(row, 'brand') || 'Unknown'
    const sku = parsed.sku || skuQuery
    const modelNumber = parsed.modelNumber || parsed.manufacturerPartNumber || skuQuery
    const packSize = parsed.packSize || '1'
    const packSizeUnit = parsed.packSizeUnit || 'each'
    const packSizeValue =
      Number.isFinite(parsed.packSizeValue) && parsed.packSizeValue >= 1
        ? parsed.packSizeValue
        : Number.parseInt(packSize, 10) || 1
    const description = parsed.description || ''
    const productAttributes = parsed.productAttributes && typeof parsed.productAttributes === 'object'
      ? parsed.productAttributes
      : {}

    /** @type {Record<string, string | number | boolean | null>} */
    const attributeFlat = {}
    for (const [key, value] of Object.entries(productAttributes)) {
      const attrKey = `attr_${String(key).replace(/\s+/g, '_')}`
      attributeFlat[attrKey] = String(value)
    }

    return {
      ok: true,
      extract: {
        source: 'vendor_website',
        sku,
        title: parsed.title,
        brand,
        line,
        modelNumber,
        packSize,
        packSizeValue,
        packSizeUnit,
        upc,
        description,
        imageUrl: parsed.imageUrl || '',
        pageUrl: productPageUrl,
        rawAttributes: {
          catalogStatus: 'Published',
          scrapeConfidence: parsed.title && parsed.imageUrl ? 0.94 : 0.8,
          vendor: 'honeysplace',
          searchUrl,
          scrapeLog: scrapeLogLines.join(' · '),
          lastCrawledAt: new Date().toISOString(),
          priceUsd: parsed.priceUsd,
          msrpUsd: parsed.msrpUsd,
          mapPriceUsd: parsed.mapPriceUsd ?? null,
          manufacturerPartNumber: parsed.manufacturerPartNumber,
          originalModelNumber: parsed.originalModelNumber,
          packSize: packSize,
          packSizeValue,
          packSizeUnit,
          packSizeSource: parsed.packSizeSource,
          packSizeEvidence: parsed.packSizeEvidence,
          moqVerified: parsed.moqVerified ?? null,
          minOrderQty: parsed.minOrderQty ?? null,
          caseCount: parsed.caseCount ?? null,
          stock: parsed.stock ?? null,
          description,
          sku,
          upc,
          brand,
          modelNumber,
          title: parsed.title,
          productAttributesJson:
            Object.keys(productAttributes).length > 0 ? JSON.stringify(productAttributes) : null,
          ...attributeFlat,
        },
      },
    }
  } finally {
    if (ctx.keepBrowserAfterScrape === true) {
      log('Keeping Honey\'s Place browser open for the next QC row.')
    } else {
      releaseHoneysPortalBrowserWindow({ headless, log })
    }
  }
}
