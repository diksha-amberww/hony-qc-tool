import { Box, Typography } from '@mui/material'
import type { CredentialTestFeedback } from '../../types/credentials'

type Props = {
  feedback: CredentialTestFeedback
  runningLabel: string
}

/**
 * eKeystone-style bordered test result panel (success = green, failure = red).
 */
export function CredentialTestFeedbackPanel({ feedback, runningLabel }: Props) {
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
        overflow: 'auto',
        bgcolor: (theme) =>
          theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
      }}
    >
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
  )
}
