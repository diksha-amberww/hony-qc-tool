import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { getDecryptedValues } from '../credentialsStore.mjs'
import { HoneysCookieJar } from './honeysCookieJar.mjs'
import {
  loginHoneysPlaceWithBrowser,
  isChooseAccountUrl,
  isHomeUrl,
  DEFAULT_ACCOUNT_NUMBER,
  DEFAULT_CHOOSE_ACCOUNT_URL,
  DEFAULT_HOME_URL,
  DEFAULT_LOGIN_URL,
} from './honeysPlaceBrowserLogin.mjs'

const DEFAULT_PORTAL = 'https://www.honeysplace.com'
const DEFAULT_LOGIN_PATH = '/login'
const DEFAULT_CONFIRM_PATH = '/choose-account'
const DEFAULT_HOME_PATH = '/home'
const SESSION_FILE = 'honeys-portal-session.json'

const BROWSER_HEADERS = {
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}

/** @type {HoneysCookieJar | null} */
let activeJar = null

function sessionPath() {
  return path.join(app.getPath('userData'), SESSION_FILE)
}

function collapseDuplicateSlashes(url) {
  const match = url.match(/^(https?:\/\/[^/]+)(.*)$/i)
  if (!match) return url
  const tail = match[2].replace(/\/{2,}/g, '/')
  return `${match[1]}${tail}`
}

function pathnameIsLoginPage(pathname, loginSeg) {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean)
  const want = loginSeg.replace(/^\//, '').toLowerCase()
  if (parts.length === 0) return false
  return parts[parts.length - 1].toLowerCase() === want
}

function sanitizeLoginUrl(loginUrl) {
  return collapseDuplicateSlashes(loginUrl.replace(/\/login\/login\/?$/i, '/login'))
}

/**
 * Resolve portal base, login URL, and confirmation URL from user input.
 */
export function resolvePortalEndpoints(
  portalInput,
  loginPath = DEFAULT_LOGIN_PATH,
  confirmationPath = DEFAULT_CONFIRM_PATH,
) {
  const raw = String(portalInput ?? DEFAULT_PORTAL).trim()
  const fallback = new URL(DEFAULT_PORTAL)

  let parsed
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    parsed = fallback
  }

  const loginSeg = loginPath.startsWith('/') ? loginPath : `/${loginPath}`
  const confirmSeg = confirmationPath.startsWith('/') ? confirmationPath : `/${confirmationPath}`
  const homeSeg = DEFAULT_HOME_PATH
  const pathClean = parsed.pathname.replace(/\/+$/, '')
  const origin = parsed.origin

  let loginUrl
  let portalBase

  if (!pathClean || pathClean === '/') {
    portalBase = origin
    loginUrl = `${origin}${loginSeg}`
  } else if (pathnameIsLoginPage(pathClean, loginSeg)) {
    loginUrl = `${origin}${pathClean}`
    portalBase = origin
  } else {
    portalBase = `${origin}${pathClean}`
    loginUrl = `${portalBase}${loginSeg}`
  }

  loginUrl = sanitizeLoginUrl(loginUrl)
  const confirmationUrl = collapseDuplicateSlashes(`${origin}${confirmSeg}`)
  const homeUrl = collapseDuplicateSlashes(`${origin}${homeSeg}`)

  return { portalBase, loginUrl, confirmationUrl, homeUrl, origin, rawPortalUrl: raw }
}

function isConfirmationHtml(html, url, confirmationUrl) {
  if (!isChooseAccountUrl(url, confirmationUrl)) return false
  const lower = html.toLowerCase()
  return (
    lower.includes('choose-account-page') &&
    lower.includes('ca-title') &&
    lower.includes('table-choose-account')
  )
}

function isHomeHtml(html, url, homeUrl) {
  if (!isHomeUrl(url, homeUrl)) return false
  const lower = html.toLowerCase()
  return lower.includes('hp-header-root') && !lower.includes('choose-account-page')
}

export function formatPortalLoginSuccessMessage(accountNumber) {
  const acct = String(accountNumber ?? DEFAULT_ACCOUNT_NUMBER).trim() || DEFAULT_ACCOUNT_NUMBER
  return `Login successful — Account ${acct} selected, home page loaded`
}

async function loadPersistedSession() {
  try {
    const raw = await fs.readFile(sessionPath(), 'utf8')
    const data = JSON.parse(raw)
    if (!data?.cookies) return null
    return {
      jar: HoneysCookieJar.fromJSON(data.cookies),
      savedAt: Number(data.savedAt) || 0,
      portalUrl: resolvePortalEndpoints(data.portalUrl).portalBase,
      email: String(data.email ?? ''),
      ttlMinutes: Number(data.ttlMinutes) || 120,
    }
  } catch {
    return null
  }
}

async function persistSession(jar, meta) {
  const payload = {
    savedAt: meta.savedAt,
    portalUrl: meta.portalUrl,
    email: meta.email,
    ttlMinutes: meta.ttlMinutes,
    cookies: jar.toJSON(),
  }
  await fs.mkdir(path.dirname(sessionPath()), { recursive: true })
  await fs.writeFile(sessionPath(), JSON.stringify(payload, null, 2), 'utf8')
}

async function fetchWithJar(jar, url, options = {}) {
  const headers = {
    ...BROWSER_HEADERS,
    ...(options.headers ?? {}),
  }
  const cookieHeader = jar.headerFor(url)
  if (cookieHeader) headers.cookie = cookieHeader

  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 45_000
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      redirect: options.redirect ?? 'follow',
      signal: controller.signal,
    })
    jar.ingest(res, url)
    return res
  } finally {
    clearTimeout(timer)
  }
}

