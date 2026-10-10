/** QC tool codenames are always exactly four characters (vendor-supplied at integration time). */
export const QC_TOOL_CODENAME_LENGTH = 4

export const DEFAULT_QC_TOOL_CODENAME = 'HONY'

/** Full vendor display name shown in headers, exports, and branded UI surfaces. */
export const DEFAULT_QC_TOOL_VENDOR_DISPLAY_NAME = 'Hony'

/** Normalize any vendor value to a fixed 4-character display string. */
export function formatQcToolCodename(codename: string): string {
  const cleaned = codename.trim().toUpperCase().replace(/\s+/g, '')
  const core = cleaned.slice(0, QC_TOOL_CODENAME_LENGTH)
  return core.padEnd(QC_TOOL_CODENAME_LENGTH, ' ')
}
