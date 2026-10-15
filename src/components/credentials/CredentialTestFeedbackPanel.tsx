import { Box, Typography } from '@mui/material'
import type { CredentialTestFeedback } from '../../types/credentials'
import { CopyLogTextButton } from '../logs'

type Props = {
  feedback: CredentialTestFeedback
  runningLabel: string
  onCopyFailed?: () => void
  onCopied?: () => void
}

function buildTestLogClipboardText(feedback: CredentialTestFeedback, runningLabel: string): string {
  const lines: string[] = []
  if (feedback.status === 'running') {
    lines.push(runningLabel)
  } else if (feedback.headline) {
    lines.push(feedback.headline)
  }
  lines.push(...feedback.lines)
  return lines.join('\n')
}

/**
 * eKeystone-style bordered test result panel (success = green, failure = red).
 */
export function CredentialTestFeedbackPanel({
  feedback,
  runningLabel,
  onCopyFailed,
  onCopied,
}: Props) {
  if (feedback.status === 'idle') return null

  const isRunning = feedback.status === 'running'
  const isSuccess = feedback.status === 'success'
  const borderColor = isRunning ? 'divider' : isSuccess ? 'success.main' : 'error.main'

  return (
    <Box
      sx={{
        border: '2px solid',
        borderColor,
        borderRadius: 1,
        p: 1.5,
        minHeight: 96,
        maxHeight: 280,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: (theme) =>
          theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          flexShrink: 0,
          mb: feedback.lines.length || isRunning ? 0.75 : 0,
        }}
      >
        <CopyLogTextButton
          getText={() => buildTestLogClipboardText(feedback, runningLabel)}
          copyTooltip="Copy test log (Amazon / vendor / Claude steps)"
          emptyTooltip="No test log lines yet"
          onCopied={onCopied}
          onCopyFailed={onCopyFailed}
        />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      {isRunning && (
        <Typography
          sx={{ fontSize: '12px', fontWeight: 600, color: 'text.secondary', mb: feedback.lines.length ? 1 : 0 }}
        >
          {runningLabel}
        </Typography>
      )}
      {!isRunning && feedback.headline && (
        <Typography
          sx={{
            fontSize: '12px',
            fontWeight: 700,
            color: isSuccess ? 'success.main' : 'error.main',
            lineHeight: 1.45,
            mb: feedback.lines.length ? 1 : 0,
          }}
        >
          {feedback.headline}
        </Typography>
      )}
      {feedback.lines.map((line, index) => (
        <Typography
          key={`${index}-${line.slice(0, 32)}`}
          component="div"
          sx={{
            fontSize: '11px',
            color: 'text.secondary',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {line}
        </Typography>
      ))}
      </Box>
    </Box>
  )
}
