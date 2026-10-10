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
    if (key.includes('manufacturer')) fields.manufacturer = value
    else if (key === 'sku') fields.sku = value
    else if (key === 'upc') fields.upc = value
    else if (key.includes('your price')) fields.yourPrice = value
    else if (key === 'wholesale') fields.wholesale = value
    else if (key.includes('case count')) fields.caseCount = value
  }
  return fields
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
  return m?.[1] ? stripTags(m[1]) : ''
}

/**
 * @param {string[]} texts
 * @returns {{ packSize: string, packSizeSource: string }}
 */
function extractPackSize(texts) {
  const combined = texts.filter(Boolean).join(' ')
  if (!combined) return { packSize: 'Unknown/Review', packSizeSource: 'none' }

  if (/\bSingle\b/i.test(combined)) {
    return { packSize: 'Single', packSizeSource: 'explicit' }
  }

  const packOf = combined.match(/\bPack\s+of\s+(\d+)\b/i)
  if (packOf?.[1]) {
    return { packSize: `Pack of ${packOf[1]}`, packSizeSource: 'explicit' }
  }

  const nPack = combined.match(/\b(\d+)\s*-?\s*Pack\b/i)
  if (nPack?.[1]) {
    return { packSize: `${nPack[1]}-Pack`, packSizeSource: 'explicit' }
  }

  return { packSize: 'Unknown/Review', packSizeSource: 'none' }
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
 *   packSizeSource: string
 *   upc: string
 *   sku: string
 *   imageUrl: string
 *   pageUrl: string
 *   priceUsd: number
 *   msrpUsd: number
 * }}
 */
export function parseHoneysProductHtml(html, pageUrl = '') {
  if (!html || typeof html !== 'string') return null

  const snapshot = parseFrontProductSnapshot(html)
  const details = parseDetailsRows(html)
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
  if (!title && !sku) return null

  const manufacturer = details.manufacturer || ''
  const brand = manufacturer || (title ? brandFromTitlePrefix(title) : '') || ''

  const manufacturerPartNumber = sku
  const originalModelNumber = sku
  const modelNumber = manufacturerPartNumber

  const description = extractDescriptionText(html)
  const { packSize, packSizeSource } = extractPackSize([title, ogTitle, description])

  const imageUrl = extractMainImageUrl(html, snapshot)
  const upc = details.upc || ''

  const priceUsd = parsePriceUsd(details.yourPrice) || parsePriceUsd(details.wholesale)

  let msrpUsd = 0
  const ogBlock = pickOgBlock(snapshot)
  if (ogBlock?.['og:price:amount'] != null) {
    msrpUsd = parsePriceUsd(ogBlock['og:price:amount'])
  }

  return {
    title,
    brand,
    manufacturerPartNumber,
    originalModelNumber,
    modelNumber,
    packSize,
    packSizeSource,
    upc,
    sku,
    imageUrl,
    pageUrl: pageUrl || '',
    priceUsd,
    msrpUsd,
  }
}

/**
 * @param {string} html
 */
export function isHoneysProductPageHtml(html) {
  return Boolean(parseHoneysProductHtml(html, ''))
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
