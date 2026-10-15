import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Paper, Typography } from '@mui/material'
import { PageFrame } from '../components/layout/PageFrame'
import { CredentialGroupCard } from '../components/credentials/CredentialGroupCard'
import { CREDENTIAL_GROUPS, resolveCredentialSections } from '../config/credentialManifest'
import { useLogs } from '../context/LogsContext'
import { useCredentialsActivity } from '../context/CredentialsActivityContext'
import { useCredentialRuntime } from '../context/CredentialRuntimeContext'
import {
  fetchCredentialDisplayValues,
  fetchCredentialFormValues,
  fetchCredentialsStatus,
  saveAllCredentials,
} from '../services/credentialsApi'
import { logCredentialEvent } from '../services/credentialLogging'
import type { CredentialsStatusResponse } from '../types/credentials'
import { useToast } from '../components/toast'
import { hasElectronCredentialsBridge, isElectronDesktop } from '../utils/electronBridge'

type GroupDrafts = Record<string, Record<string, string>>

const PAGE_SECTIONS = resolveCredentialSections()

function emptyDrafts(): GroupDrafts {
  const out: GroupDrafts = {}
  for (const group of CREDENTIAL_GROUPS) {
    out[group.id] = {}
  }
  return out
}

function mergeStoredDrafts(
  display: Record<string, Record<string, string>>,
  form: Record<string, Record<string, string>>,
): GroupDrafts {
  const next = emptyDrafts()
  for (const group of CREDENTIAL_GROUPS) {
    next[group.id] = {
      ...(display[group.id] ?? {}),
      ...(form[group.id] ?? {}),
    }
  }
  return next
}

