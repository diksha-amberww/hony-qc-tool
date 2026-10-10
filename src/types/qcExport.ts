import type { QcResult } from './qc'
import type { ExportVerdictFilter } from '../utils/qcExport'

export type QcExportScope = 'partial' | 'full'

export type QcExportFormat = 'csv' | 'xlsx'

export type QcExportRequest = {
  scope: QcExportScope
  format: QcExportFormat
  filter: ExportVerdictFilter
  /** All completed QC rows for this batch (backend applies verdict filter). */
  results: QcResult[]
  /** Batch size from upload — required when scope is `full`. */
  batchTotal: number
  vendorDisplayName?: string
}

export type QcExportSuccess = {
  ok: true
  filePath?: string
  fileName: string
  rowCount: number
  format: QcExportFormat
  scope: QcExportScope
}

export type QcExportFailure = {
  ok: false
  error: string
}

export type QcExportResponse = QcExportSuccess | QcExportFailure
