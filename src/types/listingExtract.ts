import type { QcCompareOutcome } from '../utils/qcThresholdComparison'
import type { QcIdentityField, QcVerdict } from './qc'

export type ListingRawAttributes = Record<string, string | number | boolean | null>

export type AmazonListingExtract = {
  source: 'amazon'
  asin: string
  title: string
  brand: string
  modelNumber: string
  packSize: string
  upc: string
  imageUrl: string
  listingUrl: string
  marketplace?: string
  rawAttributes: ListingRawAttributes
}

export type VendorListingExtract = {
  source: 'vendor_website'
  sku: string
  title: string
  brand: string
  line: string
  modelNumber: string
  packSize: string
  packSizeValue?: number
  packSizeUnit?: string
  upc: string
  description?: string
  imageUrl: string
  pageUrl: string
  rawAttributes: ListingRawAttributes
}

export type ListingComparison = {
  key: string
  label: string
  sourceValue: string
  targetValue: string
  outcome: QcCompareOutcome
}

export type ListingQcPayload = {
  identity: QcIdentityField[]
  verdict: QcVerdict
  comparisons: ListingComparison[]
  asinExtract: AmazonListingExtract
  vendorExtract: VendorListingExtract
  inputTokens: number
  outputTokens: number
  inputRowUpc?: string
  titleScore?: number | null
  imageScore?: number | null
  titleSameProduct?: boolean | null
  titleTokenSimilarity?: number | null
  costUsd?: number | null
  qcModel?: string
  packEvidenceVendor?: string
  packEvidenceAmazon?: string
}

export type QcProcessRowSuccess = {
  ok: true
  result: ListingQcPayload
}

export type QcProcessRowFailure = {
  ok: false
  phase: 'amazon' | 'vendor' | 'compare'
  error: string
  kind?: string
}

export type QcProcessRowResponse = QcProcessRowSuccess | QcProcessRowFailure
