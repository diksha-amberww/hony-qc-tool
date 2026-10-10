import type { InputRow } from '../utils/inputParse'

export type QcUploadMode = 'paste' | 'file'

export type QcValidateRequest = {
  mode: QcUploadMode
  raw: string
  fieldIds: string[]
  file?: {
    name: string
    size: number
  }
}

/** Max rows returned to the renderer after validate (full dataset stays in the batch session). */
export const QC_VALIDATE_PREVIEW_ROWS = 100

export type QcValidateSuccess = {
  ok: true
  sessionId: string
  rowCount: number
  previewRows: InputRow[]
}

export type QcValidateFailure = {
  ok: false
  errors: string[]
}

export type QcValidateResponse = QcValidateSuccess | QcValidateFailure

export type QcStartBatchRequest = {
  sessionId: string
}

export type QcStartBatchResponse =
  | { ok: true; sessionId: string; total: number }
  | { ok: false; error: string }

export type QcBatchSessionState = 'validated' | 'running' | 'paused' | 'stopped' | 'done'

export type QcBatchControlRequest = {
  sessionId: string
}

export type QcBatchControlResponse =
  | { ok: true; sessionId: string; state: QcBatchSessionState }
  | { ok: false; error: string }

export type QcBatchSessionResponse =
  | {
      ok: true
      sessionId: string
      rows: InputRow[]
      fieldIds: string[]
      state: QcBatchSessionState
    }
  | { ok: false; error: string }
