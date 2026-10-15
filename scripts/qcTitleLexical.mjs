/** Token overlap title similarity (0–100), no AI. Mirrors src/utils/qcThresholdComparison.ts */

function normalizeLoose(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokenSet(value) {
  return normalizeLoose(value).split(' ').filter(Boolean)
}

/**
 * @param {string} source
 * @param {string} target
 * @returns {number}
 */
export function titleSimilarityPercent(source, target) {
  const a = tokenSet(source)
  const b = tokenSet(target)
  if (a.length === 0 && b.length === 0) return 100
  if (a.length === 0 || b.length === 0) return 0
  const setB = new Set(b)
  const matches = a.filter((w) => setB.has(w)).length
  return Math.round((matches / Math.max(a.length, b.length)) * 100)
}

/** Lenient overlap for short vendor vs long Amazon titles (core words in longer text). */
export function titleCoreWordOverlapPercent(source, target) {
  const words = (title) =>
    normalizeLoose(title)
      .split(' ')
      .filter((w) => w.length > 2 || /^\d+$/.test(w))

  const a = words(source)
  const b = words(target)
  if (a.length === 0 && b.length === 0) return 100
  if (a.length === 0 || b.length === 0) return 0

  const shorter = a.length <= b.length ? a : b
  const longerText = normalizeLoose(a.length <= b.length ? target : source)
  let hits = 0
  for (const w of shorter) {
    if (longerText.includes(w)) {
      hits++
      continue
    }
    if (w === 'on' && longerText.includes('ons')) hits++
    else if (w === 'ons' && /\bon\b/.test(longerText)) hits++
    else if (w === 'slim' && longerText.includes('slimline')) hits++
    else if (w === 'line' && longerText.includes('slimline')) hits++
  }
  return Math.round((hits / shorter.length) * 100)
}

export function bestTitleLexicalScorePercent(source, target) {
  return Math.max(titleSimilarityPercent(source, target), titleCoreWordOverlapPercent(source, target))
}

/**
 * Prefer AI score; when AI is missing or clearly too harsh vs lexical core match, use lexical.
 * @param {number | null} aiScore
 * @param {string} vendorTitle
 * @param {string} amazonTitle
 * @param {number} threshold
 */
export function resolveTitleQcScore(aiScore, vendorTitle, amazonTitle, threshold) {
  const lexical = bestTitleLexicalScorePercent(vendorTitle, amazonTitle)
  if (aiScore == null || !Number.isFinite(aiScore)) return lexical
  if (lexical >= TITLE_LEXICAL_HIGH && aiScore < threshold) return Math.max(aiScore, lexical)
  return aiScore
}

export const TITLE_LEXICAL_HIGH = 85
export const TITLE_LEXICAL_LOW = 40
