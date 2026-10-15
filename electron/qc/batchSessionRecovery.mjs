import { markBatchPaused, markBatchResumed, getBatchSession } from '../qcBatchStore.mjs'
import { pushAppLog } from '../mainProcessLog.mjs'
import { releaseHoneysPortalBrowserWindow } from '../vendor/honeysPortalBrowser.mjs'
import { clearHoneysSession, ensureHoneysPortalSession } from '../vendor/honeysPlaceSession.mjs'

const RECOVERABLE_VENDOR_KINDS = new Set(['authentication', 'blocked', 'timeout'])

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function exponentialBackoffMs(attempt, baseMs, maxMs = 120_000) {
  const safeAttempt = Math.max(1, Math.floor(attempt))
  const safeBase = Math.max(100, Math.floor(baseMs))
  const delay = safeBase * 2 ** (safeAttempt - 1)
  return Math.min(delay, maxMs)
}

/**
 * @param {unknown} kind
 */
export function isVendorSessionFailureKind(kind) {
  return RECOVERABLE_VENDOR_KINDS.has(String(kind ?? ''))
}

/**
 * @param {{ kind?: unknown, error?: unknown }} result
 */
export function isVendorSessionFailure(result) {
  if (isVendorSessionFailureKind(result?.kind)) return true
  const msg = String(result?.error ?? '').toLowerCase()
  return /session expired|vendor session|login page|not authenticated|auth page|choose account|blocked/i.test(
    msg,
  )
}

/**
 * @param {import('electron').WebContents} webContents
 * @param {object} opts
 */
export async function runBatchAutoRelogin(webContents, opts) {
  const {
    sessionId,
    rowIndex,
    batchLabel,
    headless,
    sku,
    errorMessage,
    kind,
    errorEngineMaxRetries = 3,
    errorEngineBackoffBaseMs = 2_000,
  } = opts

  const maxAttempts = Math.min(5, Math.max(3, Number(errorEngineMaxRetries) || 3))
  const backoffBase = Math.max(500, Number(errorEngineBackoffBaseMs) || 2_000)

  const log = (category, message, detail) => {
    pushAppLog(webContents, {
      category,
      message,
      detail,
      batchLabel,
    })
  }

  const sendPhase = (phase, detail) => {
    webContents.send('qc:batchProcessing', {
      type: 'sessionRecovery',
      sessionId,
      phase,
      rowIndex,
      kind,
      error: errorMessage,
      detail,
    })
  }

  const paused = markBatchPaused(sessionId)
  if (!paused) {
    return { ok: false, error: 'Could not pause QC batch for session recovery.' }
  }

  sendPhase('paused', errorMessage)
  log(
    'SESSION EXPIRED',
    'Vendor session expired — QC batch auto-paused',
    sku ? `SKU ${sku}` : undefined,
  )
  log('SYSTEM', 'Auto-Relogin: preparing fresh vendor login', errorMessage)

  sendPhase('cancelling_session')
  try {
    releaseHoneysPortalBrowserWindow({
      headless,
      log: (line) => log('LOGIN', line),
    })
    await clearHoneysSession()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Session cancel failed'
    log('WARNING', 'Auto-Relogin: session cancel warning', msg)
  }

  let lastError = 'Relogin failed'

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const waitMs = attempt > 1 ? exponentialBackoffMs(attempt - 1, backoffBase) : 0
    if (waitMs > 0) {
      sendPhase('relogging', `Backoff ${Math.round(waitMs / 1000)}s before attempt ${attempt}/${maxAttempts}`)
      log(
        'LOGIN',
        'Auto-Relogin: waiting before retry',
        `Attempt ${attempt}/${maxAttempts} · ${waitMs}ms`,
      )
      await sleep(waitMs)
    } else {
      sendPhase('relogging', `Attempt ${attempt}/${maxAttempts}`)
    }

    log('LOGIN', 'Auto-Relogin: automatic relogin attempt', `${attempt}/${maxAttempts}`)

    const login = await ensureHoneysPortalSession({
      reuseSession: false,
      freshSession: true,
      clearStoredSession: attempt === 1,
      headless,
      keepBrowserForScraping: true,
      onLogLine: (line) => log('LOGIN', line),
    })

    if (login.ok) {
      const resumed = markBatchResumed(sessionId)
      if (!resumed) {
        return { ok: false, error: 'Relogin succeeded but QC batch could not resume.' }
      }
      sendPhase('resumed')
      log('LOGIN SUCCESSFUL', 'Auto-Relogin: vendor session restored', `Attempts: ${attempt}`)
      log('SYSTEM', 'Auto-Relogin: QC batch resumed from last SKU', sku ? `SKU ${sku}` : undefined)
      sendPhase('recovered')
      return { ok: true, attemptsUsed: attempt }
    }

    lastError = login.error ?? 'Relogin failed'
    log('ERROR', 'Auto-Relogin: relogin attempt failed', `${attempt}/${maxAttempts} · ${lastError}`)
  }

  sendPhase('recovery_failed', lastError)
  log('ERROR', 'Auto-Relogin: recovery exhausted', lastError)
  return { ok: false, error: lastError, attemptsUsed: maxAttempts }
}

/**
 * Wait until the batch is running again, stopped, or done.
 * @param {string} sessionId
 * @param {{ stop: boolean }} abort
 */
export async function waitForBatchRunningOrStopped(sessionId, abort) {
  while (!abort.stop) {
    await sleep(400)
    const session = getBatchSession(sessionId)
    if (!session || session.state === 'stopped' || session.state === 'done') {
      return { running: false, state: session?.state ?? 'missing' }
    }
    if (session.state === 'running') {
      return { running: true, state: 'running' }
    }
  }
  return { running: false, state: 'aborted' }
}

/**
 * Wait for pause (from UI / Error Engine) then resume — avoids resuming before pause is applied.
 * @param {string} sessionId
 * @param {{ stop: boolean }} abort
 */
export async function waitForBatchPausedThenRunning(sessionId, abort) {
  let sawPaused = false
  while (!abort.stop) {
    await sleep(400)
    const session = getBatchSession(sessionId)
    if (!session || session.state === 'stopped' || session.state === 'done') {
      return { running: false, state: session?.state ?? 'missing' }
    }
    if (session.state === 'paused') {
      sawPaused = true
    }
    if (sawPaused && session.state === 'running') {
      return { running: true, state: 'running' }
    }
  }
  return { running: false, state: 'aborted' }
}
