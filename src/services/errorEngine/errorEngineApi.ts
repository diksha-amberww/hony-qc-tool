import type { InputRow } from '../../utils/inputParse'
import type { VendorReloginResult, VendorScrapeResult } from '../../errorEngine/types'
import {
  cancelVendorSessionInProcess,
  executeVendorScrapeInProcess,
  normalizeScrapeErrorKind,
  reloginVendorInProcess,
} from './errorEngineService'

function bridge() {
  return typeof window !== 'undefined' ? window.electronAPI?.errorEngine : undefined
}

export async function cancelVendorSession(options?: { headless?: boolean }): Promise<void> {
  const api = bridge()
  if (api?.cancelSession) {
    await api.cancelSession({ headless: options?.headless })
    return
  }
  await cancelVendorSessionInProcess()
}

export async function reloginVendorSession(
  attempt: number,
  vendorLoginRequired = true,
  options?: { headless?: boolean },
): Promise<VendorReloginResult> {
  if (!vendorLoginRequired) {
    return { ok: false, error: 'Relogin disabled (vendor login not required)' }
  }
  const api = bridge()
  if (api?.relogin) {
    return api.relogin({
      attempt,
      vendorLoginRequired,
      headless: options?.headless,
    })
  }
  return reloginVendorInProcess(attempt)
}

export async function executeVendorScrapeStep(payload: {
  row: InputRow
  rowIndex: number
  headless: boolean
  batchLabel?: string
  vendorLoginRequired: boolean
  vendorId?: string
}): Promise<VendorScrapeResult> {
  const api = bridge()
  if (api?.executeScrape) {
    const result = await api.executeScrape(payload)
    if (result.ok) return result
    return {
      ok: false,
      kind: normalizeScrapeErrorKind(result.kind),
      error: result.error,
    }
  }
  return executeVendorScrapeInProcess(payload)
}
