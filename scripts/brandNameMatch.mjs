/** Weak suffix tokens stripped before token-subset brand matching. */
const WEAK_BRAND_TOKENS = new Set([
  'inc',
  'llc',
  'ltd',
  'co',
  'corp',
  'company',
  'labs',
  'lab',
  'laboratory',
  'laboratories',
  'technology',
  'technologies',
  'tech',
  'group',
  'international',
  'intl',
])

function isEmptyBrand(value) {
  const s = String(value ?? '').trim()
  if (!s || s === '—') return true
  return false
}

/**
 * Normalize brand for comparison only: lowercase, dotted initials glued, punctuation → spaces.
 * @param {string} value
 * @returns {{ spaced: string, compact: string }}
 */
function normalizeBrandForCompare(value) {
  let s = String(value ?? '').toLowerCase()
  // Glue dotted initials: M.D. → md
  s = s.replace(/\b([a-z](?:\.[a-z])+)\.?\b/g, (_, seq) => seq.replace(/\./g, ''))
  s = s.replace(/[^a-z0-9]+/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  const compact = s.replace(/\s+/g, '')
  return { spaced: s, compact }
}

function meaningfulTokens(spaced) {
  const tokens = spaced.split(' ').filter(Boolean)
  const filtered = tokens.filter((t) => !WEAK_BRAND_TOKENS.has(t))
  return filtered.length > 0 ? filtered : tokens
}

/**
 * Comparison-only brand match. Does not modify or return rewritten brand strings.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function brandNamesMatch(a, b) {
  if (isEmptyBrand(a) || isEmptyBrand(b)) return false

  const left = normalizeBrandForCompare(a)
  const right = normalizeBrandForCompare(b)
  if (!left.spaced || !right.spaced) return false

  if (left.spaced === right.spaced || left.compact === right.compact) return true

  const [shorter, longer] =
    left.spaced.length <= right.spaced.length
      ? [left, right]
      : [right, left]

  if (shorter.spaced.length > 0) {
    if (longer.spaced.includes(shorter.spaced)) return true
    if (shorter.compact.length > 0 && longer.compact.includes(shorter.compact)) return true
  }

  const shortTokens = meaningfulTokens(shorter.spaced)
  const longTokenSet = new Set(meaningfulTokens(longer.spaced))
  if (
    shortTokens.length >= 2 &&
    shortTokens.every((t) => longTokenSet.has(t))
  ) {
    return true
  }

  return false
}
