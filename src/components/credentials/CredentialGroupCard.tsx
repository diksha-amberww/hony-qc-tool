import { useCallback, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
} from '@mui/material'
import Visibility from '@mui/icons-material/Visibility'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import { ConfirmDialog } from '../confirm'
import {
  groupHasAnyConfigured,
  groupHasRequiredValues,
  isFieldSecret,
  isGroupFullyConfigured,
} from '../../config/credentialManifest'
import type {
  CredentialFieldStatus,
  CredentialGroupDef,
  CredentialTestFeedback,
} from '../../types/credentials'
import {
  clearCredentials,
  saveAndTestCredentials,
  saveCredentials,
  testCredentials,
} from '../../services/credentialsApi'
import { AI_QC_MODEL_DISPLAY_NAME, DEFAULT_AI_QC_MODEL } from '../../config/aiQc'
import { useSettings } from '../../context/SettingsContext'
import { CredentialTestFeedbackPanel } from './CredentialTestFeedbackPanel'

const MASK = '••••••••'
const fieldSx = { '& .MuiInputBase-root': { borderRadius: 0.5, fontSize: '12px' } }

const CATEGORY_LABEL: Record<string, string> = {
  portal: 'Portal',
  amazon: 'Amazon',
  external_api: 'API',
  ai: 'AI',
  email: 'Email',
  integration: 'Integration',
  other: 'Other',
}

type Props = {
  group: CredentialGroupDef
  fieldStatus: Record<string, CredentialFieldStatus>
  draft: Record<string, string>
  onDraftChange: (storageKey: string, value: string) => void
  onDraftClearSecrets: () => void
  onRefresh: () => void
  onToast: (message: string, type: 'success' | 'error' | 'info') => void
  onLog: (message: string, detail?: string) => void
  testFeedback: CredentialTestFeedback
  onTestBegin: () => void
  onTestLine: (line: string) => void
  onTestEnd: (ok: boolean, headline: string, lines: string[]) => void
  onTestFeedbackClear: () => void
  /** When true, section title is rendered by the parent Credentials page. */
  embeddedInSection?: boolean
}

