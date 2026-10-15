import type { AmazonListingExtract, VendorListingExtract } from './listingExtract'
import type { AppSettings } from './settings'
import type { InputRow } from '../utils/inputParse'

export type QcPipelineConditionScore = 'PASS' | 'FAIL' | 'REVIEW'

export type QcPipelineConditionScores = {
  packSize: QcPipelineConditionScore
  brand: QcPipelineConditionScore
  model: QcPipelineConditionScore
  upc: QcPipelineConditionScore
  title: QcPipelineConditionScore
  image: QcPipelineConditionScore
}

export type QcPipelineReport = {
  asin: string
  sku: string
  verdict: 'PASS' | 'FAIL' | 'MANUAL_REVIEW'
  conditionScores: QcPipelineConditionScores
  titleScore: number | null
  imageScore: number | null
  titleSameProduct?: boolean | null
  titleTokenSimilarity?: number | null
  compliance: string
  remarks: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  model?: string
  packEvidenceVendor?: string
  packEvidenceAmazon?: string
}

export type QcPipelineRequest = {
  row?: InputRow
  asin?: string
  sku?: string
  part_sku?: string
  upc?: string
  brand?: string
  line?: string
  rowIndex?: number
  headless?: boolean
  batchLabel?: string
  vendorId?: string
  outputFilePath?: string
  settings: Pick<
    AppSettings,
    | 'titleSimilarityPercent'
    | 'imageSimilarityPercent'
    | 'qcTitleLexicalHybrid'
    | 'qcAggressiveAiCostMode'
    | 'qcModelAiEnabled'
    | 'aiQcModelId'
    | 'aiInputPricePerMillionUsd'
    | 'aiOutputPricePerMillionUsd'
  >
}

export type QcPipelineSuccess = {
  ok: true
  qcReport: QcPipelineReport
  vendorData: Record<string, unknown>
  amazonData: Record<string, unknown>
  vendorExtract: VendorListingExtract
  asinExtract: AmazonListingExtract
  excelFilePath: string
}

export type QcPipelineFailure = {
  ok: false
  phase: 'input' | 'amazon' | 'vendor' | 'compare' | 'export'
  error: string
  kind?: string
  /** Vendor scrape step log (Honey's Place search → PDP), when phase is vendor. */
  vendorLog?: string
}

export type QcPipelineResponse = QcPipelineSuccess | QcPipelineFailure
