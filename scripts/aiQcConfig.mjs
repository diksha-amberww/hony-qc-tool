/** Shared defaults for QC Anthropic calls (mirrored in src/config/aiQc.ts). */
export const DEFAULT_AI_QC_MODEL = 'claude-haiku-5-5'

export const AI_QC_MODEL_DISPLAY_NAME = 'Claude Haiku 5.5'

export const DEFAULT_AI_INPUT_PRICE_PER_M = 0.25
export const DEFAULT_AI_OUTPUT_PRICE_PER_M = 1.25

/** Retired Haiku models upgraded automatically to Haiku 5.5 API id. */
export const LEGACY_AI_QC_MODEL_IDS = new Set([
  'claude-3-5-haiku-20241022',
  'claude-3-5-haiku-latest',
  'claude-3-haiku-20240307',
  'claude-haiku-4-5-20251001',
  'claude-haiku-4-5',
])

/** User-facing labels / typos → Anthropic `model` parameter (Haiku 5.5). */
const AI_QC_MODEL_DISPLAY_ALIASES = new Set([
  'claude haiku 5.5',
  'haiku 5.5',
  'claude-haiku-5.5',
])

/**
 * @param {unknown} modelId
 * @returns {string} Valid Anthropic Messages API model id (never a display label).
 */
export function normalizeAiQcModelId(modelId) {
  const id = String(modelId ?? '').trim()
  if (!id) return DEFAULT_AI_QC_MODEL

  const lower = id.toLowerCase()
  if (lower === AI_QC_MODEL_DISPLAY_NAME.toLowerCase() || AI_QC_MODEL_DISPLAY_ALIASES.has(lower)) {
    return DEFAULT_AI_QC_MODEL
  }

  if (LEGACY_AI_QC_MODEL_IDS.has(id)) {
    return DEFAULT_AI_QC_MODEL
  }

  // Reject human-readable labels mistakenly stored as model id.
  if (!/^claude-[a-z0-9.-]+$/i.test(id)) {
    return DEFAULT_AI_QC_MODEL
  }

  return id
}

/**
 * @param {Record<string, unknown> | null | undefined} settings
 */
export function resolveAiQcConfig(settings) {
  const s = settings && typeof settings === 'object' ? settings : {}
  const model = normalizeAiQcModelId(s.aiQcModelId ?? s.aiModelId)
  const inputPerM = positiveRate(s.aiInputPricePerMillionUsd, DEFAULT_AI_INPUT_PRICE_PER_M)
  const outputPerM = positiveRate(s.aiOutputPricePerMillionUsd, DEFAULT_AI_OUTPUT_PRICE_PER_M)
  return { model, inputPerM, outputPerM }
}

function positiveRate(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  return n
}

/**
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @param {{ inputPerM?: number, outputPerM?: number }} [rates]
 */
export function tokenCostUsd(inputTokens, outputTokens, rates = {}) {
  const inputPerM = rates.inputPerM ?? DEFAULT_AI_INPUT_PRICE_PER_M
  const outputPerM = rates.outputPerM ?? DEFAULT_AI_OUTPUT_PRICE_PER_M
  const input = Math.max(0, Number(inputTokens) || 0)
  const output = Math.max(0, Number(outputTokens) || 0)
  return (input / 1_000_000) * inputPerM + (output / 1_000_000) * outputPerM
}

export function formatUsd(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '$0.00'
  if (v > 0 && v < 0.01) return `$${v.toFixed(4)}`
  return `$${v.toFixed(2)}`
}
