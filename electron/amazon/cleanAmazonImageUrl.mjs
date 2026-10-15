/**
 * @param {unknown} raw
 * @returns {string}
 */
export function cleanAmazonImageUrl(raw) {
  if (raw == null) return ''
  let s = String(raw).trim()
  if (!s) return ''

  s = s.replace(/^['"`]+|['"`]+$/g, '')
  s = s.replace(/[\r\n\t]/g, '')
  s = s.replace(/\s+/g, '')

  if (!/^https?:\/\//i.test(s)) return ''

  try {
    return new URL(s).href
  } catch {
    return ''
  }
}
