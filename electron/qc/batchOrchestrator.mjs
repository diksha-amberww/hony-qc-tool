import { getBatchSession, markBatchDone } from '../qcBatchStore.mjs'
import { pushAppLog } from '../mainProcessLog.mjs'
import { processQcRow } from './processQcRow.mjs'
import {
  isVendorSessionFailure,
  runBatchAutoRelogin,
  waitForBatchRunningOrStopped,
  waitForBatchPausedThenRunning,
} from './batchSessionRecovery.mjs'

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
            keepBrowserAfterScrape: true,
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
          const vendorKind = result.kind ?? 'unknown'
          const errorEngineEnabled = settings.errorEngineEnabled === true
          const vendorLoginRequired = settings.vendorLoginRequired !== false
          const sku = String(row.part_sku ?? row.sku ?? row.upc ?? '').trim()

          const shouldAutoRelogin =
            errorEngineEnabled &&
            vendorLoginRequired &&
            isVendorSessionFailure({ kind: vendorKind, error: result.error })

          if (shouldAutoRelogin) {
            const recovery = await runBatchAutoRelogin(webContents, {
              sessionId,
              rowIndex,
              batchLabel,
              headless,
              sku,
              errorMessage: result.error,
              kind: vendorKind,
              errorEngineMaxRetries: settings.errorEngineMaxRetries,
              errorEngineBackoffBaseMs: settings.errorEngineBackoffBaseMs,
            })
            if (recovery.ok) {
              continue
            }
            webContents.send('qc:batchProcessing', {
              type: 'vendorFailure',
              sessionId,
              rowIndex,
              kind: vendorKind,
              error: recovery.error ?? result.error,
              recoveryExhausted: true,
            })
            const waited = await waitForBatchRunningOrStopped(sessionId, abort)
            if (!waited.running) {
              break
            }
            continue
          }

          webContents.send('qc:batchProcessing', {
            type: 'vendorFailure',
            sessionId,
            rowIndex,
            kind: vendorKind,
            error: result.error,
          })
          const waited = await waitForBatchPausedThenRunning(sessionId, abort)
          if (!waited.running) {
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

export function stopAllBatchProcessingLoops() {
  for (const handle of activeLoops.values()) {
    handle.stop = true
  }
}

export function isBatchProcessingLoopActive(sessionId) {
  return activeLoops.has(sessionId)
}
