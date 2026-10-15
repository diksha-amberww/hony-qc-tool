import { ipcMain } from 'electron'
import { templateScrapeFailureFromRow } from './errorEngineScrape.mjs'
import { getVendorScraper } from './vendor/scrapeRegistry.mjs'
import { pushAppLog } from './mainProcessLog.mjs'
import { clearHoneysSession, ensureHoneysPortalSession } from './vendor/honeysPlaceSession.mjs'
import { releaseHoneysPortalBrowserWindow } from './vendor/honeysPortalBrowser.mjs'

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function registerErrorEngineIpc() {
  ipcMain.handle('errorEngine:cancelSession', async (event, payload) => {
    const headless = payload?.headless !== false
    releaseHoneysPortalBrowserWindow({
      headless,
      log: (line) => pushAppLog(event.sender, { category: 'LOGIN', message: line }),
    })
    await clearHoneysSession()
    return { ok: true }
  })

  ipcMain.handle('errorEngine:relogin', async (event, payload) => {
    if (payload?.vendorLoginRequired === false) {
      return { ok: false, error: 'Relogin disabled (vendor login not required)' }
    }
    const attempt = typeof payload?.attempt === 'number' ? payload.attempt : 1
    const headless = payload?.headless !== false
    pushAppLog(event.sender, {
      category: 'LOGIN',
      message: `Vendor relogin attempt ${attempt}`,
    })
    const result = await ensureHoneysPortalSession({
      reuseSession: false,
      freshSession: true,
      clearStoredSession: attempt <= 1,
      headless,
      keepBrowserForScraping: true,
      onLogLine: (line) => pushAppLog(event.sender, { category: 'LOGIN', message: line }),
    })
    if (!result.ok) {
      pushAppLog(event.sender, {
        category: 'SESSION EXPIRED',
        message: result.error ?? 'Relogin failed',
      })
      return { ok: false, error: result.error ?? 'Relogin failed' }
    }
    pushAppLog(event.sender, { category: 'LOGIN SUCCESSFUL', message: 'Vendor relogin succeeded' })
    return { ok: true }
  })

  ipcMain.handle('errorEngine:executeScrape', async (event, payload) => {
    const row = payload?.row
    const rowIndex = typeof payload?.rowIndex === 'number' ? payload.rowIndex : 0
    if (!row || typeof row !== 'object') {
      return { ok: false, kind: 'parse', error: 'Invalid scrape payload' }
    }

    await delay(35)

    const templateErr = templateScrapeFailureFromRow(row)
    if (templateErr) {
      return { ok: false, kind: templateErr.kind, error: templateErr.message }
    }

    const sku = String(row.part_sku ?? row.sku ?? `row-${rowIndex}`)
    if (sku.toUpperCase().includes('SCRAPE_FAIL')) {
      return { ok: false, kind: 'network', error: `Network error while scraping ${sku}` }
    }

    const vendorId = typeof payload?.vendorId === 'string' ? payload.vendorId : 'honeys'
    pushAppLog(event.sender, {
      category: 'SCRAPING',
      message: `Vendor scrape started (${vendorId}) — ${sku}`,
      batchLabel: payload?.batchLabel,
    })
    const scraper = getVendorScraper(vendorId)
    const result = await scraper({
      row,
      rowIndex,
      headless: payload?.headless !== false,
      batchLabel: payload?.batchLabel,
      onLogLine: (line) =>
        pushAppLog(event.sender, {
          category: 'SCRAPING',
          message: line,
          batchLabel: payload?.batchLabel,
        }),
    })
    if (!result.ok) {
      pushAppLog(event.sender, {
        category: 'ERROR',
        message: result.error ?? 'Vendor scrape failed',
        detail: sku,
        batchLabel: payload?.batchLabel,
      })
      return { ok: false, kind: result.kind, error: result.error }
    }
    pushAppLog(event.sender, {
      category: 'SCRAPING',
      message: 'Vendor scrape completed',
      detail: sku,
      batchLabel: payload?.batchLabel,
    })
    return { ok: true, extract: result.extract }
  })
}
