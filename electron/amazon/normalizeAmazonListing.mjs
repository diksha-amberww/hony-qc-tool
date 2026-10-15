import { cleanAmazonImageUrl } from './cleanAmazonImageUrl.mjs'

/**
 * @param {string} asin
 * @param {string} marketplaceId
 * @param {unknown} catalogJson
 */
export function normalizeAmazonListing(asin, marketplaceId, catalogJson) {
  const listingUrl = `https://www.amazon.com/dp/${encodeURIComponent(asin)}`
  const root = catalogJson && typeof catalogJson === 'object' ? catalogJson : {}

  const summaries = Array.isArray(root.summaries) ? root.summaries : []
  const summary = summaries.find((s) => s?.marketplaceId === marketplaceId) ?? summaries[0] ?? {}

  const title = pickString(summary.itemName) || pickString(summary.brand) || asin
  const brand = pickString(summary.brand) || '—'

  const attributes = root.attributes && typeof root.attributes === 'object' ? root.attributes : {}
  const { imageUrl, imageUrls } = pickAmazonImageUrls(root, marketplaceId, attributes)

  const identifiers = Array.isArray(root.identifiers) ? root.identifiers : []
  const idBlock = identifiers.find((i) => i?.marketplaceId === marketplaceId) ?? identifiers[0]
  const idList = idBlock?.identifiers ?? []
  const upc =
    pickIdentifier(idList, 'UPC') ||
    pickIdentifier(idList, 'EAN') ||
    pickIdentifier(idList, 'GTIN') ||
    '—'

  const modelNumber = pickAttribute(attributes, ['model_number', 'part_number', 'manufacturer_part_number'])
  const packSize = pickAttribute(attributes, ['number_of_items', 'item_package_quantity']) || '1'
  const priceUsd = pickPriceUsd(attributes, summary)

  return {
    source: 'amazon',
    asin,
    title,
    brand,
    modelNumber: modelNumber || '—',
    packSize,
    upc,
    imageUrl,
    listingUrl,
    marketplace: marketplaceId,
    rawAttributes: {
      marketplaceId,
      listingStatus: pickString(summary.status) || 'Unknown',
      priceUsd,
      imageUrls,
      spApi: root,
    },
  }
}

/**
 * @param {unknown} catalogJson
 * @param {string} marketplaceId
 * @param {Record<string, unknown>} attributes
 */
function pickAmazonImageUrls(catalogJson, marketplaceId, attributes) {
  /** @type {string[]} */
  const candidates = []

  const images = Array.isArray(catalogJson.images) ? catalogJson.images : []
  const preferred = images.find((i) => i?.marketplaceId === marketplaceId)
  const blocksToScan = preferred ? [preferred, ...images.filter((b) => b !== preferred)] : images

  for (const block of blocksToScan) {
    const imageList = Array.isArray(block?.images) ? block.images : []
    const ranked = [...imageList].sort((a, b) => {
      const score = (img) => {
        let s = 0
        if (img?.variant === 'MAIN') s += 1000
        const h = Number(img?.height) || 0
        const w = Number(img?.width) || 0
        return s + h * w
      }
      return score(b) - score(a)
    })
    for (const img of ranked) {
      const link = cleanAmazonImageUrl(img?.link)
      if (link) candidates.push(link)
    }
  }

  for (const key of [
    'main_product_image_locator',
    'other_product_image_locator',
    'swatch_product_image_locator',
  ]) {
    const node = attributes[key]
    if (!Array.isArray(node)) continue
    for (const item of node) {
      const link = cleanAmazonImageUrl(item?.media_location ?? item?.link ?? item?.value)
      if (link) candidates.push(link)
    }
  }

  const unique = [...new Set(candidates)]
  return {
    imageUrl: unique[0] ?? '',
    imageUrls: unique,
  }
}

function pickPriceUsd(attributes, summary) {
  const fromAttr = pickAttribute(attributes, ['list_price', 'buying_price', 'our_price'])
  if (fromAttr) {
    const n = Number.parseFloat(fromAttr.replace(/[^0-9.-]+/g, ''))
    if (Number.isFinite(n)) return n
  }
  return 0
}

function pickString(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed
}

function pickIdentifier(list, type) {
  if (!Array.isArray(list)) return ''
  const found = list.find((entry) => entry?.identifierType === type)
  return pickString(found?.identifier)
}

function pickAttribute(attributes, keys) {
  for (const key of keys) {
    const node = attributes[key]
    if (!node) continue
    if (Array.isArray(node) && node[0]?.value != null) {
      return String(node[0].value).trim()
    }
    if (typeof node === 'string') return node.trim()
  }
  return ''
}
