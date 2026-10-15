import ExcelJS from 'exceljs'
import {
  GRAND_QC_EXPORT_HEADERS,
  mapGrandQcExportRowFromQcResult,
} from '../scripts/grandQcExport.mjs'
import { filterQcResultsForExport, isQcExportException } from './qcExportFilters.mjs'

export { filterQcResultsForExport, isQcExportException }

function escapeCsv(value) {
  const str = String(value ?? '')
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

export function buildExportCsv(results) {
  const lines = [GRAND_QC_EXPORT_HEADERS.map(escapeCsv).join(',')]
  for (const result of results) {
    const cells = mapGrandQcExportRowFromQcResult(result).map((v) => escapeCsv(v))
    lines.push(cells.join(','))
  }
  return `${lines.join('\n')}\n`
}

export async function buildExportXlsxBuffer(results) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Hony QC Tool'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('QC Export', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  const headerRow = sheet.addRow([...GRAND_QC_EXPORT_HEADERS])
  headerRow.eachCell((cell) => {
    cell.font = { bold: true }
  })

  const verdictCol = GRAND_QC_EXPORT_HEADERS.indexOf('VERDICT') + 1
  const passFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } }
  const failFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } }

  for (const result of results) {
    const values = mapGrandQcExportRowFromQcResult(result)
    const row = sheet.addRow(values)
    const verdict = String(values[2] ?? '').toUpperCase()
    if (verdict === 'PASS') row.getCell(verdictCol).fill = passFill
    else if (verdict === 'FAIL') row.getCell(verdictCol).fill = failFill
  }

  for (let col = 1; col <= GRAND_QC_EXPORT_HEADERS.length; col++) {
    let maxLen = 14
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 200) return
      const text = row.getCell(col).value == null ? '' : String(row.getCell(col).value)
      maxLen = Math.max(maxLen, Math.min(text.length + 2, 48))
    })
    sheet.getColumn(col).width = maxLen
  }

  return workbook.xlsx.writeBuffer()
}

export function buildExportFileName({ scope, format, filter, rowCount }) {
  const stamp = new Date().toISOString().slice(0, 10)
  const scopeLabel = scope === 'partial' ? 'Partial' : 'Full'
  const filterLabel = filter === 'all' ? 'all' : filter
  const ext = format === 'csv' ? 'csv' : 'xlsx'
  return `QC_${scopeLabel}_${stamp}_${filterLabel}_${rowCount}rows.${ext}`
}

export async function runQcExportPipeline(request) {
  const scope = request?.scope
  const format = request?.format
  const filter = request?.filter ?? 'all'
  const results = Array.isArray(request?.results) ? request.results : []
  const batchTotal = typeof request?.batchTotal === 'number' ? request.batchTotal : 0

  if (scope !== 'partial' && scope !== 'full') {
    return { ok: false, error: 'Invalid export scope.' }
  }
  if (format !== 'csv' && format !== 'xlsx') {
    return { ok: false, error: 'Invalid export format.' }
  }
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

  const fileName = buildExportFileName({
    scope,
    format,
    filter,
    rowCount: filteredRows.length,
  })

  if (format === 'csv') {
    return {
      ok: true,
      fileName,
      content: buildExportCsv(filteredRows),
      mime: 'text/csv;charset=utf-8',
      rowCount: filteredRows.length,
      format,
      scope,
    }
  }

  const buffer = await buildExportXlsxBuffer(filteredRows)
  return {
    ok: true,
    fileName,
    buffer,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    rowCount: filteredRows.length,
    format,
    scope,
  }
}
