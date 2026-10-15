function parseSetCookie(setCookie, requestUrl) {
  const parts = setCookie.split(';').map((p) => p.trim())
  const [nameValue, ...attrs] = parts
  const eq = nameValue.indexOf('=')
  if (eq <= 0) return null
  const name = nameValue.slice(0, eq).trim()
  const value = nameValue.slice(eq + 1).trim()
  if (!name) return null

  let domain = ''
  let path = '/'
  let expires = null
  let maxAge = null
  let secure = false
  let httpOnly = false

  for (const attr of attrs) {
    const lower = attr.toLowerCase()
    if (lower.startsWith('domain=')) domain = attr.slice(7).trim()
    else if (lower.startsWith('path=')) path = attr.slice(5).trim() || '/'
    else if (lower.startsWith('expires=')) expires = new Date(attr.slice(8).trim())
    else if (lower.startsWith('max-age=')) maxAge = Number.parseInt(attr.slice(8).trim(), 10)
    else if (lower === 'secure') secure = true
    else if (lower === 'httponly') httpOnly = true
  }

  const host = new URL(requestUrl).hostname
  if (!domain) domain = host
  if (domain.startsWith('.')) domain = domain.slice(1)

  return { name, value, domain, path, expires, maxAge, secure, httpOnly, host }
}

function hostMatches(cookieDomain, host) {
  const d = cookieDomain.toLowerCase()
  const h = host.toLowerCase()
  return h === d || h.endsWith(`.${d}`)
}

function cookiePathMatches(cookiePath, requestPath) {
  const cp = (cookiePath || '/').trim() || '/'
  if (cp === '/') return true
  if (!requestPath.startsWith(cp)) return false
  if (cp.endsWith('/')) return true
  if (requestPath.length === cp.length) return true
  return requestPath.charAt(cp.length) === '/'
}

/**
 * @param {Record<string, string>} headers
 * @param {HoneysCookieJar} jar
 * @param {string} url
 * @returns {string}
 */
/**
 * Copy persisted session cookies into an Electron session partition for BrowserWindow navigation.
 * @param {HoneysCookieJar} jar
 * @param {import('electron').Session} electronSession
 * @param {string} origin
 */
/**
 * Copy cookies from an Electron session partition back into the in-memory jar (after Livewire navigation).
 * @param {HoneysCookieJar} jar
 * @param {import('electron').Session} electronSession
 * @param {string} origin
 */
export async function syncElectronSessionToHoneysJar(jar, electronSession, origin) {
  if (!jar || !electronSession) return
  const base = String(origin ?? '').replace(/\/+$/, '')
  if (!base) return
  let cookies = []
  try {
    cookies = await electronSession.cookies.get({ url: `${base}/` })
  } catch {
    return
  }
  for (const cookie of cookies) {
    jar.ingestElectronCookie(cookie)
  }
}

export async function syncHoneysJarToElectronSession(jar, electronSession, origin) {
  if (!jar || !electronSession) return
  const base = String(origin ?? '').replace(/\/+$/, '')
  if (!base) return

  for (const cookie of Object.values(jar.cookies)) {
    if (!cookie?.name) continue
    const path = cookie.path || '/'
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
    const details = {
      url,
      name: cookie.name,
      value: cookie.value ?? '',
      path: cookie.path || '/',
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly),
    }
    if (cookie.domain) {
      details.domain = cookie.domain.startsWith('.') ? cookie.domain : `.${cookie.domain}`
    }
    if (cookie.expires instanceof Date && Number.isFinite(cookie.expires.getTime())) {
      details.expirationDate = cookie.expires.getTime() / 1000
    }
    try {
      await electronSession.cookies.set(details)
    } catch {
      try {
        await electronSession.cookies.set({ ...details, domain: cookie.domain })
      } catch {
        // skip individual cookie failures
      }
    }
  }
}

