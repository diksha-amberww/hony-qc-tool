/** Copy plain text to the system clipboard (Electron + browser). */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = String(text ?? '')
  if (!value.trim()) return false
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}
