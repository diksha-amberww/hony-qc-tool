/**
 * Thrown when the vendor portal redirects to login or renders an auth wall mid-scrape.
 */
export class HoneysPortalSessionExpiredError extends Error {
  constructor(message, finalUrl = '') {
    super(message)
    this.name = 'HoneysPortalSessionExpiredError'
    this.kind = 'authentication'
    this.finalUrl = finalUrl
  }
}

/**
 * @param {string} url
 */
export function isHoneysLoginNavigationUrl(url) {
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, '').toLowerCase()
    if (pathname === '/login' || pathname.endsWith('/login')) return true
    if (pathname.includes('/choose-account')) return true
    return false
  } catch {
    return false
  }
}
