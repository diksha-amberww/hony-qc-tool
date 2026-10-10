import type { QcExportRequest, QcExportResponse } from '../../types/qcExport'
import {
  buildExportCsv,
  buildExportSpreadsheetMl,
  downloadExportFile,
  filterQcResultsForExport,
} from '../../utils/qcExport'

function buildExportFileName(
  scope: QcExportRequest['scope'],
  format: QcExportRequest['format'],
  filter: QcExportRequest['filter'],
  rowCount: number,
): string {
  const stamp = new Date().toISOString().slice(0, 10)
  const scopeLabel = scope === 'partial' ? 'Partial' : 'Full'
  const filterLabel = filter === 'all' ? 'all' : filter
  const ext = format === 'csv' ? 'csv' : 'xls'
  return `QC_${scopeLabel}_${stamp}_${filterLabel}_${rowCount}rows.${ext}`
}

/** In-process export (web / dev) — same validation and file content as the Electron main process. */
export function exportQcBatchInProcess(request: QcExportRequest): QcExportResponse {
  const { scope, format, filter, results, batchTotal } = request

  if (scope === 'partial' && results.length === 0) {
    return { ok: false, error: 'No finished QC rows to export yet.' }
  }
  if (scope === 'full') {
    if (batchTotal <= 0) {
      return { ok: false, error: 'Batch total is missing. Run QC from Upload first.' }
    }
    if (results.length < batchTotal) {
      return {
        ok: false,
        error: `Full export unlocks when the batch finishes (${results.length}/${batchTotal} complete).`,
      }
    }
  }

  const filteredRows = filterQcResultsForExport(results, filter)
  if (filteredRows.length === 0) {
    return { ok: false, error: 'No rows match the current verdict filter.' }
  }

  const fileName = buildExportFileName(scope, format, filter, filteredRows.length)
  if (format === 'csv') {
    const csv = buildExportCsv(filteredRows)
    downloadExportFile(fileName, csv)
  } else {
    const xml = buildExportSpreadsheetMl(filteredRows)
    downloadExportFile(fileName, xml, 'application/vnd.ms-excel')
  }

  return {
    ok: true,
    fileName,
    rowCount: filteredRows.length,
    format,
    scope,
  }
}
