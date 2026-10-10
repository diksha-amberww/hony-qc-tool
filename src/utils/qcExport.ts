import type { QcResult, QcVerdict } from '../types/qc'

export type ExportVerdictFilter = 'all' | 'pass' | 'fail' | 'manual' | 'exceptions'

export type ExportVerdictCounts = {
  all: number
  pass: number
  fail: number
  manual: number
  exceptions: number
}

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const MISSING_MARKERS = new Set(['—', '-', 'n/a', 'na', 'null', 'undefined'])

function isMissingValue(value: string | undefined): boolean {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return true
  return MISSING_MARKERS.has(trimmed.toLowerCase())
}

/** Rows with missing scrape/compare fields (data gaps), distinct from verdict-based manual review. */
export function isQcExportException(result: QcResult): boolean {
  if (result.identity.some((field) => isMissingValue(field.value))) return true
  return result.comparisons.some(
    (field) => isMissingValue(field.sourceValue) || isMissingValue(field.targetValue),
  )
}

export function countExportVerdicts(results: QcResult[]): ExportVerdictCounts {
  let pass = 0
  let fail = 0
  let manual = 0
  let exceptions = 0
  for (const row of results) {
    if (row.verdict === 'PASS') pass++
    else if (row.verdict === 'FAIL') fail++
    else if (row.verdict === 'MANUAL_REVIEW') manual++
    if (isQcExportException(row)) exceptions++
  }
  return { all: results.length, pass, fail, manual, exceptions }
}

export function filterQcResultsForExport(
  results: QcResult[],
  filter: ExportVerdictFilter,
): QcResult[] {
  if (filter === 'all') return results
  if (filter === 'pass') return results.filter((r) => r.verdict === 'PASS')
  if (filter === 'fail') return results.filter((r) => r.verdict === 'FAIL')
  if (filter === 'manual') return results.filter((r) => r.verdict === 'MANUAL_REVIEW')
  return results.filter((r) => isQcExportException(r))
}

function rowToCsvLine(result: QcResult): string {
  const identity = result.identity.map((f) => f.value).join(' | ')
  const comparisons = result.comparisons
    .map((c) => `${c.label}: ${c.sourceValue} → ${c.targetValue}`)
    .join(' | ')
  return [
    escapeCsv(result.id),
    escapeCsv(result.verdict),
    escapeCsv(identity),
    escapeCsv(comparisons),
    String(result.inputTokens ?? 0),
    String(result.outputTokens ?? 0),
  ].join(',')
}

const CSV_HEADER =
  'Result ID,Verdict,Identity,Comparisons,Input Tokens,Output Tokens'

export function buildExportCsv(results: QcResult[]): string {
  if (results.length === 0) return `${CSV_HEADER}\n`
  return [CSV_HEADER, ...results.map(rowToCsvLine)].join('\n')
}

export function buildPartialExportCsv(completed: QcResult[]): string {
  return buildExportCsv(completed)
}

export function buildFullExportCsv(completed: QcResult[], total: number): string | null {
  if (total <= 0 || completed.length < total) return null
  return buildPartialExportCsv(completed)
}

function verdictLabel(verdict: QcVerdict): string {
  return verdict.replace(/_/g, ' ')
}

export function buildExportSpreadsheetMl(results: QcResult[]): string {
  const headerCells = [
    'Result ID',
    'Verdict',
    'Identity',
    'Comparisons',
    'Input Tokens',
    'Output Tokens',
  ]
    .map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`)
    .join('')

  const dataRows = results.map((result) => {
    const identity = result.identity.map((f) => f.value).join(' | ')
    const comparisons = result.comparisons
      .map((c) => `${c.label}: ${c.sourceValue} → ${c.targetValue}`)
      .join(' | ')
    const cells = [
      result.id,
      verdictLabel(result.verdict),
      identity,
      comparisons,
      String(result.inputTokens ?? 0),
      String(result.outputTokens ?? 0),
    ]
      .map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`)
      .join('')
    return `<Row>${cells}</Row>`
  })

  const headerRow = `<Row>${headerCells}</Row>`

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="QC Export">
  <Table>
   ${headerRow}
   ${dataRows.join('\n   ')}
  </Table>
 </Worksheet>
</Workbook>`
}

export function downloadExportFile(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
