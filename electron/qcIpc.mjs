import { ipcMain } from 'electron'
import {
  createBatchSession,
  getBatchSession,
  markBatchPaused,
  markBatchResumed,
  markBatchRunning,
  markBatchStopped,
  newSessionId,
} from './qcBatchStore.mjs'
import { QC_VALIDATE_PREVIEW_ROWS, runUploadValidation } from './qcUploadValidation.mjs'
import { processQcRow } from './qc/processQcRow.mjs'
import { pushAppLog } from './mainProcessLog.mjs'
import { startBatchProcessingLoop, stopBatchProcessingLoop } from './qc/batchOrchestrator.mjs'

export function registerQcIpc() {
  ipcMain.handle('qc:validateUpload', async (_event, request) => {
    if (!request || typeof request !== 'object') {
      return { ok: false, errors: ['Invalid validation request'] }
    }
    const result = runUploadValidation(request)
    if (!result.ok) {
      return { ok: false, errors: result.errors }
    }
    const sessionId = newSessionId()
    createBatchSession(sessionId, request.fieldIds ?? [], result.rows)
    const rowCount = result.rows.length
    const previewRows = result.rows.slice(0, QC_VALIDATE_PREVIEW_ROWS)
    return {
      ok: true,
      sessionId,
      rowCount,
      previewRows,
    }
  })

  ipcMain.handle('qc:startBatch', async (_event, payload) => {
    const sessionId = payload?.sessionId
    if (!sessionId || typeof sessionId !== 'string') {
      return { ok: false, error: 'Missing validation session.' }
    }
    const session = getBatchSession(sessionId)
    if (!session) {
      return { ok: false, error: 'Validation session expired. Run Validate again.' }
    }
    if (session.state !== 'validated') {
      return { ok: false, error: 'This batch was already started or completed.' }
    }
    if (session.rows.length === 0) {
      return { ok: false, error: 'No rows in validated batch.' }
    }
    const running = markBatchRunning(sessionId)
    if (!running) {
      return { ok: false, error: 'Unable to start QC for this session.' }
    }
    return { ok: true, sessionId, total: running.rows.length }
  })

  ipcMain.handle('qc:pauseBatch', async (_event, payload) => {
    const sessionId = payload?.sessionId
    if (!sessionId || typeof sessionId !== 'string') {
      return { ok: false, error: 'Missing validation session.' }
    }
    const session = markBatchPaused(sessionId)
    if (!session) {
      return { ok: false, error: 'QC can only be paused while it is running.' }
    }
    return { ok: true, sessionId, state: session.state }
  })

  ipcMain.handle('qc:resumeBatch', async (_event, payload) => {
    const sessionId = payload?.sessionId
    if (!sessionId || typeof sessionId !== 'string') {
      return { ok: false, error: 'Missing validation session.' }
    }
    const session = markBatchResumed(sessionId)
    if (!session) {
      return { ok: false, error: 'QC can only be resumed while it is paused.' }
    }
    return { ok: true, sessionId, state: session.state }
  })

  ipcMain.handle('qc:stopBatch', async (_event, payload) => {
    const sessionId = payload?.sessionId
    if (!sessionId || typeof sessionId !== 'string') {
      return { ok: false, error: 'Missing validation session.' }
    }
    stopBatchProcessingLoop(sessionId)
    const session = markBatchStopped(sessionId)
    if (!session) {
      return { ok: false, error: 'QC can only be stopped while running or paused.' }
    }
    return { ok: true, sessionId, state: session.state }
  })

  ipcMain.handle('qc:processBatchInBackground', async (event, payload) => {
    return startBatchProcessingLoop(event.sender, payload)
  })

  ipcMain.handle('qc:processRow', async (event, payload) => {
    const batchLabel =
      typeof payload?.batchLabel === 'string' ? payload.batchLabel.trim() : undefined
    const appLog = ({ category, message, detail }) => {
      pushAppLog(event.sender, {
        category,
        message,
        detail,
        batchLabel,
      })
    }
    return processQcRow(payload, appLog)
  })

  ipcMain.handle('qc:getSession', async (_event, payload) => {
    const sessionId = payload?.sessionId
    if (!sessionId || typeof sessionId !== 'string') {
      return { ok: false, error: 'Missing session id.' }
    }
    const session = getBatchSession(sessionId)
    if (!session) {
      return { ok: false, error: 'Validation session not found.' }
    }
    return {
      ok: true,
      sessionId: session.sessionId,
      rows: session.rows,
      fieldIds: session.fieldIds,
      state: session.state,
    }
  })
}
