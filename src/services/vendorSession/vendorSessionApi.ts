import type { VendorLoginRequest, VendorLoginResult } from './vendorSessionService'
import { performVendorLoginInProcess } from './vendorSessionService'

function bridge() {
  return typeof window !== 'undefined' ? window.electronAPI?.vendorSession : undefined
}

export async function performVendorLogin(request: VendorLoginRequest): Promise<VendorLoginResult> {
  const api = bridge()
  if (api?.login) {
    return api.login(request)
  }
  return performVendorLoginInProcess(request)
}
