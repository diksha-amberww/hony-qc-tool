const ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'

const BASE_HEADERS = {
  accept: ACCEPT,
  'accept-language': 'en-US,en;q=0.9',
  'upgrade-insecure-requests': '1',
}

/** Request profiles mirrored from HTML/request.js, request2.js, request3.js */
export const HONEYS_REQUEST_PROFILES = [
  {
    id: 'request1',
    url: 'https://www.honeysplace.com/product/2539/crystal-jellies-anal-starter-clear-dj0284-02',
    referrer:
      'https://www.honeysplace.com/advance-search/782421509408?items%5Bquery%5D=782421509408',
    headers: { ...BASE_HEADERS },
  },
  {
    id: 'request2',
    url: 'https://www.honeysplace.com/product/12658/pjur-woman-silicone-34-fl-oz-100ml-pj-swf19041',
    referrer:
      'https://www.honeysplace.com/advance-search/PJ-SWF19041?items%5Bquery%5D=PJ-SWF19041',
    headers: {
      ...BASE_HEADERS,
      'cache-control': 'max-age=0',
    },
  },
  {
    id: 'request3',
    url: 'https://www.honeysplace.com/product/5059/gun-oil-silicone-lubricant-2-oz-go-2',
    referrer: 'https://www.honeysplace.com/advance-search/GO-2?items%5Bquery%5D=GO-2',
    headers: { ...BASE_HEADERS },
  },
]

/**
 * @param {{ referrer?: string, headers?: Record<string, string> }} profile
 */
export function profileFetchHeaders(profile) {
  const headers = { ...(profile.headers ?? {}) }
  if (profile.referrer) headers.referer = profile.referrer
  return headers
}
