const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const VISION_MAX_EDGE = 512
const VISION_JPEG_QUALITY = 80
const FETCH_TIMEOUT_MS = 25_000

/** Chrome-like UA for CDN hotlink checks (Amazon, vendor sites). */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const IMAGE_ACCEPT =
  'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'

/**
 * Prefer smaller Amazon catalog image URLs when pattern is recognized.
 * @param {string} url
 */
export function preferCatalogImageUrl(url) {
  const s = String(url ?? '').trim()
  if (!s) return s
  if (/media-amazon\.com/i.test(s) || /images-amazon\.com/i.test(s)) {
    if (/_SL\d+_/i.test(s)) {
      return s.replace(/_SL\d+_/gi, '_SL512_')
    }
    if (/\._AC_/i.test(s)) {
      return s.replace(/\._AC_[^.]+/i, '._AC_SL512_')
    }
  }
  return s
}

/**
 * @param {string} url
 * @returns {string | undefined}
 */
function refererForImageUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.includes('amazon.') || host.includes('media-amazon') || host.includes('images-amazon')) {
      return 'https://www.amazon.com/'
    }
    if (host.includes('honeysplace.com')) {
      return 'https://www.honeysplace.com/'
    }
    return `${new URL(url).origin}/`
  } catch {
    return undefined
  }
}

/**
 * Browser-like headers for image GETs (bot protection on Amazon / vendor CDNs).
 * @param {string} url
 */
export function imageFetchHeaders(url) {
  const referer = refererForImageUrl(url)
  const headers = {
    accept: IMAGE_ACCEPT,
    'accept-language': 'en-US,en;q=0.9',
    'user-agent': BROWSER_USER_AGENT,
    'sec-fetch-dest': 'image',
    'sec-fetch-mode': 'no-cors',
    'sec-fetch-site': 'cross-site',
  }
  if (referer) headers.referer = referer
  return headers
}

/**
 * @param {string} label
 * @param {object} detail
 */
function logImageFetchDebug(label, detail) {
  const parts = Object.entries(detail)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
  console.log(`🖼️ IMAGE FETCH DEBUG [${label}] ${parts}`)
}

/**
 * @param {string} url
 * @returns {Promise<{ buf: Buffer, status: number } | null>}
 */
async function downloadImageBuffer(url) {
  const trimmed = url?.trim()
  if (!trimmed) return null
  let res
  try {
    res = await fetch(trimmed, {
      headers: imageFetchHeaders(trimmed),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logImageFetchDebug('download', { url: trimmed.slice(0, 120), error: msg })
    return null
  }
  if (!res.ok) {
    logImageFetchDebug('download', {
      url: trimmed.slice(0, 120),
      status: res.status,
      ok: false,
    })
    return null
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_IMAGE_BYTES) {
    logImageFetchDebug('download', {
      url: trimmed.slice(0, 120),
      rejected: 'oversize',
      bytes: buf.length,
      max: MAX_IMAGE_BYTES,
    })
    return null
  }
  return { buf, status: res.status }
}

/**
 * @param {Buffer} buf
 * @returns {Promise<{ mediaType: string, data: string, resizedBytes: number } | null>}
 */
async function resizeForVision(buf) {
  try {
    const sharp = (await import('sharp')).default
    const out = await sharp(buf)
      .rotate()
      .resize({
        width: VISION_MAX_EDGE,
        height: VISION_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: VISION_JPEG_QUALITY, mozjpeg: true })
      .toBuffer()
    return { mediaType: 'image/jpeg', data: out.toString('base64'), resizedBytes: out.length }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logImageFetchDebug('resize', { error: msg })
    return null
  }
}

/**
 * Download, downscale with sharp, return base64 for Anthropic vision only (no full-size fallback).
 * @param {string} url
 * @param {{ debugLabel?: string }} [options]
 * @returns {Promise<{ mediaType: string, data: string } | null>}
 */
export async function prepareVisionImage(url, options = {}) {
  const normalized = preferCatalogImageUrl(url)
  const label = options.debugLabel ?? 'vision'
  const downloaded = await downloadImageBuffer(normalized)
  if (!downloaded) return null

  const { buf, status } = downloaded
  const resized = await resizeForVision(buf)
  if (!resized) {
    logImageFetchDebug(label, {
      url: normalized.slice(0, 120),
      downloadBytes: buf.length,
      resize: 'failed',
    })
    return null
  }

  const base64Len = resized.data.length
  logImageFetchDebug(label, {
    url: normalized.slice(0, 120),
    httpStatus: status,
    downloadBytes: buf.length,
    resizedBytes: resized.resizedBytes,
    base64Chars: base64Len,
  })

  return { mediaType: resized.mediaType, data: resized.data }
}
