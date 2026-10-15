import { formatUsd, tokenCostUsd } from './aiQcConfig.mjs'

/** @type {{ skus: number, inputTokens: number, outputTokens: number }} */
let sessionTotals = { skus: 0, inputTokens: 0, outputTokens: 0 }

/** @type {Record<string, { inputTokens: number, outputTokens: number, calls: number }>} */
let labelTotals = {}

/**
 * @param {{ inputTokens: number, outputTokens: number, rates?: { inputPerM?: number, outputPerM?: number }, label?: string }} entry
 */
export function recordAiCallUsage(entry) {
  const inputTokens = Math.max(0, Number(entry.inputTokens) || 0)
  const outputTokens = Math.max(0, Number(entry.outputTokens) || 0)
  const callCost = tokenCostUsd(inputTokens, outputTokens, entry.rates)
  const runningCost = tokenCostUsd(
    sessionTotals.inputTokens + inputTokens,
    sessionTotals.outputTokens + outputTokens,
    entry.rates,
  )

  console.log('Input tokens used:', inputTokens)
  console.log('Output tokens used:', outputTokens)
  console.log(`Call cost (USD): ${formatUsd(callCost)}`)
  console.log(`Running total cost (USD): ${formatUsd(runningCost)}`)
  if (entry.label) {
    console.log(`AI usage context: ${entry.label}`)
    const key = String(entry.label)
    const prev = labelTotals[key] ?? { inputTokens: 0, outputTokens: 0, calls: 0 }
    labelTotals[key] = {
      inputTokens: prev.inputTokens + inputTokens,
      outputTokens: prev.outputTokens + outputTokens,
      calls: prev.calls + 1,
    }
  }

  sessionTotals.inputTokens += inputTokens
  sessionTotals.outputTokens += outputTokens
}

export function recordAiSkuProcessed() {
  sessionTotals.skus += 1
  logBatchMetricsSummary()
}

export function resetAiUsageMetrics() {
  sessionTotals = { skus: 0, inputTokens: 0, outputTokens: 0 }
  labelTotals = {}
  console.log('AI usage metrics reset.')
}

/**
 * @param {{ inputPerM?: number, outputPerM?: number }} [rates]
 */
export function logBatchMetricsSummary(rates = {}) {
  const totalCost = tokenCostUsd(sessionTotals.inputTokens, sessionTotals.outputTokens, rates)
  const perSku = sessionTotals.skus > 0 ? totalCost / sessionTotals.skus : 0
  console.log('--- QC AI batch metrics ---')
  console.log(`Total SKUs processed: ${sessionTotals.skus}`)
  console.log(`Total input tokens: ${sessionTotals.inputTokens}`)
  console.log(`Total output tokens: ${sessionTotals.outputTokens}`)
  console.log(`Total cost so far: ${formatUsd(totalCost)}`)
  console.log(`Cost per SKU (avg): ${sessionTotals.skus > 0 ? formatUsd(perSku) : '—'}`)
  console.log(`Projected cost for 1000 SKUs: ${formatUsd(perSku * 1000)}`)
  console.log(`Projected cost for 10000 SKUs: ${formatUsd(perSku * 10000)}`)
  const labels = Object.keys(labelTotals)
  if (labels.length > 0) {
    console.log('--- Per AI call type ---')
    for (const label of labels.sort()) {
      const row = labelTotals[label]
      const cost = tokenCostUsd(row.inputTokens, row.outputTokens, rates)
      console.log(
        `${label}: ${row.calls} calls, ${row.inputTokens} in / ${row.outputTokens} out, ${formatUsd(cost)}`,
      )
    }
  }
  console.log('---------------------------')
}

export function getAiUsageMetricsSnapshot() {
  return {
    ...sessionTotals,
    byLabel: Object.fromEntries(
      Object.entries(labelTotals).map(([label, row]) => [label, { ...row }]),
    ),
  }
}
