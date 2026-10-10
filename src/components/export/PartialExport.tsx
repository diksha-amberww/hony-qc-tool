import { useBatchDemo } from '../../context/BatchDemoContext'
import { useQcToolVendorDisplayName } from '../../context/QcToolConfigContext'
import { ExportBatchPanel } from './ExportBatchPanel'

export function PartialExport() {
  const { completed, total } = useBatchDemo()
  const vendorDisplayName = useQcToolVendorDisplayName()

  return (
    <ExportBatchPanel
      title="Partial export"
      statusText={`${completed.length} finished`}
      rows={completed}
      batchTotal={total}
      vendorDisplayName={vendorDisplayName}
      exportEnabled={completed.length > 0}
      exportScope="partial"
    />
  )
}
