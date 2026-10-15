/** @param {{ titleScore?: number | null, titleSameProduct?: boolean | null }} report */
export function normalizeTitleAiScorePercent(report) {
  const raw = report?.titleScore
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (report?.titleSameProduct === true) return 100
  if (report?.titleSameProduct === false) return 0
  return null
}

/** @param {{ imageScore?: number | null }} report */
export function normalizeImageAiScorePercent(report) {
  const raw = report?.imageScore
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  return null
}
