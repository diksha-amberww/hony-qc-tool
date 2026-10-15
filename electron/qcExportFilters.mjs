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
