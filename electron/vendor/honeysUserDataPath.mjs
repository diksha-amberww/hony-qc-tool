import os from 'node:os'
import path from 'node:path'

/**
 * Stable userData path (matches electron/main.mjs).
 * Override with HONY_QC_USER_DATA or legacy GRAND_QC_USER_DATA.
 */
export function resolveHoneysUserDataPath() {
  const defaultUserData = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'HonyQCTool',
  )
  return (
    process.env.HONY_QC_USER_DATA ||
    process.env.GRAND_QC_USER_DATA ||
    defaultUserData
  ).trim()
}

export function honeysSessionFilePath() {
  return path.join(resolveHoneysUserDataPath(), 'honeys-portal-session.json')
}
