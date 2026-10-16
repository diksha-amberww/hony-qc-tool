import fs from 'node:fs/promises'
import { applyJarCookiesToHeaders, HoneysCookieJar } from '../electron/vendor/honeysCookieJar.mjs'
import { honeysSessionFilePath } from '../electron/vendor/honeysUserDataPath.mjs'
import { shouldWaitForSessionRecovery } from './parseHoneysProductCheerio.mjs'

const BROWSER_HEADERS = {
  'accept-language': 'en-US,en;q=0.9',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}

const SESSION_WAIT_MESSAGE =
  '⚠️ Session expired! Please log in via the Honey QC Desktop App. Waiting for new session...'

const DEFAULT_SESSION_POLL_MS = 2_000

/** @type {{ jar: HoneysCookieJar, savedAt: number, portalUrl: string, email: string, mtimeMs: number } | null} */
let cachedSession = null

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function sessionFileMtimeMs() {
  const sessionPath = honeysSessionFilePath()
  try {
    const stat = await fs.stat(sessionPath)
    return stat.mtimeMs
  } catch {
    return 0
  }
}

export function clearHoneysSessionCache() {
  cachedSession = null
}

/**
 * @returns {Promise<{ jar: HoneysCookieJar, savedAt: number, portalUrl: string, email: string }>}
 */
export async function loadHoneysSessionJar() {
  const sessionPath = honeysSessionFilePath()
  let raw
  try {
    raw = await fs.readFile(sessionPath, 'utf8')
  } catch {
    throw new Error(
      `Honey's session not found at ${sessionPath}. Log in via the desktop app first.`,
    )
  }

  let data
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error(`Invalid session file: ${sessionPath}`)
  }

  if (!data?.cookies) {
    throw new Error(
      `Session file has no cookies. Log in via the desktop app first (${sessionPath}).`,
    )
  }

  return {
    jar: HoneysCookieJar.fromJSON(data.cookies),
    savedAt: Number(data.savedAt) || 0,
    portalUrl: String(data.portalUrl ?? 'https://www.honeysplace.com'),
    email: String(data.email ?? ''),
  }
}

/**
 * @param {boolean} [forceReload]
 */
async function getActiveSession(forceReload = false) {
  const mtimeMs = await sessionFileMtimeMs()
  if (
    !forceReload &&
    cachedSession &&
    cachedSession.mtimeMs === mtimeMs &&
    cachedSession.jar
  ) {
    return cachedSession
  }

  const loaded = await loadHoneysSessionJar()
  cachedSession = { ...loaded, mtimeMs }
  return cachedSession
}

/**
 * Block until honeys-portal-session.json is updated (user logged in via desktop app).
 * @param {number} sinceMtimeMs
 * @param {{ pollIntervalMs?: number }} [options]
 */
export async function waitForSessionFileRenewal(sinceMtimeMs, options = {}) {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_SESSION_POLL_MS

  while (true) {
    await sleep(pollIntervalMs)
    try {
      const stat = await fs.stat(honeysSessionFilePath())
      if (stat.mtimeMs > sinceMtimeMs) {
        return stat.mtimeMs
      }
    } catch {
      /* file missing or unreadable — keep polling */
    }
  }
}

/**
 * @param {HoneysCookieJar} jar
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number }} [options]
 */
export async function fetchWithHoneysJar(jar, url, options = {}) {
  let requestJar = jar
  if (options.useSessionFile !== false) {
    try {
      const session = await loadHoneysSessionJar()
      requestJar = session.jar
    } catch {
      /* use caller jar */
    }
  }

  const headers = {
    ...BROWSER_HEADERS,
    ...(options.headers ?? {}),
  }
  const cookies = applyJarCookiesToHeaders(headers, requestJar, url)
  console.log('Sending cookies for search:', cookies ? 'YES' : 'NO')

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
    requestJar.ingest(res, url)
    return res
  } finally {
    clearTimeout(timer)
  }
}

/**
 * GET with automatic pause/retry when the portal session expires mid-run.
 * Polls honeys-portal-session.json until the user logs in again via the desktop app.
 *
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number, headers?: Record<string, string> }} [options]
 * @returns {Promise<{ response: Response, html: string }>}
 */
export async function fetchWithSessionRecovery(url, options = {}) {
  let lastKnownMtime = await sessionFileMtimeMs()

  while (true) {
    const session = await getActiveSession()
    const res = await fetchWithHoneysJar(session.jar, url, options)
    const html = await res.text()

    if (!shouldWaitForSessionRecovery(html, res)) {
      return { response: res, html }
    }

    console.error(SESSION_WAIT_MESSAGE)
    lastKnownMtime = await waitForSessionFileRenewal(lastKnownMtime)
    clearHoneysSessionCache()
    await getActiveSession(true)
  }
}

/**
 * @param {string} url
 * @param {Record<string, string>} [profileHeaders]
 */
/** @deprecated Prefer fetchWithSessionRecovery — returns { response, html }. */
export async function honeysAuthenticatedGet(url, profileHeaders = {}) {
  return fetchWithSessionRecovery(url, {
    method: 'GET',
    headers: { ...profileHeaders },
  })
}
