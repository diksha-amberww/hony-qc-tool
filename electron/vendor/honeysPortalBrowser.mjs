import { BrowserWindow, session as electronSession } from 'electron'
import { syncHoneysJarToElectronSession } from './honeysCookieJar.mjs'
import { isHoneysAuthOrBlockPage } from './honeysPlaceParse.mjs'
import {
  HoneysPortalSessionExpiredError,
  isHoneysLoginNavigationUrl,
} from './honeysPortalSessionSignals.mjs'

export const HONEYS_PORTAL_PARTITION = 'honeys-portal-persist'

async function clearOriginBrowserData(sess, origin) {
  const base = String(origin ?? '').replace(/\/+$/, '')
  if (!sess || !base) return
  await sess.clearStorageData({ origin: base })
  await sess.clearCache()
  const cookies = await sess.cookies.get({ url: `${base}/` })
  for (const cookie of cookies) {
    const url = `${base}${cookie.path || '/'}`
    try {
      await sess.cookies.remove(url, cookie.name)
    } catch {
      // ignore per-cookie removal errors
    }
  }
}

/** Clear cookies/storage for the shared portal browser partition (used during session reset). */
export async function clearHoneysPortalPersistPartition(origin) {
  const sess = electronSession.fromPartition(HONEYS_PORTAL_PARTITION)
  await clearOriginBrowserData(sess, origin)
}

const NAVIGATION_TIMEOUT_MS = 90_000
const NETWORK_IDLE_MS = 500

/** @type {BrowserWindow | null} */
let sharedPortalWindow = null

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * @returns {BrowserWindow | null}
 */
export function getSharedHoneysPortalBrowserWindow() {
  if (sharedPortalWindow && !sharedPortalWindow.isDestroyed()) {
    return sharedPortalWindow
  }
  return null
}

/**
 * @param {BrowserWindow | null} win
 */
export function setSharedHoneysPortalBrowserWindow(win) {
  sharedPortalWindow = win
}

/**
 * @param {{ headless?: boolean, log?: (msg: string) => void }} opts
 */
export async function acquireHoneysPortalBrowserWindow(opts = {}) {
  const existing = getSharedHoneysPortalBrowserWindow()
  if (existing) {
    opts.log?.('Reusing logged-in Honey\'s Place browser window for Livewire navigation.')
    return existing
  }

  const headless = opts.headless !== false
  opts.log?.(
    headless
      ? 'Opening headless Electron browser for Livewire-rendered pages.'
      : 'Opening visible Electron browser for Livewire-rendered pages.',
  )

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: !headless,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: HONEYS_PORTAL_PARTITION,
      backgroundThrottling: false,
    },
  })

  setSharedHoneysPortalBrowserWindow(win)
  return win
}

/**
 * @param {{ headless?: boolean, log?: (msg: string) => void }} [opts]
 */
export function releaseHoneysPortalBrowserWindow(opts = {}) {
  const win = getSharedHoneysPortalBrowserWindow()
  if (!win) return
  if (opts.headless === false) {
    opts.log?.('Visible browser left open for inspection.')
    return
  }
  if (!win.isDestroyed()) win.close()
  setSharedHoneysPortalBrowserWindow(null)
}

/**
 * @param {import('electron').WebContents} webContents
 * @param {string} url
 * @param {{ timeoutMs?: number, idleMs?: number }} [opts]
 */
export async function gotoAndWaitForNetworkIdle(webContents, url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? NAVIGATION_TIMEOUT_MS
  const idleMs = opts.idleMs ?? NETWORK_IDLE_MS
  const deadline = Date.now() + timeoutMs
  const monitorLogout = opts.monitorLogout !== false

  return new Promise((resolve, reject) => {
    if (webContents.isDestroyed()) {
      reject(new Error('Browser window was closed before navigation completed.'))
      return
    }

    /** @type {ReturnType<typeof setTimeout> | null} */
    let idleTimer = null

    const rejectLogout = (navUrl) => {
      cleanup()
      reject(
        new HoneysPortalSessionExpiredError(
          'Vendor portal session expired (redirected to login).',
          navUrl,
        ),
      )
    }

    const onNavigate = (_event, navUrl) => {
      if (!monitorLogout) return
      if (isHoneysLoginNavigationUrl(navUrl)) {
        rejectLogout(navUrl)
      }
    }

    const cleanup = () => {
      webContents.removeListener('did-start-loading', onStart)
      webContents.removeListener('did-stop-loading', onStop)
      webContents.removeListener('did-fail-load', onFail)
      webContents.removeListener('did-navigate', onNavigate)
      webContents.removeListener('did-navigate-in-page', onNavigate)
      if (idleTimer) clearTimeout(idleTimer)
    }

    const onStart = () => {
      if (idleTimer) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
    }

    const onStop = () => {
      if (Date.now() > deadline) {
        cleanup()
        reject(new Error(`Navigation timeout waiting for network idle: ${url}`))
        return
      }
      if (webContents.isLoading()) return
      idleTimer = setTimeout(() => {
        cleanup()
        resolve(webContents.getURL())
      }, idleMs)
    }

    const onFail = (_event, errorCode, errorDescription, validatedURL) => {
      cleanup()
      reject(
        new Error(
          `Navigation failed (${errorCode}): ${errorDescription || 'unknown error'} — ${validatedURL || url}`,
        ),
      )
    }

    webContents.on('did-start-loading', onStart)
    webContents.on('did-stop-loading', onStop)
    webContents.on('did-fail-load', onFail)
    if (monitorLogout) {
      webContents.on('did-navigate', onNavigate)
      webContents.on('did-navigate-in-page', onNavigate)
    }

    webContents.loadURL(url).catch((err) => {
      cleanup()
      reject(err)
    })
  })
}

