import { Chip, useTheme } from '@mui/material'
import type { QcCompareOutcome } from '../../utils/qcThresholdComparison'
import { outcomeYesNoLabel } from '../../utils/liveOutputDisplay'

type Props = {
  outcome: QcCompareOutcome
}

export function CompareOutcomeChip({ outcome }: Props) {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const label = outcomeYesNoLabel(outcome)
  const tone =
    label === 'YES' ? 'success' : label === 'NO' ? 'error' : 'warning'

  return (
    <Chip
      size="small"
      label={label}
      color={tone}
      variant={isDark ? 'outlined' : 'filled'}
      sx={{
        height: 22,
        minWidth: 44,
        fontSize: '10px',
        fontWeight: 800,
        letterSpacing: '0.06em',
        borderRadius: 0.5,
        ...(isDark && {
          bgcolor: 'transparent',
          borderColor: `${tone}.main`,
          color: `${tone}.main`,
        }),
      }}
    />
  )
}
