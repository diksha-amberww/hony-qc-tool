/**
 * Pack-size QC: vendor delivered count vs Amazon catalog packSize (no AI).
 */

import {
  parseAmazonPackSizeNumber,
  resolveVendorPackSizeFromData,
} from '../electron/vendor/extractVendorPackSize.mjs'

/**
 * @param {object} vendorData
 * @returns {{ packSize: number, evidence: string[] }}
 */
export function resolveVendorPackSize(vendorData) {
  return resolveVendorPackSizeFromData(vendorData ?? {})
}

/**
 * @param {object} amazonData
 * @returns {{ packSize: number, evidence: string[] }}
 */
export function resolveAmazonPackSize(amazonData) {
  const packSize = parseAmazonPackSizeNumber(amazonData?.packSize)
  const evidence = [`amazon packSize field = ${packSize}`]
  return { packSize, evidence }
}

/**
 * Compare vendor delivered count to Amazon packSize from normalizeAmazonListing.
 * @param {object} vendorData
 * @param {object} amazonData
 * @returns {{
 *   pass: boolean
 *   vendor: { packSize: number, evidence: string[] }
 *   amazon: { packSize: number, evidence: string[] }
 * }}
 */
export function comparePackSize(vendorData, amazonData) {
  const vendor = resolveVendorPackSize(vendorData ?? {})
  const amazon = resolveAmazonPackSize(amazonData ?? {})

  const pass = vendor.packSize === amazon.packSize

  return {
    pass,
    vendor,
    amazon,
  }
}