export function CredentialGroupCard({
  group,
  fieldStatus,
  draft,
  onDraftChange,
  onDraftClearSecrets,
  onRefresh,
  onToast,
  onLog,
  testFeedback,
  onTestBegin,
  onTestLine,
  onTestEnd,
  onTestFeedbackClear,
  embeddedInSection = false,
}: Props) {
  const { settings } = useSettings()
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [editingSecrets, setEditingSecrets] = useState<Record<string, boolean>>({})
  const [visibleValues, setVisibleValues] = useState<Record<string, boolean>>({})
  const minimalUi = group.category === 'amazon'
  const fullyConfigured = useMemo(
    () => isGroupFullyConfigured(group, fieldStatus),
    [group, fieldStatus],
  )
  const showAmazonSavedOnly = minimalUi && fullyConfigured

  const anyConfigured = useMemo(
    () => groupHasAnyConfigured(group, fieldStatus),
    [group, fieldStatus],
  )

  const statusLabel = useMemo(() => {
    if (fullyConfigured) return 'Configured'
    if (anyConfigured) return 'Loaded'
    if (group.optional) return 'Optional'
    return 'Incomplete'
  }, [fullyConfigured, anyConfigured, group.optional])

  const statusColor = fullyConfigured ? 'success' : anyConfigured ? 'info' : 'default'

  const canTest = fullyConfigured

  const hasDraftValues = useMemo(
    () => group.fields.some((f) => (draft[f.storageKey] ?? '').trim().length > 0),
    [group, draft],
  )

  const hasRequiredForSave = useMemo(
    () => groupHasRequiredValues(group, draft, fieldStatus, editingSecrets),
    [group, draft, fieldStatus, editingSecrets],
  )

  const canSave = useMemo(() => {
    const hasChanges = hasDraftValues || Object.values(editingSecrets).some(Boolean)
    if (!hasChanges) return false
    return hasRequiredForSave
  }, [hasDraftValues, editingSecrets, hasRequiredForSave])

  const handleSaveAndTest = async () => {
    if (!hasRequiredForSave) {
      onToast('Fill all required fields before saving.', 'error')
      return
    }
    setSaving(true)
    onTestBegin()
    try {
      onLog(`Save & test started`, group.name)
      const result = await saveAndTestCredentials(
        group.id,
        draft,
        { headlessScraping: settings.headlessScraping },
        (line) => onTestLine(line),
      )
      const logLines = Array.isArray(result.log) ? result.log : []
      if (!result.ok) {
        const headline = formatTestHeadline(false, result.error ?? 'Save & test failed.')
        onTestEnd(false, headline, logLines)
        onToast(result.error ?? 'Could not save credentials.', 'error')
        onLog(`Save & test failed`, `${group.name} — ${result.error}`)
        for (const line of logLines) onLog(line)
        return
      }
      onDraftClearSecrets()
      setEditingSecrets({})
      setVisibleValues({})
      const headline = formatTestHeadline(true, result.message ?? '')
      onTestEnd(true, headline, logLines)
      for (const line of logLines) onLog(line)
      onLog(`Credentials saved`, group.name)
      onRefresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save & test failed.'
      onTestEnd(false, formatTestHeadline(false, message), [message])
      onToast(message, 'error')
      onLog(`Save & test failed`, `${group.name} — ${message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    if (!hasRequiredForSave) {
      onToast('Fill all required fields before saving.', 'error')
      return
    }
    setSaving(true)
    try {
      const result = await saveCredentials(group.id, draft)
      if (!result.ok) {
        onToast(result.error ?? 'Could not save credentials.', 'error')
        onLog(`Save failed for ${group.name}`, result.error)
        return
      }
      onDraftClearSecrets()
      setEditingSecrets({})
      setVisibleValues({})
      onToast(`${group.name} saved.`, 'success')
      onLog(`Credentials saved`, group.name)
      onRefresh()
    } finally {
      setSaving(false)
    }
  }

  const formatTestHeadline = (ok: boolean, message: string) => {
    if (!message) return ok ? 'Test succeeded.' : 'Test failed.'
    if (ok) return message
    const lower = message.toLowerCase()
    if (lower.startsWith('login failed') || lower.startsWith('test failed')) return message
    const loginStyle =
      group.category === 'portal' || group.testActionLabel.toLowerCase().includes('login')
    return loginStyle ? `Login failed — ${message}` : `Test failed — ${message}`
  }

  const handleTest = async () => {
    setTesting(true)
    onTestBegin()
    try {
      onLog(`Connection test started`, group.name)
      const result = await testCredentials(
        group.id,
        { headlessScraping: settings.headlessScraping },
        (line) => onTestLine(line),
      )
      const logLines = Array.isArray(result.log) ? result.log : []
      const headline = formatTestHeadline(result.ok, result.message)
      onTestEnd(result.ok, headline, logLines)
      for (const line of logLines) {
        onLog(line)
      }
      onToast(result.message, result.ok ? 'success' : 'error')
      onLog(
        result.ok ? `Connection test succeeded` : `Connection test failed`,
        `${group.name} — ${result.message}`,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection test failed.'
      const headline = formatTestHeadline(false, message)
      onTestEnd(false, headline, [message])
      onToast(message, 'error')
      onLog(`Connection test failed`, `${group.name} — ${message}`)
    } finally {
      setTesting(false)
    }
  }

  const handleClear = async () => {
    setClearing(true)
    try {
      const result = await clearCredentials(group.id)
      if (!result.ok) {
        onToast(result.error ?? 'Could not clear credentials.', 'error')
        onLog(`Clear failed for ${group.name}`, result.error)
        return
      }
      onDraftClearSecrets()
      setEditingSecrets({})
      setVisibleValues({})
      onTestFeedbackClear()
      onToast(`${group.name} credentials cleared.`, 'info')
      onLog(`Credentials cleared`, group.name)
      onRefresh()
    } finally {
      setClearing(false)
    }
  }

  const fieldValue = useCallback(
    (field: CredentialGroupDef['fields'][number]) => {
      const key = field.storageKey
      const configured = fieldStatus[key]?.configured
      const raw = draft[key] ?? ''

      if (configured && !editingSecrets[key] && raw === '') {
        return MASK
      }
      return raw
    },
    [draft, editingSecrets, fieldStatus],
  )

  const onFieldFocus = (field: CredentialGroupDef['fields'][number]) => {
    const key = field.storageKey
    if (fieldStatus[key]?.configured && !editingSecrets[key]) {
      setEditingSecrets((prev) => ({ ...prev, [key]: true }))
      onDraftChange(key, '')
    }
  }

  const onFieldChange = (field: CredentialGroupDef['fields'][number], value: string) => {
    if (value === MASK) return
    onDraftChange(field.storageKey, value)
  }

  if (showAmazonSavedOnly) {
    return (
      <Box sx={{ pt: embeddedInSection ? 0.5 : 0 }}>
        <Typography sx={{ fontSize: '12px', color: 'text.primary' }}>Credentials saved.</Typography>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        p: embeddedInSection ? 0 : 2,
        pt: embeddedInSection ? 0.5 : 2,
        borderRadius: 0.5,
        border: embeddedInSection ? 'none' : '1px solid',
        borderColor: 'divider',
        display: 'grid',
        gap: 1.25,
      }}
    >
      <Box
        sx={{
          display: minimalUi ? 'none' : 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 1,
          flexWrap: 'wrap',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          {!embeddedInSection && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
              <Typography sx={{ fontSize: '13px', fontWeight: 700 }}>{group.name}</Typography>
              <Chip
                size="small"
                label={CATEGORY_LABEL[group.category] ?? group.category}
                variant="outlined"
                sx={{ height: 20, fontSize: '9px', fontWeight: 700, borderRadius: 0.5 }}
              />
              {group.id === 'claude_ai' && (
                <Chip
                  size="small"
                  label={`${AI_QC_MODEL_DISPLAY_NAME} · ${DEFAULT_AI_QC_MODEL}`}
                  variant="outlined"
                  color="primary"
                  sx={{ height: 20, fontSize: '9px', fontWeight: 700, borderRadius: 0.5 }}
                />
              )}
            </Box>
          )}
          {!minimalUi && group.description && (
            <Typography sx={{ fontSize: '11px', color: 'text.secondary', mt: embeddedInSection ? 0 : 0.25 }}>
              {group.description}
            </Typography>
          )}
          {!minimalUi && group.id === 'claude_ai' && embeddedInSection && (
            <Chip
              size="small"
              label={`QC model: ${AI_QC_MODEL_DISPLAY_NAME} (${DEFAULT_AI_QC_MODEL})`}
              variant="outlined"
              color="primary"
              sx={{ height: 20, fontSize: '9px', fontWeight: 700, borderRadius: 0.5, mt: 0.75 }}
            />
          )}
        </Box>
        <Chip
          size="small"
          label={statusLabel}
          color={statusColor}
          variant="outlined"
          sx={{ height: 22, fontSize: '10px', fontWeight: 700, borderRadius: 0.5 }}
        />
      </Box>

      <Box sx={{ display: 'grid', gap: 1 }}>
        {group.fields.map((field) => {
          const secret = isFieldSecret(field)
          const configured = fieldStatus[field.storageKey]?.configured
          const display = fieldValue(field)
          const masked = display === MASK
          const key = field.storageKey
          const showValue = Boolean(visibleValues[key])
          const inputType = secret && !showValue ? 'password' : field.kind === 'email' ? 'email' : 'text'

          const helperText =
            minimalUi
              ? undefined
              : configured && !editingSecrets[key]
                ? 'Stored securely — click to replace'
                : field.required === false
                  ? 'Optional'
                  : undefined

          return (
            <TextField
              key={field.storageKey}
              fullWidth
              size="small"
              label={minimalUi ? undefined : field.label}
              required={minimalUi ? false : field.required !== false}
              type={inputType}
              autoComplete="off"
              placeholder={field.placeholder}
              value={display}
              onFocus={() => onFieldFocus(field)}
              onChange={(e) => onFieldChange(field, e.target.value)}
              sx={fieldSx}
              helperText={helperText}
              slotProps={{
                input: masked
                  ? {
                      readOnly: true,
                      endAdornment: secret ? (
                        <InputAdornment position="end">
                          <IconButton
                            size="small"
                            edge="end"
                            aria-label={showValue ? 'Hide value' : 'Show value'}
                            onClick={() =>
                              setVisibleValues((prev) => ({ ...prev, [key]: !prev[key] }))
                            }
                            onMouseDown={(e) => e.preventDefault()}
                            disabled={!editingSecrets[key]}
                          >
                            {showValue ? (
                              <VisibilityOff sx={{ fontSize: 18 }} />
                            ) : (
                              <Visibility sx={{ fontSize: 18 }} />
                            )}
                          </IconButton>
                        </InputAdornment>
                      ) : undefined,
                    }
                  : secret
                    ? {
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              size="small"
                              edge="end"
                              aria-label={showValue ? 'Hide value' : 'Show value'}
                              onClick={() =>
                                setVisibleValues((prev) => ({ ...prev, [key]: !prev[key] }))
                              }
                              onMouseDown={(e) => e.preventDefault()}
                            >
                              {showValue ? (
                                <VisibilityOff sx={{ fontSize: 18 }} />
                              ) : (
                                <Visibility sx={{ fontSize: 18 }} />
                              )}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }
                    : undefined,
                formHelperText: helperText ? { sx: { fontSize: '10px', m: 0, mt: 0.35 } } : undefined,
              }}
            />
          )
        })}
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        {minimalUi ? (
          <Button
            variant="contained"
            size="small"
            disabled={saving || !canSave}
            onClick={handleSaveAndTest}
            sx={{ height: 30, fontSize: '11px', fontWeight: 600, borderRadius: 0.5 }}
          >
            {saving ? <CircularProgress size={16} color="inherit" /> : 'Save & Test'}
          </Button>
        ) : (
          <>
            <Button
              variant="contained"
              size="small"
              disabled={saving || !canSave}
              onClick={handleSave}
              sx={{ height: 30, fontSize: '11px', fontWeight: 600, borderRadius: 0.5 }}
            >
              {saving ? <CircularProgress size={16} color="inherit" /> : 'Save'}
            </Button>
            <Button
              variant="outlined"
              size="small"
              disabled={testing || !canTest}
              onClick={handleTest}
              sx={{
                height: 30,
                minWidth: testing ? 36 : undefined,
                fontSize: '11px',
                fontWeight: 600,
                borderRadius: 0.5,
              }}
            >
              {testing ? <CircularProgress size={16} /> : group.testActionLabel}
            </Button>
            <Button
              variant="outlined"
              size="small"
              color="error"
              disabled={clearing || !anyConfigured}
              onClick={() => setClearConfirmOpen(true)}
              sx={{ height: 30, fontSize: '11px', fontWeight: 600, borderRadius: 0.5 }}
            >
              {clearing ? <CircularProgress size={16} /> : 'Forget'}
            </Button>
          </>
        )}
      </Box>

      {(!minimalUi || testing || testFeedback.status !== 'idle') && (
        <CredentialTestFeedbackPanel
          feedback={
            testing && testFeedback.status === 'idle'
              ? { status: 'running', headline: '', lines: [] }
              : testFeedback
          }
          runningLabel={`Running ${group.testActionLabel.toLowerCase()}…`}
          onCopied={() => onToast('Test log copied', 'success')}
          onCopyFailed={() => onToast('No test log to copy yet', 'info')}
        />
      )}

      <ConfirmDialog
        open={clearConfirmOpen}
        title={`Forget ${group.name} credentials?`}
        message="This permanently removes all saved values for this group from secure storage on this device."
        confirmLabel="Forget credentials"
        cancelLabel="Keep saved"
        confirmColor="error"
        onClose={() => setClearConfirmOpen(false)}
        onConfirm={handleClear}
      >
        <Alert severity="warning" sx={{ mt: 1.5, borderRadius: 0.5, fontSize: '11px', py: 0.25 }}>
          Saved secrets cannot be recovered after clearing. You will need to enter and save them again.
        </Alert>
      </ConfirmDialog>
    </Box>
  )
}
