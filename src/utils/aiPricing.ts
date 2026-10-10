/** Claude Haiku 4.5 — per million tokens */
export const HAIKU_INPUT_PER_M = 1
export const HAIKU_OUTPUT_PER_M = 5

export function tokenCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * HAIKU_INPUT_PER_M + (outputTokens / 1_000_000) * HAIKU_OUTPUT_PER_M
}

export function formatUsd(n: number): string {
  if (n < 0.01 && n > 0) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}
