import * as cheerio from 'cheerio'
import { extractVendorPackSize } from './extractVendorPackSize.mjs'

const CLOUDFRONT_IMG = 'https://d2q2s39fxn78ox.cloudfront.net'

function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim()
}

function stripTags(html) {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' '))
}

/**
 * @param {unknown} node
 * @returns {unknown}
 */
function unwrapLivewire(node) {
  if (node === null || node === undefined) return node
  if (Array.isArray(node)) {
    if (node.length === 2 && node[1] && typeof node[1] === 'object' && node[1].s) {
      return unwrapLivewire(node[0])
    }
    return node.map(unwrapLivewire)
  }
  if (typeof node === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(node)) {
      out[k] = unwrapLivewire(v)
    }
    return out
  }
  return node
}

/**
 * @param {string} html
 * @returns {Record<string, unknown> | null}
 */
function parseFrontProductSnapshot(html) {
  const re = /wire:snapshot="([^"]+)"/g
  let m
  while ((m = re.exec(html))) {
    const raw = m[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#039;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }
    if (parsed?.memo?.name !== 'front.product') continue
    const data = unwrapLivewire(parsed.data)
    return data && typeof data === 'object' ? data : null
  }
  return null
}

/**
 * @param {string} html
 * @returns {Record<string, string>}
 */
function parseDetailsRows(html) {
  const fields = {}
  const marker = html.indexOf('class="details-container"')
  if (marker < 0) return fields
  const sliceStart = html.lastIndexOf('<div', marker)
  const slice = html.slice(sliceStart, sliceStart + 14_000)

  const labelRe =
    /<div class="[^"]*\blabel\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div class="[^"]*\bvalue\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
  let pair
  while ((pair = labelRe.exec(slice))) {
    const label = stripTags(pair[1]).replace(/:\s*$/, '').trim()
    const value = stripTags(pair[2]).trim()
    if (!label || !value) continue
    const key = label.toLowerCase()
    fields[key] = value
    if (key.includes('manufacturer')) fields.manufacturer = value
    else if (key === 'sku') fields.sku = value
    else if (key === 'upc') fields.upc = value
    else if (key.includes('your price')) fields.yourPrice = value
    else if (key === 'wholesale') fields.wholesale = value
    else if (key.includes('case count') || key.includes('case pack')) fields.caseCount = value
    else if (key === 'stock') fields.stock = value
    else if (key === 'msrp') fields.msrp = value
    else if (key.includes('map price')) fields.mapPrice = value
  }
  return fields
}

/**
 * Product Attributes accordion (color, feature, country, weight, UPC, …).
 * @param {string} html
 * @returns {Record<string, string>}
 */
function parseProductAttributeRows(html) {
  /** @type {Record<string, string>} */
  const attrs = {}
  const marker = html.indexOf('Product Attributes')
  if (marker < 0) return attrs
  const slice = html.slice(marker, marker + 12_000)
  const rowRe =
    /<div class="attribute-row">[\s\S]*?<span>([\s\S]*?)<\/span>[\s\S]*?<div class="right">([\s\S]*?)<\/div>/gi
  let row
  while ((row = rowRe.exec(slice))) {
    const label = stripTags(row[1]).replace(/:\s*$/, '').trim()
    const value = stripTags(row[2]).trim()
    if (!label || !value) continue
    attrs[label] = value
  }
  return attrs
}

/**
 * Livewire `item_attributes` on front.product snapshot.
 * @param {Record<string, unknown> | null} snapshot
 * @returns {Record<string, string>}
 */
function attributesFromSnapshot(snapshot) {
  /** @type {Record<string, string>} */
  const out = {}
  const raw = snapshot?.item_attributes
  if (!raw || typeof raw !== 'object') return out
  const entries = Array.isArray(raw) ? raw : [raw]
  for (const node of entries) {
    if (!node || typeof node !== 'object') continue
    for (const [key, value] of Object.entries(node)) {
      if (key === 's') continue
      const text = Array.isArray(value)
        ? value
            .flat(4)
            .filter((v) => typeof v === 'string')
            .join(', ')
        : typeof value === 'string'
          ? value
          : ''
      const cleaned = String(text).trim()
      if (key && cleaned) out[key] = cleaned
    }
  }
  return out
}

