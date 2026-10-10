import { getDecryptedValues } from '../credentialsStore.mjs'
import { fetchLwaAccessToken } from './lwaToken.mjs'
import { buildSpApiGetRequest } from './spApiSign.mjs'
import { normalizeAmazonListing } from './normalizeAmazonListing.mjs'
import {
  DEFAULT_MARKETPLACE_ID,
  SP_API_ALL_KEYS,
  SP_API_HOST,
} from './spApiCredentialKeys.mjs'

const ASIN_RE = /^B[0-9A-Z]{9}$/i

/**
 * @param {string} asin
 * @returns {Promise<{ ok: true, extract: import('./normalizeAmazonListing.mjs').AmazonListingExtract } | { ok: false, kind: string, error: string }>}
 */
export async function fetchAmazonListingByAsin(asin) {
  const normalizedAsin = String(asin ?? '').trim().toUpperCase()
  if (!ASIN_RE.test(normalizedAsin)) {
    return { ok: false, kind: 'parse', error: `Invalid ASIN: ${asin}` }
  }

  const values = await getDecryptedValues(SP_API_ALL_KEYS)
  if (
    !String(values.SP_API_CLIENT_ID ?? '').trim() ||
    !String(values.SP_API_CLIENT_SECRET ?? '').trim() ||
    !String(values.SP_API_REFRESH_TOKEN ?? '').trim()
  ) {
    return {
      ok: false,
      kind: 'credentials',
      error: 'Save Amazon SP-API Client ID, Client Secret, and Refresh Token on the Credentials page.',
    }
  }

  const lwa = await fetchLwaAccessToken({
    clientId: values.SP_API_CLIENT_ID,
    clientSecret: values.SP_API_CLIENT_SECRET,
    refreshToken: values.SP_API_REFRESH_TOKEN,
  })
  if (!lwa.ok) {
    return { ok: false, kind: 'credentials', error: lwa.error }
  }

  const marketplaceId = DEFAULT_MARKETPLACE_ID
  const query = new URLSearchParams({
    marketplaceIds: marketplaceId,
    includedData: 'summaries,images,attributes,identifiers',
  }).toString()

  const path = `/catalog/2022-04-01/items/${encodeURIComponent(normalizedAsin)}`
  const request = buildSpApiGetRequest({
    host: SP_API_HOST,
    path,
    query,
    accessToken: lwa.accessToken,
  })

  const res = await fetch(request.url, { method: 'GET', headers: request.headers })
  const text = await res.text()

  if (!res.ok) {
    let detail = text.slice(0, 240)
    try {
      const json = JSON.parse(text)
      detail = json?.errors?.[0]?.message ?? json?.message ?? detail
    } catch {
      /* use raw snippet */
    }
    return {
      ok: false,
      kind: res.status === 403 || res.status === 401 ? 'credentials' : 'network',
      error: `Amazon catalog request failed (HTTP ${res.status}): ${detail}`,
    }
  }

  let catalogJson
  try {
    catalogJson = JSON.parse(text)
  } catch {
    return { ok: false, kind: 'parse', error: 'Amazon catalog response was not valid JSON.' }
  }

  const extract = normalizeAmazonListing(normalizedAsin, marketplaceId, catalogJson)
  return { ok: true, extract }
}
