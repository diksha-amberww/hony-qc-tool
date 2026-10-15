import * as cheerio from 'cheerio'
import { extractVendorPackSize } from '../electron/vendor/extractVendorPackSize.mjs'

function normalizeWhitespace(text) {
  return String(text ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeLabel(text) {
  return normalizeWhitespace(text)
    .replace(/:\s*$/, '')
    .toLowerCase()
}

/**
 * @param {cheerio.CheerioAPI} $
 * @param {cheerio.Cheerio<cheerio.Element>} container
 */
function parseDetailsFields($, container) {
  const fields = {}
  container.find('.details-row').each((_i, row) => {
    const $row = $(row)
    $row.find('.label').each((_j, labelEl) => {
      const $label = $(labelEl)
      const label = normalizeLabel($label.text())
      const $value = $label.nextAll('.value').first()
      if (!$value.length) return
      const value = normalizeWhitespace($value.text())
      if (!label || !value) return
      if (label.includes('manufacturer')) fields.manufacturer = value
      else if (label === 'sku') fields.sku = value
      else if (label === 'upc') fields.upc = value
      else if (label.includes('case count') || label.includes('case pack')) fields.caseCount = value
      else if (label === 'stock') fields.stock = value
      else if (label === 'msrp') fields.msrp = value
      else if (label.includes('map price')) fields.mapPrice = value
      else if (label.includes('your price')) fields.yourPrice = value
      else if (label === 'wholesale') fields.wholesale = value
    })
  })
  return fields
}

/**
 * @param {cheerio.CheerioAPI} $
 */
function extractProductTitle($) {
  const $title = $('h1.product-title').first()
  if (!$title.length) return ''
  $title.find('i.bi-gem').remove()
  return normalizeWhitespace($title.text())
}

/**
 * @param {cheerio.CheerioAPI} $
 */
function extractDescription($) {
  let found = ''
  $('.section-header').each((_i, el) => {
    if (found) return
    const headerText = normalizeWhitespace($(el).text())
    if (!/description/i.test(headerText) || /product attributes/i.test(headerText)) return
    const $body = $(el).nextAll('.section-body').first()
    if (!$body.length) {
      const $parentBody = $(el).parent().children('.section-body').first()
      if ($parentBody.length) {
        found = normalizeWhitespace(
          $parentBody.html()?.replace(/<br\s*\/?>/gi, '\n') ?? $parentBody.text(),
        )
      }
      return
    }
    found = normalizeWhitespace($body.html()?.replace(/<br\s*\/?>/gi, '\n') ?? $body.text())
  })
  return found.replace(/\n\s+/g, '\n').trim()
}

/**
 * @param {cheerio.CheerioAPI} $
 */
function extractImage($) {
  const activeImg = $('.carousel-item.active img.product-carousel-image').first()
  if (activeImg.length) return activeImg.attr('src')?.trim() ?? ''

  const anyImg = $('img.product-carousel-image').first()
  if (anyImg.length) return anyImg.attr('src')?.trim() ?? ''

  const og = $('meta[property="og:image"]').attr('content')
  return og?.trim() ?? ''
}

/**
 * @param {cheerio.CheerioAPI} $
 */
function collectAttributeTextsForPack($) {
  const parts = []
  $('.attribute-row').each((_i, row) => {
    const $row = $(row)
    const label = normalizeLabel($row.find('.left span').first().text())
    if (label === 'weight' || label === 'upc') return
    const value = normalizeWhitespace($row.find('.right').first().text())
    if (value) parts.push(value)
  })
  return parts
}

/**
 * @param {cheerio.CheerioAPI} $
 * @returns {Record<string, string>}
 */
function collectProductAttributes($) {
  /** @type {Record<string, string>} */
  const attrs = {}
  $('.attribute-row').each((_i, row) => {
    const $row = $(row)
    const label = normalizeWhitespace($row.find('.left span').first().text()).replace(/:\s*$/, '')
    const value = normalizeWhitespace($row.find('.right').first().text())
    if (label && value) attrs[label] = value
  })
  return attrs
}

/**
 * @param {string} title
 * @param {string} description
 * @param {cheerio.CheerioAPI} $
 */
function extractPackSize(title, description, $, minOrderQty) {
  const attributeTexts = collectAttributeTextsForPack($)
  const extracted = extractVendorPackSize({
    title,
    description,
    attributeTexts,
    minOrderQty,
  })
  return {
    packSize: extracted.packSize,
    packSizeUnit: extracted.packSizeUnit || 'each',
  }
}

const MIN_QTY_TEXT_RE =
  /\bmin(?:imum)?\s*(?:order\s*)?(?:qty|quantity)\s*[:\s]+\s*(\d+)\b/i

/**
 * @param {cheerio.CheerioAPI} $
 */
function extractMinOrderQty($) {
  const buyControls = $('.buy-controls-wrapper').first()
  const scope = buyControls.length ? buyControls : $('body')

  const scopeText = normalizeWhitespace(scope.text())
  const textMatch = scopeText.match(MIN_QTY_TEXT_RE)
  if (textMatch?.[1]) {
    const n = Number.parseInt(textMatch[1], 10)
    if (Number.isFinite(n) && n > 0) return n
  }

  const qtyInput =
    scope.find('input.qty-input[id^="qty-input-"]').first()[0] ||
    scope.find('input[id^="special-qty-input-"]').first()[0] ||
    scope.find('input.qty-input').first()[0]

  if (qtyInput) {
    const minAttr = qtyInput.attribs?.min ?? qtyInput.attribs?.['data-min']
    if (minAttr != null && String(minAttr).trim() !== '') {
      const n = Number.parseInt(String(minAttr), 10)
      if (Number.isFinite(n) && n > 0) return n
    }
    const valueAttr = qtyInput.attribs?.value
    if (valueAttr != null && String(valueAttr).trim() !== '') {
      const n = Number.parseInt(String(valueAttr), 10)
      if (Number.isFinite(n) && n > 1) return n
    }
  }

  const detailsText = normalizeWhitespace($('.details-container').text())
  const detailsMatch = detailsText.match(MIN_QTY_TEXT_RE)
  if (detailsMatch?.[1]) {
    const n = Number.parseInt(detailsMatch[1], 10)
    if (Number.isFinite(n) && n > 0) return n
  }

  return null
}

const AMAZON_COMPLIANCE_PHRASE_RES = [
  /\bnot\s+for\s+sale\s+on\s+amazon\b/i,
  /\bdo\s+not\s+sell\s+on\s+amazon\b/i,
  /\bno\s+amazon\s+(?:sales|selling)\b/i,
  /\bamazon\s+restricted\s+item\b/i,
  /\bamazon\s+restricted\b/i,
  /\bnot\s+for\s+amazon\b/i,
]

/**
 * @param {cheerio.CheerioAPI} $
 * @param {string} html
 * @returns {{ compliance: 'COMPLIANT' | 'NON COMPLIANT', remarks: string }}
 */
function extractCompliance($) {
  const shortCandidates = []

  $(
    '[class*="text-danger"], [class*="text-warning"], [style*="color:#dc3545"], [style*="color: #dc3545"], [style*="color:red"]',
  ).each((_i, el) => {
    const text = normalizeWhitespace($(el).text())
    if (text.length < 4) return
    shortCandidates.push(text)
  })

  for (const text of shortCandidates) {
    for (const re of AMAZON_COMPLIANCE_PHRASE_RES) {
      if (re.test(text)) {
        return { compliance: 'NON COMPLIANT', remarks: text }
      }
    }
    if (/amazon/i.test(text) && /(restricted|not for sale|do not sell|prohibited)/i.test(text)) {
      return { compliance: 'NON COMPLIANT', remarks: text }
    }
  }

  const bodyText = normalizeWhitespace($('body').text())
  for (const re of AMAZON_COMPLIANCE_PHRASE_RES) {
    const m = bodyText.match(re)
    if (m?.[0]) {
      return {
        compliance: 'NON COMPLIANT',
        remarks: m[0].replace(/\s+/g, ' ').trim(),
      }
    }
  }

  return { compliance: 'COMPLIANT', remarks: '' }
}

/**
 * @param {string} html
 * @param {string} [pageUrl]
 */
export function parseHoneysProductHtml(html, pageUrl = '') {
  if (!html || typeof html !== 'string') return null

  const $ = cheerio.load(html)
  const detailsContainer = $('.details-container').first()
  const details = detailsContainer.length
    ? parseDetailsFields($, detailsContainer)
    : {}

  const productTitle = extractProductTitle($)
  const brandName = details.manufacturer || ''
  const modelNumberSku = details.sku || ''
  const upc = details.upc || ''
  const description = extractDescription($)
  const image = extractImage($)
  const minOrderQty = extractMinOrderQty($)
  const { packSize, packSizeUnit } = extractPackSize(productTitle, description, $, minOrderQty)
  const productAttributes = collectProductAttributes($)
  const upcFromAttrs = productAttributes.UPC || productAttributes.Upc || ''
  const { compliance, remarks } = extractCompliance($)

  if (!productTitle && !modelNumberSku) return null

  const packSizeValue = Number.parseInt(String(packSize), 10)
  const packSizeNumeric = Number.isFinite(packSizeValue) && packSizeValue >= 1 ? packSizeValue : 1

  const result = {
    productTitle,
    title: productTitle,
    brandName,
    brand: brandName,
    modelNumberSku,
    sku: modelNumberSku,
    modelNumber: modelNumberSku,
    upc: upc || upcFromAttrs,
    description,
    image,
    packSize: String(packSizeNumeric),
    packSizeValue: packSizeNumeric,
    packSizeUnit,
    productAttributes,
    caseCount: details.caseCount || undefined,
    stock: details.stock || undefined,
    compliance,
    remarks,
    pageUrl: pageUrl || '',
  }

  if (minOrderQty != null) {
    result.minOrderQty = minOrderQty
  }

  return result
}

/**
 * Logged-out portal HTML (no product page): login prompts without a product title.
 * @param {string} html
 */
export function isHoneysLogoutHtml(html) {
  if (!html || typeof html !== 'string') return false
  if (/<h1[^>]*class="[^"]*product-title/i.test(html)) return false
  if (/\bproduct-title\b/i.test(html)) return false

  const lower = html.toLowerCase()
  if (lower.includes('sign into your account')) return true
  if (lower.includes('choose-account-page')) return true
  return /<form[^>]*login/i.test(html) && /password/i.test(html)
}

/**
 * @param {string} html
 */
export function isHoneysAuthOrBlockPage(html) {
  const lower = html.toLowerCase()
  if (lower.includes('choose-account-page')) return true
  if (lower.includes('incapsula') || lower.includes('_incapsula_resource')) return true
  if (/product-title/i.test(html)) return false
  return /<form[^>]*login/i.test(html) && /password/i.test(html)
}

/**
 * @param {string} html
 * @param {Response} res
 */
export function shouldWaitForSessionRecovery(html, res) {
  if (res.status === 401 || res.status === 403) return true
  return isHoneysLogoutHtml(html)
}
