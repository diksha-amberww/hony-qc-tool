import type {
  QcBatchControlRequest,
  QcBatchControlResponse,
  QcBatchSessionResponse,
  QcStartBatchRequest,
  QcStartBatchResponse,
  QcValidateRequest,
  QcValidateResponse,
} from '../types/qcUpload'
import {
  getBatchSessionInProcess,
  pauseBatchInProcess,
  resumeBatchInProcess,
  startBatchInProcess,
  stopBatchInProcess,
  validateUploadInProcess,
} from './qc/qcEngineService'

function qcBridge() {
  return typeof window !== 'undefined' ? window.electronAPI?.qc : undefined
}

export async function validateUpload(request: QcValidateRequest): Promise<QcValidateResponse> {
  const bridge = qcBridge()
  if (bridge?.validateUpload) {
    return bridge.validateUpload(request)
  }
  return validateUploadInProcess(request)
}

export async function startQcBatch(request: QcStartBatchRequest): Promise<QcStartBatchResponse> {
  const bridge = qcBridge()
  if (bridge?.startBatch) {
    return bridge.startBatch(request)
  }
  return startBatchInProcess(request)
}

export async function pauseQcBatch(request: QcBatchControlRequest): Promise<QcBatchControlResponse> {
  const bridge = qcBridge()
  if (bridge?.pauseBatch) {
    return bridge.pauseBatch(request)
  }
  return pauseBatchInProcess(request)
}

export async function resumeQcBatch(request: QcBatchControlRequest): Promise<QcBatchControlResponse> {
  const bridge = qcBridge()
  if (bridge?.resumeBatch) {
    return bridge.resumeBatch(request)
  }
  return resumeBatchInProcess(request)
}

export async function stopQcBatch(request: QcBatchControlRequest): Promise<QcBatchControlResponse> {
  const bridge = qcBridge()
  if (bridge?.stopBatch) {
    return bridge.stopBatch(request)
  }
  return stopBatchInProcess(request)
}

export async function getQcBatchSession(sessionId: string): Promise<QcBatchSessionResponse> {
  const bridge = qcBridge()
  if (bridge?.getSession) {
    return bridge.getSession({ sessionId })
  }
  return getBatchSessionInProcess(sessionId)
}
