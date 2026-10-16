import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import {
  GRAND_QC_EXPORT_HEADERS,
  mapGrandQcExportRowFromPipeline,
} from './grandQcExport.mjs'

/** Exact header order for the QC Report sheet (matches Export page Excel). */
export const QC_REPORT_HEADERS = GRAND_QC_EXPORT_HEADERS

const HEADER_FONT = { bold: true }
const PASS_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } }
const FAIL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } }
const MANUAL_REVIEW_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE699' } }

function pickString(...values) {
  for (const v of values) {
    if (v == null) continue
    const s = String(v).trim()
    if (s) return s
  }
  return ''
}

/**
 * Map one QC report + vendor scrape into a single export row (header order).
 * Compliance column (next to VERDICT) is RESTRICTION or OK from vendor scrape restriction signals.
 *
 * @param {object} qcReport
 * @param {object} vendorData
 * @returns {(string|number)[]}
 */
export function mapQcRowToExportValues(qcReport, vendorData, amazonData) {
  return mapGrandQcExportRowFromPipeline({
    qcReport,
    vendorData,
    amazonData,
  })
}

function autoFitColumns(worksheet, columnCount, rowCount) {
  for (let col = 1; col <= columnCount; col++) {
    let maxLen = 12
    for (let row = 1; row <= rowCount; row++) {
      const cell = worksheet.getCell(row, col)
      const text = cell.value == null ? '' : String(cell.value)
      maxLen = Math.max(maxLen, Math.min(text.length + 2, 60))
    }
    worksheet.getColumn(col).width = maxLen
  }
}

function normalizeVerdictKey(verdict) {
  const v = String(verdict ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
  if (v === 'MANUAL_REVIEW' || v === 'MANUAL') return 'MANUAL_REVIEW'
  return v
}

function applyVerdictStyle(cell, verdict) {
  const key = normalizeVerdictKey(verdict)
  if (key === 'PASS') cell.fill = PASS_FILL
  else if (key === 'FAIL') cell.fill = FAIL_FILL
  else if (key === 'MANUAL_REVIEW') cell.fill = MANUAL_REVIEW_FILL
}

/**
 * Build a workbook with a "QC Report" sheet for one or more rows.
 *
 * @param {Array<{ qcReport: object, vendorData: object }>} rows
 * @returns {ExcelJS.Workbook}
 */
export function buildQcReportWorkbook(rows) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Honey QC Tool'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('QC Report', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  const headerRow = sheet.addRow([...QC_REPORT_HEADERS])
  headerRow.eachCell((cell) => {
    cell.font = HEADER_FONT
  })

  const verdictColIndex = QC_REPORT_HEADERS.indexOf('VERDICT') + 1

  for (const entry of rows) {
    const values = mapQcRowToExportValues(entry.qcReport, entry.vendorData, entry.amazonData)
    const row = sheet.addRow(values)
    applyVerdictStyle(row.getCell(verdictColIndex), values[2])
  }

  autoFitColumns(sheet, QC_REPORT_HEADERS.length, rows.length + 1)
  return workbook
}

/**
 * Format a QC report into a real Excel (.xlsx) file and write it to disk.
 *
 * @param {object|object[]} qcReport — single report, or array of reports (paired with vendorData)
 * @param {object|object[]} vendorData — matching vendor scrape JSON (or array)
 * @param {string} outputFilePath — destination .xlsx path
 * @returns {Promise<{ ok: true, outputFilePath: string, rowCount: number }>}
 */
export async function formatAndExportToExcel(qcReport, vendorData, outputFilePath, amazonData) {
  if (!outputFilePath || typeof outputFilePath !== 'string') {
    throw new Error('outputFilePath is required.')
  }

  const absolutePath = path.resolve(outputFilePath)
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })

  /** @type {Array<{ qcReport: object, vendorData: object }>} */
  let rows
  if (Array.isArray(qcReport)) {
    const vendors = Array.isArray(vendorData) ? vendorData : []
    const amazons = Array.isArray(amazonData) ? amazonData : []
    rows = qcReport.map((report, i) => ({
      qcReport: report,
      vendorData: vendors[i] ?? {},
      amazonData: amazons[i] ?? {},
    }))
  } else {
    rows = [
      {
        qcReport: qcReport ?? {},
        vendorData: vendorData ?? {},
        amazonData: amazonData ?? {},
      },
    ]
  }

  const workbook = buildQcReportWorkbook(rows)
  await workbook.xlsx.writeFile(absolutePath)

  return {
    ok: true,
    outputFilePath: absolutePath,
    rowCount: rows.length,
  }
}
