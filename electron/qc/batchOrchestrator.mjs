import { getBatchSession, markBatchDone } from '../qcBatchStore.mjs'
import { pushAppLog } from '../mainProcessLog.mjs'
import { processQcRow } from './processQcRow.mjs'

const TICK_MS = 650

/** @type {Map<string, { stop: boolean }>} */
const activeLoops = new Map()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * @param {import('electron').WebContents} webContents
 * @param {object} payload
 */
export async function startBatchProcessingLoop(webContents, payload) {
  const sessionId = String(payload?.sessionId ?? '')
  if (!sessionId) {
    return { ok: false, error: 'Missing batch session id.' }
  }
  if (activeLoops.has(sessionId)) {
    return { ok: true, alreadyRunning: true }
  }

  const abort = { stop: false }
  activeLoops.set(sessionId, abort)

  void (async () => {
    try {
      let rowIndex =
        typeof payload.startRowIndex === 'number' && payload.startRowIndex >= 0
          ? payload.startRowIndex
          : 0
      const batchLabel =
        typeof payload.batchLabel === 'string' ? payload.batchLabel.trim() : undefined
      const vendorId = typeof payload.vendorId === 'string' ? payload.vendorId : 'honeys'
      const settings = payload.settings && typeof payload.settings === 'object' ? payload.settings : {}
      const brandAliases = Array.isArray(payload.brandAliases) ? payload.brandAliases : []
      const headless = payload.headless !== false

      while (!abort.stop) {
        const session = getBatchSession(sessionId)
        if (!session) break
        if (session.state === 'stopped' || session.state === 'done') break
        if (session.state === 'paused') {
          await sleep(400)
          continue
        }
        if (session.state !== 'running') break

        if (rowIndex >= session.rows.length) {
          markBatchDone(sessionId)
          webContents.send('qc:batchProcessing', {
            type: 'complete',
            sessionId,
            total: session.rows.length,
          })
          break
        }

        await sleep(TICK_MS)

        const row = session.rows[rowIndex]
        const appLog = ({ category, message, detail }) => {
          pushAppLog(webContents, {
            category,
            message,
            detail,
            batchLabel,
          })
        }

        const result = await processQcRow(
          {
            row,
            rowIndex,
            headless,
            batchLabel,
            vendorId,
            settings,
            brandAliases,
          },
          appLog,
        )

        webContents.send('qc:batchProcessing', {
          type: 'row',
          sessionId,
          rowIndex,
          result,
        })

        if (!result.ok && result.phase === 'vendor') {
          webContents.send('qc:batchProcessing', {
            type: 'vendorFailure',
            sessionId,
            rowIndex,
            kind: result.kind,
            error: result.error,
          })
          while (!abort.stop) {
            await sleep(400)
            const current = getBatchSession(sessionId)
            if (!current || current.state === 'stopped' || current.state === 'done') {
              break
            }
            if (current.state === 'running') {
              break
            }
          }
          const afterWait = getBatchSession(sessionId)
          if (!afterWait || afterWait.state !== 'running') {
            break
          }
          continue
        }

        rowIndex += 1
      }
    } finally {
      activeLoops.delete(sessionId)
      webContents.send('qc:batchProcessing', {
        type: 'idle',
        sessionId,
      })
    }
  })()

  return { ok: true }
}

export function stopBatchProcessingLoop(sessionId) {
  const handle = activeLoops.get(sessionId)
  if (handle) handle.stop = true
}

export function isBatchProcessingLoopActive(sessionId) {
  return activeLoops.has(sessionId)
}