export function applyJarCookiesToHeaders(headers, jar, url) {
  const cookieHeader = jar.headerFor(url)
  if (cookieHeader) {
    headers.Cookie = cookieHeader
    headers.cookie = cookieHeader
  }
  return cookieHeader
}

export class HoneysCookieJar {
  /** @param {Record<string, { name: string, value: string, domain: string, path: string, expires?: string | null, maxAge?: number | null, secure?: boolean, httpOnly?: boolean }>} [seed] */
  constructor(seed = {}) {
    this.cookies = { ...seed }
  }

  ingest(response, requestUrl) {
    const raw =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : []
    if (raw.length === 0) {
      const single = response.headers.get('set-cookie')
      if (single) raw.push(single)
    }
    for (const line of raw) {
      const parsed = parseSetCookie(line, requestUrl)
      if (!parsed) continue
      const key = `${parsed.domain}|${parsed.path}|${parsed.name}`
      if (parsed.maxAge === 0 || parsed.value === '') {
        delete this.cookies[key]
        continue
      }
      this.cookies[key] = parsed
    }
  }

  /** Total cookies stored in the jar (before URL/path filtering). */
  countStored() {
    return Object.keys(this.cookies).length
  }

  /**
   * Cookies that would be sent on a request to `url`.
   * @param {string} url
   */
  countForUrl(url) {
    return this.cookieNamesForUrl(url).length
  }

  /**
   * Cookie names that would be sent on a request to `url` (values are not logged).
   * @param {string} url
   * @returns {string[]}
   */
  cookieNamesForUrl(url) {
    const header = this.headerFor(url)
    if (!header) return []
    return header
      .split(';')
      .map((part) => {
        const trimmed = part.trim()
        const eq = trimmed.indexOf('=')
        return eq > 0 ? trimmed.slice(0, eq) : trimmed
      })
      .filter(Boolean)
  }

  headerFor(url) {
    const { hostname, protocol, pathname } = new URL(url)
    const secure = protocol === 'https:'
    const now = Date.now()
    const pairs = []

    for (const [key, cookie] of Object.entries(this.cookies)) {
      if (!cookie?.name) {
        delete this.cookies[key]
        continue
      }
      if (cookie.expires && Number.isFinite(cookie.expires.getTime()) && cookie.expires.getTime() < now) {
        delete this.cookies[key]
        continue
      }
      if (cookie.maxAge != null && cookie.maxAge <= 0) {
        delete this.cookies[key]
        continue
      }
      if (!hostMatches(cookie.domain, hostname)) continue
      if (!cookiePathMatches(cookie.path, pathname)) continue
      if (cookie.secure && !secure) continue
      pairs.push(`${cookie.name}=${cookie.value}`)
    }

    return pairs.join('; ')
  }

  toJSON() {
    const out = {}
    for (const [key, cookie] of Object.entries(this.cookies)) {
      out[key] = {
        ...cookie,
        expires: cookie.expires instanceof Date ? cookie.expires.toISOString() : cookie.expires ?? null,
      }
    }
    return out
  }

  /** @param {import('electron').Cookie} cookie */
  ingestElectronCookie(cookie) {
    if (!cookie?.name) return
    const domain = (cookie.domain ?? '').replace(/^\./, '')
    const path = cookie.path || '/'
    const key = `${domain}|${path}|${cookie.name}`
    this.cookies[key] = {
      name: cookie.name,
      value: cookie.value ?? '',
      domain,
      path,
      expires: cookie.expirationDate ? new Date(cookie.expirationDate * 1000) : null,
      maxAge: null,
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly),
    }
  }

  static fromJSON(data) {
    if (!data || typeof data !== 'object') return new HoneysCookieJar()
    const seed = {}
    for (const [key, cookie] of Object.entries(data)) {
      if (!cookie || typeof cookie !== 'object') continue
      seed[key] = {
        ...cookie,
        expires: cookie.expires ? new Date(cookie.expires) : null,
      }
    }
    return new HoneysCookieJar(seed)
  }
}
