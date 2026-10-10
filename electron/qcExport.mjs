const MISSING_MARKERS = new Set(['—', '-', 'n/a', 'na', 'null', 'undefined'])

function isMissingValue(value) {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return true
  return MISSING_MARKERS.has(trimmed.toLowerCase())
}

export function isQcExportException(result) {
  if (result.identity?.some((field) => isMissingValue(field.value))) return true
  return (result.comparisons ?? []).some(
    (field) => isMissingValue(field.sourceValue) || isMissingValue(field.targetValue),
  )
}

export function filterQcResultsForExport(results, filter) {
  if (filter === 'all') return results
  if (filter === 'pass') return results.filter((r) => r.verdict === 'PASS')
  if (filter === 'fail') return results.filter((r) => r.verdict === 'FAIL')
  if (filter === 'manual') return results.filter((r) => r.verdict === 'MANUAL_REVIEW')
  return results.filter((r) => isQcExportException(r))
}

function escapeCsv(value) {
  const str = String(value ?? '')
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function verdictLabel(verdict) {
  return String(verdict).replace(/_/g, ' ')
}

function rowToCsvLine(result) {
  const identity = (result.identity ?? []).map((f) => f.value).join(' | ')
  const comparisons = (result.comparisons ?? [])
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

const CSV_HEADER = 'Result ID,Verdict,Identity,Comparisons,Input Tokens,Output Tokens'

export function buildExportCsv(results) {
  if (!results.length) return `${CSV_HEADER}\n`
  return [CSV_HEADER, ...results.map(rowToCsvLine)].join('\n')
}

export function buildExportSpreadsheetMl(results) {
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
    const identity = (result.identity ?? []).map((f) => f.value).join(' | ')
    const comparisons = (result.comparisons ?? [])
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

export function buildExportFileName({ scope, format, filter, rowCount }) {
  const stamp = new Date().toISOString().slice(0, 10)
  const scopeLabel = scope === 'partial' ? 'Partial' : 'Full'
  const filterLabel = filter === 'all' ? 'all' : filter
  const ext = format === 'csv' ? 'csv' : 'xls'
  return `QC_${scopeLabel}_${stamp}_${filterLabel}_${rowCount}rows.${ext}`
}

export function runQcExportPipeline(request) {
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

  const content =
    format === 'csv' ? buildExportCsv(filteredRows) : buildExportSpreadsheetMl(filteredRows)
  const mime =
    format === 'csv' ? 'text/csv;charset=utf-8' : 'application/vnd.ms-excel'

  return {
    ok: true,
    fileName,
    content,
    mime,
    rowCount: filteredRows.length,
    format,
    scope,
  }
}