export function CredentialsPage() {
  const { showToast } = useToast()
  const { appendLog } = useLogs()
  const { revision } = useCredentialRuntime()
  const {
    testFeedbackByGroup,
    beginCredentialTest,
    appendCredentialTestLine,
    endCredentialTest,
    clearCredentialTestFeedback,
  } = useCredentialsActivity()
  const [status, setStatus] = useState<CredentialsStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<GroupDrafts>(emptyDrafts)
  const [savingAll, setSavingAll] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [nextStatus, display, form] = await Promise.all([
        fetchCredentialsStatus(),
        fetchCredentialDisplayValues(),
        fetchCredentialFormValues(),
      ])
      setStatus(nextStatus)
      setDrafts(mergeStoredDrafts(display.groups, form.groups))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, revision])

  const log = useCallback(
    (message: string, detail?: string) => {
      logCredentialEvent(appendLog, message, detail)
    },
    [appendLog],
  )

  const setDraftField = useCallback((groupId: string, storageKey: string, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [groupId]: { ...prev[groupId], [storageKey]: value },
    }))
  }, [])

  const clearGroupSecretDrafts = useCallback((groupId: string) => {
    const group = CREDENTIAL_GROUPS.find((g) => g.id === groupId)
    if (!group) return
    setDrafts((prev) => {
      const next = { ...prev[groupId] }
      for (const field of group.fields) {
        if (field.secret || field.kind === 'secret' || field.kind === 'password') {
          next[field.storageKey] = ''
        }
      }
      return { ...prev, [groupId]: next }
    })
  }, [])

  const saveAllCandidates = useMemo(() => {
    return CREDENTIAL_GROUPS.map((group) => {
      const values = drafts[group.id] ?? {}
      const hasValues = group.fields.some((f) => (values[f.storageKey] ?? '').trim().length > 0)
      return hasValues ? { groupId: group.id, values } : null
    }).filter((item): item is { groupId: string; values: Record<string, string> } => item !== null)
  }, [drafts])

  const handleSaveAll = async () => {
    if (saveAllCandidates.length === 0) {
      showToast('Enter values in at least one section before saving.', 'info')
      return
    }
    setSavingAll(true)
    try {
      const result = await saveAllCredentials(saveAllCandidates)
      for (const groupId of result.savedGroupIds) {
        clearGroupSecretDrafts(groupId)
      }
      if (result.savedGroupIds.length > 0) {
        showToast(`Saved ${result.savedGroupIds.length} credential section(s).`, 'success')
        log('Bulk credentials save', `Sections: ${result.savedGroupIds.length}`)
      }
      if (result.errors.length > 0) {
        showToast('Some sections could not be saved. See Logs for details.', 'error')
        for (const err of result.errors) {
          log('Bulk save failed', `${err.groupId}: ${err.error}`)
        }
      }
      await refresh()
    } finally {
      setSavingAll(false)
    }
  }

  const storageHint = (() => {
    if (status?.storage === 'electron-env') {
      const pathNote = status.storePath ? ` Location: ${status.storePath}.` : ''
      return status.encryptionAvailable
        ? `Credentials are encrypted at rest in credentials.env (OS secure storage).${pathNote} Saved values reload automatically when you reopen the app; only Forget clears them.`
        : `Stored in credentials.env on this device.${pathNote} Enable OS secure storage for encryption. Saved values reload automatically.`
    }
    if (isElectronDesktop() && !hasElectronCredentialsBridge()) {
      return 'Desktop app detected, but the credentials bridge did not load. Restart with npm run dev and check the terminal for preload errors.'
    }
    return 'Browser mode: credentials persist in localStorage on this device. Use the desktop app (npm run dev) for encryption and live tests.'
  })()

  return (
    <PageFrame
      title="Credentials"
      subtitle="Vendor portal, Amazon SP-API, Claude Haiku 5.5, and email — configured via credentialManifest.json."
      actions={
        <Button
          variant="contained"
          size="small"
          disabled={savingAll || saveAllCandidates.length === 0}
          onClick={handleSaveAll}
          sx={{ height: 30, fontSize: '11px', fontWeight: 600, borderRadius: 0.5 }}
        >
          {savingAll ? <CircularProgress size={16} color="inherit" /> : 'Save all'}
        </Button>
      }
    >
      <Alert severity="info" sx={{ mb: 1.5, borderRadius: 0.5, fontSize: '11px', py: 0.5 }}>
        {storageHint}
      </Alert>

      {loading && !status ? (
        <Typography sx={{ fontSize: '12px', color: 'text.secondary' }}>Loading credential status…</Typography>
      ) : (
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          {PAGE_SECTIONS.map((row, index) => (
            <Paper
              key={row.section.id}
              sx={{ p: 2, borderRadius: 0.5, border: '1px solid', borderColor: 'divider' }}
            >
              <Typography sx={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.02em' }}>
                {index + 1}. {row.section.title}
              </Typography>
              {row.section.subtitle && (
                <Typography sx={{ fontSize: '11px', color: 'text.secondary', mt: 0.35, mb: 1.25 }}>
                  {row.section.subtitle}
                </Typography>
              )}
              <CredentialGroupCard
                group={row.group}
                fieldStatus={status?.groups[row.group.id] ?? {}}
                draft={drafts[row.group.id] ?? {}}
                testFeedback={
                  testFeedbackByGroup[row.group.id] ?? {
                    status: 'idle',
                    headline: '',
                    lines: [],
                  }
                }
                onDraftChange={(key, value) => setDraftField(row.group.id, key, value)}
                onDraftClearSecrets={() => clearGroupSecretDrafts(row.group.id)}
                onRefresh={refresh}
                onToast={(message, type) => showToast(message, type)}
                onLog={log}
                onTestBegin={() => beginCredentialTest(row.group.id)}
                onTestLine={(line) => appendCredentialTestLine(row.group.id, line)}
                onTestEnd={(ok, headline, lines) =>
                  endCredentialTest(row.group.id, ok, headline, lines)
                }
                onTestFeedbackClear={() => clearCredentialTestFeedback(row.group.id)}
                embeddedInSection
              />
            </Paper>
          ))}
        </Box>
      )}
    </PageFrame>
  )
}
