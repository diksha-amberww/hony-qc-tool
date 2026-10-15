import { cleanProductImageUrl, extractImageUrlFromText } from './cleanImageUrl'

/**
 * Deterministic demo image URLs that actually load in the browser.
 * Seeded so the same SKU/ASIN always maps to the same photo.
 */
export function demoProductImageUrl(seed: string, variant: 'vendor' | 'amazon' | 'alt' = 'vendor'): string {
  const safe = encodeURIComponent(`${variant}-${seed}`.replace(/\s+/g, '-').toLowerCase())
  return `https://picsum.photos/seed/${safe}/240/240`
}

/** Pull image URLs from a QcResult (top-level fields or an `image` comparison row). */
export function resolveQcImageUrls(result: {
  sourceImageUrl?: string
  targetImageUrl?: string
  comparisons?: Array<{ key: string; sourceValue: string; targetValue: string }>
}): { sourceUrl?: string; targetUrl?: string } {
  const sourceFromTop = cleanProductImageUrl(result.sourceImageUrl)
  const targetFromTop = cleanProductImageUrl(result.targetImageUrl)
  if (sourceFromTop || targetFromTop) {
    return {
      sourceUrl: sourceFromTop || undefined,
      targetUrl: targetFromTop || undefined,
    }
  }
  const imageField = result.comparisons?.find((c) => c.key === 'image')
  if (imageField) {
    return {
      sourceUrl: extractImageUrlFromText(imageField.sourceValue) || undefined,
      targetUrl: extractImageUrlFromText(imageField.targetValue) || undefined,
    }
  }
  return {}
}
