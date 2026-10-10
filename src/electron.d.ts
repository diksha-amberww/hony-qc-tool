import type {
  CredentialClearResult,
  CredentialSaveAllResult,
  CredentialSaveResult,
  CredentialsStatusResponse,
  CredentialTestResult,
  CredentialDisplayValuesResponse,
  CredentialFormValuesResponse,
} from './types/credentials'
import type { ScrapeErrorKind } from './errorEngine/types'
import type { InputRow } from './utils/inputParse'
import type { CustomExcelExportRequest, CustomExcelExportResponse } from './types/customExport'
import type { QcExportRequest, QcExportResponse } from './types/qcExport'
import type {
  QcBatchControlRequest,
  QcBatchControlResponse,
  QcBatchSessionResponse,
  QcStartBatchRequest,
  QcStartBatchResponse,
  QcValidateRequest,
  QcValidateResponse,
} from './types/qcUpload'
import type { QcProcessRowResponse } from './types/listingExtract'
import type { AppSettings } from './types/settings'
import type { BrandAliasPair } from './types/brandAlias'

export interface ElectronCredentialsBridge {
  getStatus: () => Promise<CredentialsStatusResponse>
  getDisplayValues: () => Promise<CredentialDisplayValuesResponse>
  getFormValues: () => Promise<CredentialFormValuesResponse>
  save: (groupId: string, values: Record<string, string>) => Promise<CredentialSaveResult>
  saveAll: (items: { groupId: string; values: Record<string, string> }[]) => Promise<CredentialSaveAllResult>
  clear: (groupId: string) => Promise<CredentialClearResult>
  test: (
    groupId: string,
    options?: { headlessScraping?: boolean },
  ) => Promise<CredentialTestResult>
  encryptionAvailable: () => Promise<boolean>
  onTestLog?: (callback: (payload: { groupId: string; line: string }) => void) => () => void
  onChanged?: (callback: () => void) => () => void
}

export type QcBatchProcessingEvent =
  | { type: 'row'; sessionId: string; rowIndex: number; result: QcProcessRowResponse }
  | {
      type: 'vendorFailure'
      sessionId: string
      rowIndex: number
      kind?: string
      error: string
    }
  | { type: 'complete'; sessionId: string; total: number }
  | { type: 'idle'; sessionId: string }

export type QcProcessRowRequest = {
  row: InputRow
  rowIndex: number
  headless: boolean
  batchLabel?: string
  vendorId: string
  settings: Pick<AppSettings, 'titleSimilarityPercent' | 'imageSimilarityPercent'>
  brandAliases: BrandAliasPair[]
}

export interface ElectronQcBridge {
  validateUpload: (request: QcValidateRequest) => Promise<QcValidateResponse>
  startBatch: (payload: QcStartBatchRequest) => Promise<QcStartBatchResponse>
  pauseBatch: (payload: QcBatchControlRequest) => Promise<QcBatchControlResponse>
  resumeBatch: (payload: QcBatchControlRequest) => Promise<QcBatchControlResponse>
  stopBatch: (payload: QcBatchControlRequest) => Promise<QcBatchControlResponse>
  getSession: (payload: { sessionId: string }) => Promise<QcBatchSessionResponse>
  exportBatch: (request: QcExportRequest) => Promise<QcExportResponse>
  processRow: (payload: QcProcessRowRequest) => Promise<QcProcessRowResponse>
  processBatchInBackground?: (payload: {
    sessionId: string
    batchLabel?: string
    vendorId: string
    headless: boolean
    startRowIndex?: number
    settings: Pick<AppSettings, 'titleSimilarityPercent' | 'imageSimilarityPercent'>
    brandAliases: BrandAliasPair[]
  }) => Promise<{ ok: boolean; error?: string; alreadyRunning?: boolean }>
  onBatchProcessing?: (callback: (event: QcBatchProcessingEvent) => void) => () => void
}

export type ElectronVendorScrapePayload = {
  row: InputRow
  rowIndex: number
  headless: boolean
  batchLabel?: string
  vendorLoginRequired: boolean
  vendorId?: string
}

export type ElectronVendorScrapeResponse =
  | { ok: true; extract?: unknown }
  | { ok: false; kind: ScrapeErrorKind; error: string }

export type VendorLoginRequest = {
  vendorLoginRequired: boolean
  reuseSession: boolean
  headless: boolean
  batchLabel?: string
}

export interface ElectronVendorSessionBridge {
  login: (request: VendorLoginRequest) => Promise<{ ok: true; skipped?: boolean } | { ok: false; error: string }>
}

export interface ElectronErrorEngineBridge {
  cancelSession: () => Promise<{ ok: true }>
  relogin: (payload: { attempt: number; vendorLoginRequired?: boolean }) => Promise<
    { ok: true } | { ok: false; error: string }
  >
  executeScrape: (payload: ElectronVendorScrapePayload) => Promise<ElectronVendorScrapeResponse>
}

export type Bitrix24SendMessagePayload = {
  message: string
  dialogId?: string
}

export type Bitrix24SendMessageResult =
  | { ok: true; messageId?: unknown }
  | { ok: false; error: string }

export type Bitrix24TestConnectionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string }

export interface ElectronBitrix24Bridge {
  testConnection: () => Promise<Bitrix24TestConnectionResult>
  sendMessage: (payload: Bitrix24SendMessagePayload) => Promise<Bitrix24SendMessageResult>
}

export interface ElectronExportBridge {
  generateCustomExcel: (request: CustomExcelExportRequest) => Promise<CustomExcelExportResponse>
}

export type AppLogPayload = {
  category?: string
  message: string
  detail?: string
  batchLabel?: string
  at?: number
}

export interface ElectronBridge {
  platform: string
  onAppLog?: (callback: (payload: AppLogPayload) => void) => () => void
  qc?: ElectronQcBridge
  vendorSession?: ElectronVendorSessionBridge
  errorEngine?: ElectronErrorEngineBridge
  credentials?: ElectronCredentialsBridge
  bitrix24?: ElectronBitrix24Bridge
  export?: ElectronExportBridge
}

declare global {
  interface Window {
    electronAPI?: ElectronBridge
  }
}

export {}