/**
 * Puppeteer-style waitForSelector via executeJavaScript polling.
 * @param {import('electron').WebContents} webContents
 * @param {string} selector
 * @param {number} [timeoutMs]
 */
export async function waitForSelectorInPage(webContents, selector, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (webContents.isDestroyed()) return false
    try {
      const found = await webContents.executeJavaScript(
        `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
        true,
      )
      if (found) return true
    } catch {
      return false
    }
    await delay(250)
  }
  return false
}

/**
 * @param {import('electron').WebContents} webContents
 */
export async function getRenderedPageHtml(webContents) {
  return webContents.executeJavaScript('document.documentElement.outerHTML', true)
}

/**
 * Navigate with the shared Electron browser (Livewire renders client-side).
 *
 * @param {string} url
 * @param {{
 *   headless?: boolean
 *   log?: (msg: string) => void
 *   portalOrigin?: string
 *   waitForProductLinks?: boolean
 *   productLinkTimeoutMs?: number
 *   jar?: import('./honeysCookieJar.mjs').HoneysCookieJar
 * }} opts
 */
export async function loadHoneysPortalPageHtml(url, opts = {}) {
  const log = opts.log ?? (() => {})
  const jar = opts.jar
  if (!jar || jar.countStored() === 0) {
    throw new Error('Honey\'s Place session cookies are not available for browser navigation.')
  }

  const origin = opts.portalOrigin ?? new URL(url).origin
  const win = await acquireHoneysPortalBrowserWindow({
    headless: opts.headless,
    log,
  })
  const webContents = win.webContents

  await syncHoneysJarToElectronSession(jar, webContents.session, origin)
  const names = jar.cookieNamesForUrl(url)
  log(
    `DEBUG: Browser navigation — synced ${jar.countStored()} stored cookie(s); ${names.length} attached for URL (${names.join(', ') || 'none'})`,
  )

  log(`Browser navigate: ${url}`)
  const finalUrl = await gotoAndWaitForNetworkIdle(webContents, url, { monitorLogout: true })
  log(`Browser navigation settled (network idle): ${finalUrl}`)

  if (isHoneysLoginNavigationUrl(finalUrl)) {
    throw new HoneysPortalSessionExpiredError(
      'Vendor portal session expired (login page loaded).',
      finalUrl,
    )
  }

  if (opts.waitForProductLinks) {
    log('Waiting for Livewire to render product links (a[href*="/product/"])…')
    const found = await waitForSelectorInPage(
      webContents,
      'a[href*="/product/"]',
      opts.productLinkTimeoutMs ?? 15_000,
    )
    if (!found) {
      log('Product link selector timed out — using current DOM snapshot anyway.')
    } else {
      log('Product links detected in rendered DOM.')
    }
  }

  const html = await getRenderedPageHtml(webContents)
  const settledUrl = webContents.getURL() || finalUrl
  if (isHoneysLoginNavigationUrl(settledUrl)) {
    throw new HoneysPortalSessionExpiredError(
      'Vendor portal session expired (login page detected after render).',
      settledUrl,
    )
  }
  if (isHoneysAuthOrBlockPage(html)) {
    throw new HoneysPortalSessionExpiredError(
      'Vendor session expired or blocked (auth page in rendered DOM).',
      settledUrl,
    )
  }

  return { html, finalUrl: settledUrl }
}

/**
 * Register a BrowserWindow from login so scrape can reuse it without reopening.
 * @param {BrowserWindow} win
 */
export function adoptHoneysPortalBrowserWindow(win) {
  if (win && !win.isDestroyed()) {
    setSharedHoneysPortalBrowserWindow(win)
  }
}
