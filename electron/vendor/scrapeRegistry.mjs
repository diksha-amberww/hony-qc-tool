/**
 * Vendor scrape registry — register vendor-specific listing scrapers here.
 *
 * Vendor fork example:
 *   import { acmeScrapeListing } from './vendors/acmeScrape.mjs'
 *   registerVendorScraper('acme', acmeScrapeListing)
 * Then set VENDOR_INTEGRATION_ID in src/config/vendorIntegration.ts to 'acme'.
 */

import { templateVendorScrapeListing } from './templateVendorScrape.mjs'
import { honeysPlaceScrapeListing } from './honeysPlaceScrape.mjs'

/** @type {Map<string, import('./vendorScrapeTypes.mjs').VendorScrapeHandler>} */
const scrapers = new Map()

const DEFAULT_VENDOR_ID = 'template'

scrapers.set(DEFAULT_VENDOR_ID, templateVendorScrapeListing)
scrapers.set('honeys', honeysPlaceScrapeListing)

/**
 * @param {string} vendorId
 * @param {import('./vendorScrapeTypes.mjs').VendorScrapeHandler} handler
 */
export function registerVendorScraper(vendorId, handler) {
  scrapers.set(vendorId, handler)
}

/**
 * @param {string} [vendorId]
 * @returns {import('./vendorScrapeTypes.mjs').VendorScrapeHandler}
 */
export function getVendorScraper(vendorId = DEFAULT_VENDOR_ID) {
  return scrapers.get(vendorId) ?? scrapers.get(DEFAULT_VENDOR_ID)
}