const MIN_QTY_TEXT_RE =
  /\bmin(?:imum)?\s*(?:order\s*)?(?:qty|quantity)\s*[:\s]+\s*(\d+)\b/i

/**
 * Minimum order qty from add-to-cart qty stepper (Livewire product page HTML).
 * @param {string} html
 * @returns {number | null}
 */
export function extractMinOrderQtyFromProductHtml(html) {
  if (!html || typeof html !== 'string') return null

  const buyIdx = html.indexOf('buy-controls-wrapper')
  const slice = buyIdx >= 0 ? html.slice(buyIdx, buyIdx + 8_000) : html

  const scopeText = stripTags(slice)
  const textMatch = scopeText.match(MIN_QTY_TEXT_RE)
  if (textMatch?.[1]) {
    const n = Number.parseInt(textMatch[1], 10)
    if (Number.isFinite(n) && n > 0) return n
  }

  const inputTagRe = /<input[^>]*class="[^"]*qty-input[^"]*"[^>]*>/gi
  let tagMatch
  while ((tagMatch = inputTagRe.exec(slice))) {
    const tag = tagMatch[0]
    const minAttr = tag.match(/\bmin=["']?(\d+)/i)
    if (minAttr?.[1]) {
      const n = Number.parseInt(minAttr[1], 10)
      if (Number.isFinite(n) && n > 0) return n
    }
    const valueAttr = tag.match(/\bvalue=["']?(\d+)/i)
    if (valueAttr?.[1]) {
      const n = Number.parseInt(valueAttr[1], 10)
      if (Number.isFinite(n) && n > 1) return n
    }
  }

  const specialInputRe = /<input[^>]*id="special-qty-input-[^"]*"[^>]*>/gi
  while ((tagMatch = specialInputRe.exec(slice))) {
    const tag = tagMatch[0]
    const minAttr = tag.match(/\bmin=["']?(\d+)/i)
    if (minAttr?.[1]) {
      const n = Number.parseInt(minAttr[1], 10)
      if (Number.isFinite(n) && n > 0) return n
    }
  }

  const detailsIdx = html.indexOf('details-container')
  if (detailsIdx >= 0) {
    const detailsSlice = stripTags(html.slice(detailsIdx, detailsIdx + 14_000))
    const detailsMatch = detailsSlice.match(MIN_QTY_TEXT_RE)
    if (detailsMatch?.[1]) {
      const n = Number.parseInt(detailsMatch[1], 10)
      if (Number.isFinite(n) && n > 0) return n
    }
  }

  return null
}

/**
 * @param {string} html
 */
function extractProductTitle(html) {
  const m = html.match(/<h1[^>]*class="[^"]*product-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)
  if (!m?.[1]) return ''
  return stripTags(m[1])
}

/**
 * @param {string} html
 * @param {Record<string, unknown> | null} snapshot
 */
function extractMainImageUrl(html, snapshot) {
  const carouselImg =
    html.match(/<img[^>]*class="[^"]*product-carousel-image[^"]*"[^>]*src="([^"]+)"/i) ||
    html.match(/<img[^>]*src="([^"]+)"[^>]*class="[^"]*product-carousel-image[^"]*"/i)
  if (carouselImg?.[1]) return decodeHtmlEntities(carouselImg[1])

  const ogBlock = pickOgBlock(snapshot)
  if (ogBlock?.['og:image']) {
    return String(ogBlock['og:image'])
  }

  const slides = snapshot?.main_images
  if (Array.isArray(slides) && slides[0]) {
    const firstKey = Object.keys(slides[0]).find((k) => k !== 's')
    const entries = firstKey ? slides[0][firstKey] : null
    if (Array.isArray(entries) && entries[0]?.filename) {
      const itemId = snapshot?.item_id ?? ''
      return `${CLOUDFRONT_IMG}/i/${itemId}/${entries[0].filename}`
    }
  }

  const ogMeta = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
  return ogMeta?.[1] ? decodeHtmlEntities(ogMeta[1]) : ''
}

/**
 * @param {string} html
 */
function extractDescriptionText(html) {
  const m = html.match(
    /<div class="section-header">\s*<i class="bi bi-card-text"><\/i>\s*Description\s*<\/div>\s*<div class="section-body">([\s\S]*?)<\/div>/i,
  )
  if (!m?.[1]) return ''
  const withBreaks = m[1].replace(/<br\s*\/?>/gi, '\n')
  return stripTags(withBreaks).replace(/\n\s+/g, '\n').trim()
}

/**
 * @param {string} title
 * @param {string} description
 * @returns {{ packSize: string, packSizeSource: string }}
 */
function extractPackSize(title, description, minOrderQty, attributeTexts = []) {
  const result = extractVendorPackSize({ title, description, minOrderQty, attributeTexts })
  return {
    packSize: result.packSize,
    packSizeUnit: result.packSizeUnit || 'each',
    packSizeSource: result.packSizeSource,
    packSizeEvidence: result.evidence,
    moqVerified: result.moqVerified,
  }
}

function parsePriceUsd(value) {
  if (!value) return 0
  const n = Number.parseFloat(String(value).replace(/[^0-9.-]+/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * @param {Record<string, unknown> | null} snapshot
 * @returns {Record<string, unknown> | null}
 */
function pickOgBlock(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null
  const direct = snapshot.og_data
  if (direct && typeof direct === 'object') {
    if (Array.isArray(direct) && direct[0] && typeof direct[0] === 'object') {
      return direct[0]
    }
    if (!Array.isArray(direct)) return direct
  }
  const layout = snapshot.layoutData
  if (Array.isArray(layout) && layout[0] && typeof layout[0] === 'object') {
    const og = layout[0].og_data
    if (og && typeof og === 'object') {
      if (Array.isArray(og) && og[0] && typeof og[0] === 'object') return og[0]
      if (!Array.isArray(og)) return og
    }
  }
  return null
}

function brandFromTitlePrefix(title) {
  const dash = title.indexOf(' - ')
  if (dash <= 0) return ''
  return title.slice(0, dash).trim()
}

/**
 * @param {string} html
 * @param {string} [pageUrl]
 * @returns {null | {
 *   title: string
 *   brand: string
 *   manufacturerPartNumber: string
 *   originalModelNumber: string
 *   modelNumber: string
 *   packSize: string
 *   packSizeValue: number
 *   packSizeUnit: string
 *   packSizeSource: string
 *   upc: string
 *   sku: string
 *   imageUrl: string
 *   description: string
 *   productAttributes: Record<string, string>
 *   pageUrl: string
 *   priceUsd: number
 *   msrpUsd: number
 * }}
 */
export function parseHoneysProductHtml(html, pageUrl = '') {
  if (!html || typeof html !== 'string') return null

  const snapshot = parseFrontProductSnapshot(html)
  const details = parseDetailsRows(html)
  const productAttributes = {
    ...attributesFromSnapshot(snapshot),
    ...parseProductAttributeRows(html),
  }
  let title = extractProductTitle(html)

  if (!title && snapshot?.layoutData) {
    const layout = snapshot.layoutData
    if (Array.isArray(layout) && layout[0]?.title) {
      title = String(layout[0].title).replace(/\s+MD-[A-Z0-9-]+\s*$/i, '').trim()
    }
  }

  const ogBlockForTitle = pickOgBlock(snapshot)
  const ogTitle = ogBlockForTitle?.['og:title'] ? String(ogBlockForTitle['og:title']) : ''

  if (!title && ogTitle) title = ogTitle

  const sku = details.sku || ''
  if (!isHoneysProductDetailPage(html, pageUrl) && isHoneysAdvanceSearchPage(html, pageUrl)) {
    return null
  }
  if (!title && !sku) return null

  const manufacturer = details.manufacturer || ''
  const brand = manufacturer || (title ? brandFromTitlePrefix(title) : '') || ''

  const manufacturerPartNumber = sku
  const originalModelNumber = sku
  const modelNumber = manufacturerPartNumber

  const description = extractDescriptionText(html)
  const minOrderQty = extractMinOrderQtyFromProductHtml(html)
  const attributeTexts = Object.entries(productAttributes).map(([k, v]) => `${k}: ${v}`)
  const { packSize, packSizeUnit, packSizeSource, packSizeEvidence, moqVerified } = extractPackSize(
    title,
    description,
    minOrderQty,
    attributeTexts,
  )

  const imageUrl = extractMainImageUrl(html, snapshot)
  const upcFromAttrs = productAttributes.UPC || productAttributes.Upc || productAttributes.upc || ''
  const upc = details.upc || upcFromAttrs || ''

  const priceUsd = parsePriceUsd(details.yourPrice) || parsePriceUsd(details.wholesale)

  let msrpUsd = parsePriceUsd(details.msrp)
  const ogBlock = pickOgBlock(snapshot)
  if (!msrpUsd && ogBlock?.['og:price:amount'] != null) {
    msrpUsd = parsePriceUsd(ogBlock['og:price:amount'])
  }

  const packSizeValue = Number.parseInt(String(packSize), 10)
  const packSizeNumeric = Number.isFinite(packSizeValue) && packSizeValue >= 1 ? packSizeValue : 1

  return {
    title,
    brand,
    manufacturerPartNumber,
    originalModelNumber,
    modelNumber,
    packSize: String(packSizeNumeric),
    packSizeValue: packSizeNumeric,
    packSizeUnit,
    packSizeSource,
    packSizeEvidence,
    moqVerified,
    minOrderQty: minOrderQty ?? undefined,
    caseCount: details.caseCount || undefined,
    stock: details.stock || undefined,
    mapPriceUsd: parsePriceUsd(details.mapPrice) || undefined,
    upc,
    sku,
    imageUrl,
    description,
    productAttributes,
    pageUrl: pageUrl || '',
    priceUsd,
    msrpUsd,
  }
}

/**
 * @param {string} html
 * @param {string} [pageUrl]
 */
export function isHoneysProductDetailPage(html, pageUrl = '') {
  if (pageUrl && /\/advance-search/i.test(pageUrl)) return false
  if (pageUrl && /\/product\/\d+/i.test(pageUrl)) return true
  if (parseFrontProductSnapshot(html)) return true
  return (
    html.includes('details-container') && /<h1[^>]*\bproduct-title\b/i.test(html)
  )
}

/**
 * @param {string} html
 * @param {string} [pageUrl]
 */
export function isHoneysAdvanceSearchPage(html, pageUrl = '') {
  if (pageUrl && pageUrl.includes('/advance-search')) return true
  if (isHoneysProductDetailPage(html, pageUrl)) return false
  if (/breadcrumb-item active[^>]*>[\s\S]*?Advanced\s+Search/i.test(html)) return true
  return false
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whole-token match. "GO-2" does not match "GO-20", and a UPC does not match a longer digit run.
 * @param {string} text
 * @param {string} identifier
 */
export function cardTextHasExactIdentifier(text, identifier) {
  const query = String(identifier ?? '').trim()
  if (!query) return false
  const haystack = String(text ?? '').replace(/\s+/g, ' ')
  const re = new RegExp(`(?<![A-Za-z0-9._-])${escapeRegExp(query)}(?![A-Za-z0-9._-])`, 'i')
  return re.test(haystack)
}

/**
 * @param {string | string[]} targets
 * @returns {string[]}
 */
function uniqueMatchTargets(targets) {
  const out = []
  const seen = new Set()
  const list = Array.isArray(targets) ? targets : [targets]
  for (const raw of list) {
    const value = String(raw ?? '').trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

/**
 * Detail-page SKU/UPC fields (not related-product cards) contain the target identifier.
 * @param {string} html
 * @param {string | string[]} skuQuery
 */
export function honeysDetailPageMatchesIdentifier(html, skuQuery) {
  const targets = uniqueMatchTargets(skuQuery)
  if (!html || targets.length === 0) return false
  const details = parseDetailsRows(html)
  const title = extractProductTitle(html)
  const fields = [details.sku, details.upc].map((value) => String(value ?? '').trim()).filter(Boolean)
  return targets.some((target) => {
    if (fields.some((field) => field.toLowerCase() === target.toLowerCase())) return true
    return Boolean(title) && cardTextHasExactIdentifier(title, target)
  })
}

/**
 * @param {string} href
 */
function hrefContainsProductPath(href) {
  return /\/product\//i.test(String(href ?? ''))
}

/**
 * @param {string} href
 */
function productIdFromHref(href) {
  const match = String(href ?? '').match(/\/product\/(\d+)/i)
  return match?.[1] ?? ''
}

/**
 * @param {string} href
 */
function normalizeProductHref(href) {
  if (!href || !hrefContainsProductPath(href)) return ''
  let path = String(href).trim()
  if (!path) return ''
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname
  } catch {
    return ''
  }
  path = path.split('?')[0].split('#')[0]
  const match = path.match(/\/product\/\d+(?:\/[^/?#]+)?/i)
  return match?.[0] ?? ''
}

/**
 * @param {string} href
 */
function productLinkKey(href) {
  const id = productIdFromHref(href)
  if (id) return `id:${id}`
  const normalized = normalizeProductHref(href)
  return normalized ? `path:${normalized.toLowerCase()}` : ''
}

/**
 * @param {string} html
 */
export function htmlContainsHoneysProductLinks(html) {
  if (!html || typeof html !== 'string') return false
  return /href\s*=\s*["'][^"']*\/product\//i.test(html)
}

/**
 * Unauthenticated or wrong-route HTML: Livewire app shell without product result links.
 * @param {string} html
 */
export function isHoneysGenericLivewireShell(html) {
  if (!html || typeof html !== 'string') return false
  return html.includes('wire:snapshot') && !htmlContainsHoneysProductLinks(html)
}

const CARD_TEXT_ATTRS = ['title', 'alt', 'data-sku', 'data-upc', 'data-product-sku', 'data-item-sku', 'data-code']

/**
 * Visible card text plus title/alt/data attributes. Href slugs are excluded so "go-2" cannot match "go-20".
 * @param {cheerio.CheerioAPI} $
 * @param {cheerio.Cheerio<cheerio.Element>} root
 */
function collectCardSearchText($, root) {
  const bits = [root.text()]
  root.find('*').addBack().each((_, el) => {
    const attribs = el.attribs || {}
    for (const key of CARD_TEXT_ATTRS) {
      if (attribs[key]) bits.push(attribs[key])
    }
  })
  return bits.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * @param {string} text
 * @param {string} label
 */
function labeledIdentifier(text, label) {
  const re = new RegExp(`\\b${label}\\s*:\\s*([A-Za-z0-9][A-Za-z0-9._-]*)`, 'i')
  return text.match(re)?.[1]?.trim() ?? ''
}

/**
 * Text around a product anchor: the link, its parent, siblings, and the enclosing product card.
 * @param {cheerio.CheerioAPI} $
 * @param {cheerio.Element} el
 */
function blockTextAroundProductAnchor($, el) {
  const $a = $(el)
  const href = $a.attr('href') ?? ''
  const productId = productIdFromHref(href)
  const bits = []

  const card = $a.closest('.product-card, .product-item, .product-grid, [class*="product-item"]')
  if (card.length) {
    bits.push(collectCardSearchText($, card))
  }

  bits.push($a.text())
  const parent = $a.parent()
  if (parent.length) bits.push(parent.text())

  let prev = $a.prev()
  for (let i = 0; prev.length && i < 5; i += 1) {
    bits.push(prev.text())
    prev = prev.prev()
  }

  let next = $a.next()
  for (let i = 0; next.length && i < 8; i += 1) {
    bits.push(next.text())
    next = next.next()
  }

  if (parent.length) {
    let parentNext = parent.next()
    for (let i = 0; parentNext.length && i < 6; i += 1) {
      if (
        productId &&
        parentNext.find('a[href*="/product/"]').toArray().some((node) => {
          const otherId = productIdFromHref($(node).attr('href'))
          return otherId && otherId !== productId
        })
      ) {
        break
      }
      bits.push(parentNext.text())
      parentNext = parentNext.next()
    }
  }

  if (!card.length) {
    let node = $a
    for (let depth = 0; node.length && depth < 10 && !node.is('body'); depth += 1) {
      const container = node.parent()
      if (!container.length) break
      const foreignProduct = container
        .find('a[href*="/product/"]')
        .toArray()
        .some((node) => {
          const otherId = productIdFromHref($(node).attr('href'))
          return productId && otherId && otherId !== productId
        })
      bits.push(container.text())
      if (foreignProduct) break
      node = container
    }
  }

  return bits.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Regex fallback when Cheerio cannot build a DOM (or returns no nodes).
 * @param {string} html
 * @returns {{ sku: string, upc: string, href: string, text: string }[]}
 */
function extractHoneysSearchResultCardsFromRawHtml(html) {
  if (!html || typeof html !== 'string') return []

  /** @type {Map<string, { sku: string, upc: string, href: string, text: string }>} */
  const byKey = new Map()
  const anchorRe = /<a\b[^>]*\shref\s*=\s*["']([^"']*\/product\/[^"']*)["'][^>]*>/gi
  let match

  while ((match = anchorRe.exec(html))) {
    const rawHref = match[1]
    const href = normalizeProductHref(rawHref)
    if (!href) continue
    const key = productLinkKey(rawHref)
    if (!key) continue

    const start = Math.max(0, match.index - 2200)
    const end = Math.min(html.length, match.index + match[0].length + 3200)
    const chunk = html.slice(start, end)
    const text = stripTags(chunk)
    const card = {
      sku: labeledIdentifier(text, 'SKU'),
      upc: labeledIdentifier(text, 'UPC'),
      href,
      text,
    }

    const existing = byKey.get(key)
    if (!existing || cardIdentifierScore(card) > cardIdentifierScore(existing)) {
      byKey.set(key, card)
    }
  }

  return [...byKey.values()]
}

/**
 * @param {{ sku: string, upc: string, text: string }} card
 */
function cardIdentifierScore(card) {
  let score = 0
  if (card.sku) score += 5
  if (card.upc) score += 5
  if (/\bSKU\s*:/i.test(card.text)) score += 3
  if (/\bUPC\s*:/i.test(card.text)) score += 3
  score += Math.min(card.text.length, 800) / 800
  return score
}

const NO_RESULTS_TEXT_PATTERNS = [
  'no products found',
  'your search returned no results',
  'no results found',
  'no matching products',
  'we could not find any products',
  '0 results',
  'no items found',
]

/**
 * @param {string} html
 * @param {number} [maxLen]
 */
export function getSearchHtmlBodySnippet(html, maxLen = 1000) {
  if (!html || typeof html !== 'string') return ''
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)/i)
  const bodyInner = bodyMatch?.[1] ?? html
  return bodyInner.replace(/\s+/g, ' ').trim().slice(0, maxLen)
}

/**
 * @param {string} html
 * @returns {string | null} matched phrase when the page looks empty
 */
export function detectHoneysSearchNoResultsMessage(html) {
  if (!html) return null
  const lower = html.toLowerCase()
  for (const phrase of NO_RESULTS_TEXT_PATTERNS) {
    if (lower.includes(phrase)) return phrase
  }
  return null
}

/**
 * Diagnostics when `.product-card` markup is missing.
 * @param {string} html
 */
export function diagnoseEmptyStructuredSearchCards(html) {
  const hasProductLinks = htmlContainsHoneysProductLinks(html)
  return {
    bodySnippet: getSearchHtmlBodySnippet(html, hasProductLinks ? 1000 : 500),
    noResultsMessage: detectHoneysSearchNoResultsMessage(html),
    hasProductLinks,
  }
}

/**
 * Every product card on a search page, including cards that are not `.product-card`.
 * Each card's searchable text is the card body (SKU, UPC, title), not the URL slug.
 * @param {string} html
 * @returns {{ sku: string, upc: string, href: string, text: string }[]}
 */
export function extractHoneysSearchResultCards(html) {
  if (!html || typeof html !== 'string') return []
  if (!htmlContainsHoneysProductLinks(html)) return []

  /** @type {Map<string, { sku: string, upc: string, href: string, text: string }>} */
  const byKey = new Map()

  try {
    const $ = cheerio.load(html)
    $('a[href*="/product/"], a[href*="/Product/"]').each((_, el) => {
      const rawHref = $(el).attr('href') ?? ''
      if (!hrefContainsProductPath(rawHref)) return
      const href = normalizeProductHref(rawHref)
      if (!href) return

      const text = blockTextAroundProductAnchor($, el)
      const card = {
        sku: labeledIdentifier(text, 'SKU'),
        upc: labeledIdentifier(text, 'UPC'),
        href,
        text,
      }

      const key = productLinkKey(rawHref)
      const existing = byKey.get(key)
      if (!existing || cardIdentifierScore(card) > cardIdentifierScore(existing)) {
        byKey.set(key, card)
      }
    })
  } catch {
    // fall through to raw HTML extraction
  }

  if (byKey.size === 0) {
    return extractHoneysSearchResultCardsFromRawHtml(html)
  }

  return [...byKey.values()]
}

/**
 * @param {string} html
 * @returns {{ sku: string, upc: string, href: string }[]}
 */
export function extractStructuredHoneysProductCards(html) {
  return extractHoneysSearchResultCards(html).map(({ sku, upc, href }) => ({ sku, upc, href }))
}

/**
 * @param {string} html
 * @returns {{ sku: string, href: string }[]}
 */
export function extractHoneysProductLinkCards(html) {
  return extractHoneysSearchResultCards(html).map(({ sku, href }) => ({ sku, href }))
}

/**
 * @param {string} html
 * @returns {{ sku: string, upc: string, href: string }[]}
 */
export function extractHoneysProductCards(html) {
  return extractStructuredHoneysProductCards(html)
}

/**
 * @param {{ sku?: string, upc?: string } | string | string[]} criteria
 * @returns {{ sku: string, upc: string }}
 */
function normalizeSearchMatchCriteria(criteria) {
  if (criteria && typeof criteria === 'object' && !Array.isArray(criteria)) {
    return {
      sku: String(criteria.sku ?? '').trim(),
      upc: String(criteria.upc ?? '').trim(),
    }
  }
  const targets = uniqueMatchTargets(criteria)
  let sku = ''
  let upc = ''
  for (const value of targets) {
    const digits = value.replace(/\D/g, '')
    const looksLikeUpc = digits.length >= 8 && digits.length <= 14 && digits === value.replace(/[\s-]/g, '')
    if (!upc && looksLikeUpc) {
      upc = digits
      continue
    }
    if (!sku && /[A-Za-z]/.test(value)) {
      sku = value
      continue
    }
    if (!sku) sku = value
    else if (!upc) upc = value
  }
  return { sku, upc }
}

/**
 * Manual verification: prefer a block that shows BOTH SKU and UPC; otherwise exact SKU.
 * @param {{ sku: string, upc: string, text: string }[]} cards
 * @param {{ sku: string, upc: string }} criteria
 */
function pickSearchResultCard(cards, criteria) {
  const targetSku = criteria.sku
  const targetUpc = criteria.upc

  if (targetSku && targetUpc) {
    const bothIndex = cards.findIndex(
      (card) =>
        cardTextHasExactIdentifier(card.text, targetSku) &&
        cardTextHasExactIdentifier(card.text, targetUpc),
    )
    if (bothIndex >= 0) {
      return {
        index: bothIndex,
        matchType: 'sku_and_upc',
        matchedIdentifier: `${targetSku} + ${targetUpc}`,
      }
    }
  }

  if (targetSku) {
    const skuIndex = cards.findIndex((card) => cardTextHasExactIdentifier(card.text, targetSku))
    if (skuIndex >= 0) {
      return { index: skuIndex, matchType: 'sku', matchedIdentifier: targetSku }
    }
  }

  if (targetUpc) {
    const upcIndex = cards.findIndex((card) => cardTextHasExactIdentifier(card.text, targetUpc))
    if (upcIndex >= 0) {
      return { index: upcIndex, matchType: 'upc', matchedIdentifier: targetUpc }
    }
  }

  return null
}

/**
 * @param {string} html
 * @param {string} portalUrl
 * @param {{ sku?: string, upc?: string } | string | string[]} criteria
 */
export function resolveHoneysSearchProductDetailUrl(html, portalUrl, criteria) {
  const { sku, upc } = normalizeSearchMatchCriteria(criteria)
  if (!sku && !upc) {
    return { ok: false, reason: 'empty_query', totalProducts: 0, productDetailUrl: '' }
  }

  const cards = extractHoneysSearchResultCards(html)
  if (cards.length === 0) {
    return { ok: false, reason: 'no_cards', totalProducts: 0, productDetailUrl: '' }
  }

  const picked = pickSearchResultCard(cards, { sku, upc })
  if (!picked) {
    return { ok: false, reason: 'no_match', totalProducts: cards.length, productDetailUrl: '' }
  }

  const card = cards[picked.index]
  const base = String(portalUrl ?? '').replace(/\/+$/, '')
  const path = card.href.startsWith('/') ? card.href : `/${card.href}`
  const productDetailUrl = `${base}${path}`

  return {
    ok: true,
    productDetailUrl,
    url: productDetailUrl,
    productIndex: picked.index + 1,
    totalProducts: cards.length,
    matchType: picked.matchType,
    matchedSku: card.sku || sku || card.upc || upc,
    matchedIdentifier: picked.matchedIdentifier,
  }
}

/**
 * @param {string} html
 * @param {string} portalUrl
 * @param {{ sku?: string, upc?: string } | string | string[]} criteria
 */
export function resolveHoneysSearchProductUrl(html, portalUrl, criteria) {
  return resolveHoneysSearchProductDetailUrl(html, portalUrl, criteria)
}

/**
 * @param {string} html
 */
export function isHoneysProductPageHtml(html) {
  return isHoneysProductDetailPage(html, '')
}

/**
 * @param {string} html
 */
export function isHoneysAuthOrBlockPage(html) {
  const lower = html.toLowerCase()
  if (lower.includes('choose-account-page')) return true
  if (lower.includes('incapsula') || lower.includes('_incapsula_resource')) return true
  if (pathnameIsLoginLike(html)) return true
  return false
}

function pathnameIsLoginLike(html) {
  return /<form[^>]*login/i.test(html) && /password/i.test(html) && !/product-title/i.test(html)
}
