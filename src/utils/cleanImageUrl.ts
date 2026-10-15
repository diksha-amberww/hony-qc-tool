/**
 * Normalize product image URLs from SP-API, JSON, or comparison cells.
 */
export function cleanProductImageUrl(raw: unknown): string {
  if (raw == null) return ''
  let s = String(raw).trim()
  if (!s) return ''

  s = s.replace(/^['"`]+|['"`]+$/g, '')
  s = s.replace(/\s+/g, '')

  const scoreSuffix = s.match(/^(.+?)\s*\(score\s+\d+\)\s*$/i)
  if (scoreSuffix?.[1]) {
    s = scoreSuffix[1].trim()
  }

  if (!/^https?:\/\//i.test(s)) return ''

  try {
    return new URL(s).href
  } catch {
    return ''
  }
}

/** First http(s) URL in a comparison cell (e.g. URL + AI score suffix). */
export function extractImageUrlFromText(value: string): string {
  const cleaned = cleanProductImageUrl(value)
  if (cleaned) return cleaned
  const match = String(value ?? '').match(/https?:\/\/[^\s)'"]+/i)
  return match?.[0] ? cleanProductImageUrl(match[0]) : ''
}
