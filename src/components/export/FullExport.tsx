import { useBatchDemo } from '../../context/BatchDemoContext'
import { useQcToolVendorDisplayName } from '../../context/QcToolConfigContext'
import { ExportBatchPanel } from './ExportBatchPanel'

export function FullExport() {
  const { completed, total } = useBatchDemo()
  const vendorDisplayName = useQcToolVendorDisplayName()
  const batchComplete = total > 0 && completed.length >= total

  const statusText = batchComplete
    ? `${completed.length} / ${total}`
    : `${completed.length} / ${total > 0 ? total : '—'} · finish batch to unlock`

  return (
    <ExportBatchPanel
      title="Full export"
      statusText={statusText}
      rows={completed}
      batchTotal={total}
      vendorDisplayName={vendorDisplayName}
      exportEnabled={batchComplete}
      exportScope="full"
    />
  )
}