function makeLogger(logLine) {
  const lines = []
  const log = (message) => {
    const text = String(message)
    lines.push(text)
    logLine?.(text)
  }
  return { lines, log }
}

export async function loadPortalCredentials() {
  const values = await getDecryptedValues([
    'QC_PORTAL_URL',
    'QC_PORTAL_USERNAME',
    'QC_PORTAL_PASSWORD',
    'QC_PORTAL_ACCOUNT_NUMBER',
    'QC_PORTAL_SESSION_TTL_MIN',
  ])
  const rawPortalUrl = String(values.QC_PORTAL_URL || DEFAULT_PORTAL).trim()
  const endpoints = resolvePortalEndpoints(rawPortalUrl)
  const email = String(values.QC_PORTAL_USERNAME ?? '').trim()
  const password = String(values.QC_PORTAL_PASSWORD ?? '').trim()
  const accountNumber =
    String(values.QC_PORTAL_ACCOUNT_NUMBER ?? '').trim() || DEFAULT_ACCOUNT_NUMBER
  const ttlRaw = Number.parseInt(String(values.QC_PORTAL_SESSION_TTL_MIN ?? '').trim(), 10)
  const ttlMinutes = Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : 120
  return {
    rawPortalUrl,
    portalUrl: endpoints.portalBase,
    portalBase: endpoints.portalBase,
    loginUrl: endpoints.loginUrl || DEFAULT_LOGIN_URL,
    confirmationUrl: endpoints.confirmationUrl || DEFAULT_CHOOSE_ACCOUNT_URL,
    homeUrl: endpoints.homeUrl || DEFAULT_HOME_URL,
    origin: endpoints.origin,
    email,
    password,
    accountNumber,
    ttlMinutes,
  }
}

export function getActiveCookieJar() {
  return activeJar
}

export async function clearHoneysSession() {
  activeJar = null
  try {
    await fs.unlink(sessionPath())
  } catch {
    // no file
  }
}

/**
 * Ensure an authenticated Honey's Place session (browser login + local cookie file).
 *
 * @param {{
 *   reuseSession?: boolean
 *   headless?: boolean
 *   loginPath?: string
 *   confirmationPath?: string
 *   onLogLine?: (line: string) => void
 *   freshSession?: boolean
 *   clearStoredSession?: boolean
 *   credentials?: { rawPortalUrl?: string, portalUrl?: string, email: string, password: string, ttlMinutes?: number }
 * }} opts
 */
export async function ensureHoneysPortalSession(opts = {}) {
  const { lines, log } = makeLogger(opts.onLogLine)
  const creds = opts.credentials ?? (await loadPortalCredentials())
  const loginPath = opts.loginPath ?? DEFAULT_LOGIN_PATH
  const confirmationPath = opts.confirmationPath ?? DEFAULT_CONFIRM_PATH
  const rawPortalUrl =
    creds.rawPortalUrl ?? creds.portalUrl ?? creds.portalBase ?? DEFAULT_PORTAL
  const { portalBase, loginUrl, confirmationUrl, homeUrl } = resolvePortalEndpoints(
    rawPortalUrl,
    loginPath,
    confirmationPath,
  )
  const headless = opts.headless !== false
  const ttlMinutes = creds.ttlMinutes ?? 120
  const accountNumber =
    String(creds.accountNumber ?? '').trim() || DEFAULT_ACCOUNT_NUMBER

  if (!creds.email || !creds.password) {
    return { ok: false, error: 'Portal email and password are required.', log: lines }
  }

  if (opts.clearStoredSession) {
    log('Clearing saved Honey\'s Place session file before login.')
    await clearHoneysSession()
  }

  const reuse = opts.reuseSession !== false
  if (reuse) {
    const persisted = await loadPersistedSession()
    const ageMs = persisted ? Date.now() - persisted.savedAt : Infinity
    const ttlMs = (persisted?.ttlMinutes ?? ttlMinutes) * 60_000
    if (
      persisted &&
      resolvePortalEndpoints(persisted.portalUrl).portalBase === portalBase &&
      persisted.email === creds.email &&
      ageMs < ttlMs
    ) {
      log(`Reusing saved session (${Math.round(ageMs / 1000)}s old).`)
      try {
        const check = await fetchWithJar(persisted.jar, homeUrl, { method: 'GET' })
        const html = await check.text()
        if (check.ok && isHomeHtml(html, check.url, homeUrl)) {
          activeJar = persisted.jar
          log(formatPortalLoginSuccessMessage(accountNumber))
          return { ok: true, reused: true, log: lines, accountNumber }
        }
        log('Saved session expired or invalid — performing fresh login.')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Session validation failed.'
        log(msg)
      }
    }
  }

  const loginResult = await loginHoneysPlaceWithBrowser({
    loginUrl,
    confirmationUrl,
    homeUrl,
    accountNumber,
    email: creds.email,
    password: creds.password,
    headless,
    freshSession: opts.freshSession !== false,
    log,
  })

  if (!loginResult.ok) {
    return { ok: false, error: loginResult.error ?? 'Login failed.', log: lines }
  }

  const jar = loginResult.jar
  const savedAt = Date.now()
  activeJar = jar
  await persistSession(jar, {
    savedAt,
    portalUrl: portalBase,
    email: creds.email,
    ttlMinutes,
  })
  log('Session cookies saved locally.')
  log(formatPortalLoginSuccessMessage(accountNumber))
  return { ok: true, reused: false, log: lines, accountNumber }
}

/**
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number }} [options]
 */
export async function honeysAuthenticatedFetch(url, options = {}) {
  if (!activeJar) {
    const session = await ensureHoneysPortalSession({ reuseSession: true })
    if (!session.ok) {
      throw new Error(session.error ?? 'Not authenticated')
    }
  }
  return fetchWithJar(activeJar, url, options)
}
