import type { QcPipelineRequest, QcPipelineResponse } from '../../types/qcPipeline'

function pipelineBridge() {
  return typeof window !== 'undefined' ? window.electronAPI?.qc : undefined
}

/** Run full QC pipeline in Electron main (SP-API + vendor scrape + runQC + Excel). */
export async function runQcPipelineExport(
  request: QcPipelineRequest,
): Promise<QcPipelineResponse> {
  const bridge = pipelineBridge()
  if (!bridge?.runPipelineExport) {
    return {
      ok: false,
      phase: 'input',
      error: 'QC pipeline is only available in the Electron app.',
    }
  }
  return bridge.runPipelineExport(request)
}

export async function revealQcExportFile(filePath: string): Promise<{ ok: boolean }> {
  const bridge = pipelineBridge()
  if (!bridge?.revealExportFile) {
    return { ok: false }
  }
  return bridge.revealExportFile({ filePath })
}
