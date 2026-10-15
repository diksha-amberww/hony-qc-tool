import { BrowserWindow, ipcMain } from 'electron'
import { loadCredentialManifest, buildCredentialRegistry } from './credentialManifestLoader.mjs'
import { runCredentialTestHandler } from './credentialTestRegistry.mjs'
import { pushAppLog } from './mainProcessLog.mjs'
import { clearHoneysSession } from './vendor/honeysPlaceSession.mjs'
import {
  clearCredentialFields,
  encryptionAvailable,
  getCredentialStorePath,
  getDecryptedValues,
  getFieldStatus,
  getFormValuesForGroups,
  getNonSecretDisplayValuesForGroups,
  saveCredentialFields,
} from './credentialsStore.mjs'

const manifest = loadCredentialManifest()
const registry = buildCredentialRegistry(manifest)

function groupMeta(groupId) {
  return registry.groups[groupId]
}

function broadcastCredentialsChanged() {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('credentials:changed')
  }
}

async function afterCredentialGroupsSaved(groupIds) {
  if (groupIds.includes('vendor_portal')) {
    await clearHoneysSession()
  }
  broadcastCredentialsChanged()
}

export function registerCredentialsIpc() {
  ipcMain.handle('credentials:encryptionAvailable', async () => encryptionAvailable())

  ipcMain.handle('credentials:getStatus', async () => {
    const fields = await getFieldStatus(registry.allKeys)
    const groups = {}
    for (const [groupId, meta] of Object.entries(registry.groups)) {
      groups[groupId] = {}
      for (const key of meta.fieldKeys) {
        groups[groupId][key] = fields[key] ?? { configured: false }
      }
    }
    return {
      groups,
      storage: 'electron-env',
      encryptionAvailable: await encryptionAvailable(),
      storePath: getCredentialStorePath(),
    }
  })

  ipcMain.handle('credentials:getDisplayValues', async () => {
    const groups = await getNonSecretDisplayValuesForGroups(registry.groups)
    return { groups }
  })

  ipcMain.handle('credentials:getFormValues', async () => {
    const groups = await getFormValuesForGroups(registry.groups)
    return { groups }
  })

  function buildGroupUpdates(meta, values) {
    const allowed = new Set(meta.fieldKeys)
    const updates = {}
    for (const [key, value] of Object.entries(values ?? {})) {
      if (!allowed.has(key)) continue
      if (typeof value !== 'string') continue
      if (value === '') continue
      updates[key] = value
    }
    return updates
  }

  ipcMain.handle('credentials:saveAndTest', async (event, payload) => {
    const groupId = payload?.groupId ?? payload?.vendorId
    const values = payload?.values
    if (!groupId || typeof values !== 'object' || values === null) {
      return { ok: false, error: 'Invalid save payload.', log: [] }
    }
    const meta = groupMeta(groupId)
    if (!meta) {
      return { ok: false, error: 'Unknown credential group.', log: [] }
    }

    const updates = buildGroupUpdates(meta, values)
    if (Object.keys(updates).length === 0) {
      return { ok: false, error: 'Enter credential values before saving.', log: [] }
    }

    try {
      const existing = await getDecryptedValues(meta.fieldKeys)
      const merged = { ...existing, ...updates }
      const missing = meta.requiredKeys.filter((k) => !String(merged[k] ?? '').trim())
      if (missing.length > 0) {
        return { ok: false, error: 'Fill all required fields before saving.', log: [] }
      }

      const emitLog = (line) => {
        const text = String(line)
        pushAppLog(event.sender, { category: 'CREDENTIALS', message: text })
        if (meta.testHandler === 'amazon_sp_api') {
          pushAppLog(event.sender, { category: 'SCRAPING', message: text })
        }
        event.sender.send('credentials:testLog', { groupId, line: text })
      }

      pushAppLog(event.sender, {
        category: 'CREDENTIALS',
        message: `Credential save & test started — ${groupId}`,
      })
      if (meta.testHandler === 'amazon_sp_api') {
        pushAppLog(event.sender, {
          category: 'SCRAPING',
          message: 'Amazon SP-API connection test started',
        })
      }

      const headlessScraping =
        typeof payload?.headlessScraping === 'boolean' ? payload.headlessScraping : true
      const outcome = await runCredentialTestHandler(
        meta.testHandler,
        merged,
        meta.testConfig,
        emitLog,
        { headlessScraping },
      )
      const log = Array.isArray(outcome.log) ? outcome.log.map(String) : []

      if (!outcome.ok) {
        if (meta.testHandler === 'amazon_sp_api') {
          pushAppLog(event.sender, {
            category: 'ERROR',
            message: 'Amazon SP-API connection test failed',
            detail: String(outcome.message ?? ''),
          })
        }
        return {
          ok: false,
          error: String(outcome.message ?? 'Credential test failed.'),
          log,
        }
      }

      const toSave = {}
      for (const key of meta.fieldKeys) {
        const value = String(merged[key] ?? '').trim()
        if (value) toSave[key] = value
      }
      await saveCredentialFields(toSave, meta.secretKeys)
      await afterCredentialGroupsSaved([groupId])

      if (meta.testHandler === 'amazon_sp_api') {
        pushAppLog(event.sender, {
          category: 'SCRAPING',
          message: 'Amazon SP-API connection test completed successfully',
        })
      }

      return { ok: true, message: String(outcome.message ?? ''), log }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save & test failed.'
      return { ok: false, error: message, log: [message] }
    }
  })

  ipcMain.handle('credentials:save', async (_event, payload) => {
    const groupId = payload?.groupId ?? payload?.vendorId
    const values = payload?.values
    if (!groupId || typeof values !== 'object' || values === null) {
      return { ok: false, error: 'Invalid save payload.' }
    }
    const meta = groupMeta(groupId)
    if (!meta) {
      return { ok: false, error: 'Unknown credential group.' }
    }

    const updates = buildGroupUpdates(meta, values)

    if (Object.keys(updates).length === 0) {
      return { ok: false, error: 'Enter at least one value to save.' }
    }

    try {
      const existing = await getDecryptedValues(meta.fieldKeys)
      const merged = { ...existing, ...updates }
      const missing = meta.requiredKeys.filter((k) => !String(merged[k] ?? '').trim())
      if (missing.length > 0) {
        return { ok: false, error: 'Fill all required fields before saving.' }
      }
      await saveCredentialFields(updates, meta.secretKeys)
      await afterCredentialGroupsSaved([groupId])
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save credentials.'
      return { ok: false, error: message }
    }
  })

  ipcMain.handle('credentials:saveAll', async (_event, payload) => {
    const items = payload?.items
    if (!Array.isArray(items)) {
      return { ok: false, savedGroupIds: [], errors: [{ groupId: '', error: 'Invalid payload.' }] }
    }

    const savedGroupIds = []
    const errors = []

    for (const item of items) {
      const groupId = item?.groupId
      const values = item?.values
      if (!groupId || typeof values !== 'object') continue

      const meta = groupMeta(groupId)
      if (!meta) {
        errors.push({ groupId: String(groupId), error: 'Unknown credential group.' })
        continue
      }

      const allowed = new Set(meta.fieldKeys)
      const updates = {}
      for (const [key, value] of Object.entries(values)) {
        if (!allowed.has(key)) continue
        if (typeof value !== 'string' || value === '') continue
        updates[key] = value
      }

      if (Object.keys(updates).length === 0) continue

      try {
        const existing = await getDecryptedValues(meta.fieldKeys)
        const merged = { ...existing, ...updates }
        const missing = meta.requiredKeys.filter((k) => !String(merged[k] ?? '').trim())
        if (missing.length > 0) {
          errors.push({ groupId, error: 'Fill all required fields before saving.' })
          continue
        }
        await saveCredentialFields(updates, meta.secretKeys)
        savedGroupIds.push(groupId)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Save failed.'
        errors.push({ groupId, error: message })
      }
    }

    if (savedGroupIds.length > 0) {
      await afterCredentialGroupsSaved(savedGroupIds)
    }

    return {
      ok: errors.length === 0,
      savedGroupIds,
      errors,
    }
  })

  ipcMain.handle('credentials:clear', async (_event, payload) => {
    const groupId = payload?.groupId
    const meta = groupMeta(groupId)
    if (!meta) {
      return { ok: false, error: 'Unknown credential group.' }
    }
    try {
      await clearCredentialFields(meta.fieldKeys)
      await afterCredentialGroupsSaved([groupId])
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to clear credentials.'
      return { ok: false, error: message }
    }
  })

  ipcMain.handle('credentials:test', async (event, payload) => {
    const groupId = payload?.groupId ?? payload?.vendorId
    const meta = groupMeta(groupId)
    if (!meta) {
      return { ok: false, message: 'Unknown credential group.', log: [] }
    }

    try {
      const values = await getDecryptedValues(meta.fieldKeys)
      const missing = meta.requiredKeys.filter((k) => !String(values[k] ?? '').trim())
      if (missing.length > 0) {
        return {
          ok: false,
          message: 'Save required credentials before testing.',
          log: ['One or more required values are not stored yet.'],
        }
      }
      const emitLog = (line) => {
        const text = String(line)
        pushAppLog(event.sender, { category: 'CREDENTIALS', message: text })
        if (meta.testHandler === 'amazon_sp_api') {
          pushAppLog(event.sender, { category: 'SCRAPING', message: text })
        }
        if (meta.testHandler === 'anthropic_api') {
          pushAppLog(event.sender, { category: 'AI', message: text })
        }
        event.sender.send('credentials:testLog', { groupId, line: text })
      }
      pushAppLog(event.sender, {
        category: 'CREDENTIALS',
        message: `Credential test started — ${groupId}`,
      })
      if (meta.testHandler === 'amazon_sp_api') {
        pushAppLog(event.sender, {
          category: 'SCRAPING',
          message: 'Amazon SP-API connection test started',
        })
      }
      if (meta.testHandler === 'anthropic_api') {
        pushAppLog(event.sender, {
          category: 'AI',
          message: 'Claude Haiku 5.5 connection test started',
        })
      }
      const headlessScraping =
        typeof payload?.headlessScraping === 'boolean' ? payload.headlessScraping : true
      const outcome = await runCredentialTestHandler(meta.testHandler, values, meta.testConfig, emitLog, {
        headlessScraping,
      })
      if (meta.testHandler === 'amazon_sp_api') {
        pushAppLog(event.sender, {
          category: outcome.ok ? 'SCRAPING' : 'ERROR',
          message: outcome.ok
            ? 'Amazon SP-API connection test completed successfully'
            : 'Amazon SP-API connection test failed',
          detail: String(outcome.message ?? ''),
        })
      }
      if (meta.testHandler === 'anthropic_api') {
        pushAppLog(event.sender, {
          category: outcome.ok ? 'AI' : 'ERROR',
          message: outcome.ok
            ? 'Claude Haiku 5.5 connection test completed successfully'
            : 'Claude Haiku 5.5 connection test failed',
          detail: String(outcome.message ?? ''),
        })
      }
      const log = Array.isArray(outcome.log) ? outcome.log.map(String) : []
      return { ok: Boolean(outcome.ok), message: String(outcome.message ?? ''), log }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Test failed.'
      return { ok: false, message, log: [message] }
    }
  })
}
