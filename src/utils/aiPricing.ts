import {
  DEFAULT_AI_INPUT_PRICE_PER_M,
  DEFAULT_AI_OUTPUT_PRICE_PER_M,
  type AiQcPricingSettings,
  type AiQcRates,
  resolveAiQcRates,
} from '../config/aiQc'

export { DEFAULT_AI_INPUT_PRICE_PER_M as HAIKU_INPUT_PER_M }
export { DEFAULT_AI_OUTPUT_PRICE_PER_M as HAIKU_OUTPUT_PER_M }

export function tokenCostUsd(
  inputTokens: number,
  outputTokens: number,
  settings?: Partial<AiQcPricingSettings> | null,
): number {
  const rates: AiQcRates = settings ? resolveAiQcRates(settings) : {
    inputPerM: DEFAULT_AI_INPUT_PRICE_PER_M,
    outputPerM: DEFAULT_AI_OUTPUT_PRICE_PER_M,
  }
  const input = Math.max(0, inputTokens)
  const output = Math.max(0, outputTokens)
  return (input / 1_000_000) * rates.inputPerM + (output / 1_000_000) * rates.outputPerM
}

export function formatUsd(n: number): string {
  if (n < 0.01 && n > 0) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}
