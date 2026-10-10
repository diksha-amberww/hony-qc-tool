import { BrowserWindow } from 'electron'

/**
 * Push structured log lines from the Electron main process to the renderer Logs UI.
 * @param {import('electron').WebContents | null | undefined} sender
 * @param {{ category?: string, message: string, detail?: string, batchLabel?: string }} payload
 */
export function pushAppLog(sender, payload) {
  const message = String(payload?.message ?? '').trim()
  if (!message) return

  const entry = {
    category: String(payload?.category ?? 'SYSTEM').trim().toUpperCase() || 'SYSTEM',
    message,
    detail: payload?.detail ? String(payload.detail).trim() : undefined,
    batchLabel: payload?.batchLabel ? String(payload.batchLabel).trim() : undefined,
    at: Date.now(),
  }

  const targets = new Set()
  if (sender && !sender.isDestroyed()) {
    targets.add(sender)
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      targets.add(win.webContents)
    }
  }

  for (const wc of targets) {
    try {
      wc.send('app:log', entry)
    } catch {
      // window may be closing
    }
  }
}
