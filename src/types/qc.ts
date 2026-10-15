/** Vendor-neutral QC result types for the reusable QC Template. */

export type QcVerdict = 'PASS' | 'FAIL' | 'MANUAL_REVIEW'

export type QcProcessStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'done'

/** Product identity fields shown in the live results table (labels come from the vendor tool). */
export type QcIdentityField = {
  key: string
  label: string
  value: string
}

export type QcRunSource = 'upload' | 'sandbox'

/** One compared attribute; field set varies by vendor. */
export type QcComparisonField = {
  key: string
  label: string
  sourceValue: string
  targetValue: string
  outcome?: import('../utils/qcThresholdComparison').QcCompareOutcome
}

/**
 * One finished SKU / product QC result.
 * Structure is fixed; identity + comparison fields are supplied by the vendor tool.
 */
export type QcResult = {
  id: string
  identity: QcIdentityField[]
  verdict: QcVerdict
  comparisons: QcComparisonField[]
  /** Where this row was produced (Upload batch vs Sandbox single-run). */
  runSource?: QcRunSource
  /** Optional column headers for the comparison detail view. */
  sourceColumnLabel?: string
  targetColumnLabel?: string
  /** Product image URLs for Vendor (source) and Amazon (target) inspection. */
  sourceImageUrl?: string
  targetImageUrl?: string
  /**
   * Complete raw scrape payloads for the SKU viewer.
   * Vendor tool supplies whatever shape it scraped; UI renders JSON as-is.
   */
  sourceRawExtract?: unknown
  targetRawExtract?: unknown
  inputTokens?: number
  outputTokens?: number
  titleScore?: number | null
  imageScore?: number | null
  /** UPC from upload/input sheet (export column UPC Vendor). */
  inputRowUpc?: string
  titleSameProduct?: boolean | null
  titleTokenSimilarity?: number | null
  costUsd?: number | null
  qcModel?: string
  packEvidenceVendor?: string
  packEvidenceAmazon?: string
}

export type { QcLogEntry, LogCategory, LogCategoryInput, AppendLogInput } from './log'
export { LOG_CATEGORIES } from './log'
