import { prepareVisionImage, preferCatalogImageUrl } from './qcImagePrep.mjs'
import { IMAGE_PACKAGING_MISMATCH_MAX } from './qcVerdictCore.mjs'

const THUMB_SIZE = 64
export const IMAGE_PIXEL_NEAR_DUPLICATE_MIN = 98
/** Pixel similarity at or above this with a very low AI score → trust pixels (same catalog photo). */
export const IMAGE_PIXEL_OVERRIDES_LOW_AI_MIN = 85

/**
 * @param {number | null} pixelScore
 * @returns {number | null}
 */
export function capPixelFallbackImageScore(pixelScore) {
  if (pixelScore == null || !Number.isFinite(pixelScore)) return null
  const rounded = Math.round(pixelScore)
  if (rounded >= IMAGE_PIXEL_NEAR_DUPLICATE_MIN) return rounded
  // Keep moderate pixel similarity (e.g. same SKU, different crop). Only cap suspiciously
  // high scores below near-duplicate — not honest mid-range similarity.
  if (rounded > IMAGE_PACKAGING_MISMATCH_MAX && rounded < IMAGE_PIXEL_NEAR_DUPLICATE_MIN) {
    return IMAGE_PACKAGING_MISMATCH_MAX
  }
  return rounded
}

/**
 * Pixel similarity on downscaled greyscale thumbs (0–100). Used when vision AI refuses or returns no score.
 * @param {string} base64A
 * @param {string} base64B
 */
export async function visualSimilarityPercentFromBase64(base64A, base64B) {
  const a = String(base64A ?? '').trim()
  const b = String(base64B ?? '').trim()
  if (!a || !b) return null
  if (a === b) return 100

  try {
    const sharp = (await import('sharp')).default
    const thumb = async (data) => {
      const buf = Buffer.from(data, 'base64')
      return sharp(buf).resize(THUMB_SIZE, THUMB_SIZE, { fit: 'fill' }).greyscale().raw().toBuffer()
    }
    const [bufA, bufB] = await Promise.all([thumb(a), thumb(b)])
    if (bufA.length !== bufB.length || bufA.length === 0) return null
    let diff = 0
    for (let i = 0; i < bufA.length; i++) diff += Math.abs(bufA[i] - bufB[i])
    const maxDiff = bufA.length * 255
    const similarity = 1 - diff / maxDiff
    return Math.max(0, Math.min(100, Math.round(similarity * 100)))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[QC visual fallback]', msg)
    return null
  }
}

/**
 * @param {string} vendorImageUrl
 * @param {string} amazonImageUrl
 */
export async function visualSimilarityPercentFromUrls(vendorImageUrl, amazonImageUrl) {
  const vendorUrl = preferCatalogImageUrl(String(vendorImageUrl ?? '').trim())
  const amazonUrl = preferCatalogImageUrl(String(amazonImageUrl ?? '').trim())
  if (!vendorUrl || !amazonUrl) return null

  const vendorImg = await prepareVisionImage(vendorUrl, { debugLabel: 'fallback-vendor' })
  const amazonImg = await prepareVisionImage(amazonUrl, { debugLabel: 'fallback-amazon' })
  if (!vendorImg?.data || !amazonImg?.data) return null

  const raw = await visualSimilarityPercentFromBase64(vendorImg.data, amazonImg.data)
  return capPixelFallbackImageScore(raw)
}

/**
 * Combine Claude image score with pixel similarity on the same downloaded thumbs.
 * Prevents false 0–35 AI scores when the files are the same (or near-duplicate) catalog photo.
 *
 * @param {number | null} aiScore
 * @param {number | null} pixelRaw
 * @returns {number | null}
 */
export function mergeImageSimilarityScores(aiScore, pixelRaw) {
  const pixel =
    pixelRaw != null && Number.isFinite(pixelRaw) ? Math.round(pixelRaw) : null
  if (pixel == null) {
    return aiScore != null && Number.isFinite(aiScore) ? Math.round(aiScore) : null
  }
  if (aiScore == null || !Number.isFinite(aiScore)) {
    return capPixelFallbackImageScore(pixel)
  }
  const ai = Math.round(aiScore)
  if (pixel >= IMAGE_PIXEL_NEAR_DUPLICATE_MIN) {
    return Math.max(ai, pixel)
  }
  if (pixel >= IMAGE_PIXEL_OVERRIDES_LOW_AI_MIN && ai <= IMAGE_PACKAGING_MISMATCH_MAX) {
    return Math.max(ai, pixel)
  }
  return ai
}
