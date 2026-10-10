import { ipcMain } from 'electron'
import { pushAppLog } from './mainProcessLog.mjs'
import {
  ensureHoneysPortalSession,
  formatPortalLoginSuccessMessage,
} from './vendor/honeysPlaceSession.mjs'

export function registerVendorSessionIpc() {
  ipcMain.handle('vendorSession:login', async (event, payload) => {
    if (payload?.vendorLoginRequired === false) {
      return { ok: true, skipped: true }
    }

    const batchLabel = payload?.batchLabel
    const push = (message, category = 'LOGIN') => {
      pushAppLog(event.sender, { category, message, batchLabel })
    }

    push('Vendor login started', 'LOGIN')
    const headless =
      typeof payload?.headless === 'boolean' ? payload.headless : true
    push(
      `Headless scraping: ${headless ? 'ON (background browser)' : 'OFF (visible browser)'}`,
      'LOGIN',
    )
    const result = await ensureHoneysPortalSession({
      reuseSession: payload?.reuseSession !== false,
      headless,
      onLogLine: (line) => push(line, 'LOGIN'),
    })

    if (!result.ok) {
      push(result.error ?? 'Login failed', 'ERROR')
      return { ok: false, error: result.error ?? 'Vendor login failed.' }
    }

    push(
      result.reused
        ? `Reused saved Honey's Place session. ${formatPortalLoginSuccessMessage(result.accountNumber)}`
        : formatPortalLoginSuccessMessage(result.accountNumber),
      'LOGIN SUCCESSFUL',
    )
    return { ok: true }
  })
}
