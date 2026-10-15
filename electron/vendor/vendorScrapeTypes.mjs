/**
 * @typedef {Record<string, string>} InputRow
 */

/**
 * @typedef {Object} VendorListingExtract
 * @property {'vendor_website'} source
 * @property {string} sku
 * @property {string} title
 * @property {string} brand
 * @property {string} line
 * @property {string} modelNumber
 * @property {string} packSize
 * @property {number} [packSizeValue]
 * @property {string} [packSizeUnit]
 * @property {string} upc
 * @property {string} [description]
 * @property {string} imageUrl
 * @property {string} pageUrl
 * @property {Record<string, string | number | boolean | null>} rawAttributes
 */

/**
 * @typedef {Object} VendorScrapeContext
 * @property {InputRow} row
 * @property {number} rowIndex
 * @property {boolean} headless
 * @property {string} [batchLabel]
 * @property {(line: string) => void} [onLogLine]
 */

/**
 * @typedef {(ctx: VendorScrapeContext) => Promise<{ ok: true, extract: VendorListingExtract } | { ok: false, kind: string, error: string }>} VendorScrapeHandler
 */

export {}
