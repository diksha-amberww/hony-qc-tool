/** Anthropic QC model + pricing defaults (keep in sync with scripts/aiQcConfig.mjs). */
export const DEFAULT_AI_QC_MODEL = 'claude-haiku-5-5'

/** User-facing model name in Settings, AI costs, Credentials, and related UI. */
export const AI_QC_MODEL_DISPLAY_NAME = 'Claude Haiku 5.5'

export const DEFAULT_AI_INPUT_PRICE_PER_M = 0.25
export const DEFAULT_AI_OUTPUT_PRICE_PER_M = 1.25

/** Retired Haiku models upgraded automatically to Haiku 5.5. */
export const LEGACY_AI_QC_MODEL_IDS = new Set([
  'claude-3-5-haiku-20241022',
  'claude-3-5-haiku-latest',
  'claude-3-haiku-20240307',
  'claude-haiku-4-5-20251001',
  'claude-haiku-4-5',
])

const AI_QC_MODEL_DISPLAY_ALIASES = new Set([
  'claude haiku 5.5',
  'haiku 5.5',
  'claude-haiku-5.5',
])

export function normalizeAiQcModelId(modelId: unknown): string {
  const id = String(modelId ?? '').trim()
  if (!id) return DEFAULT_AI_QC_MODEL

  const lower = id.toLowerCase()
  if (lower === AI_QC_MODEL_DISPLAY_NAME.toLowerCase() || AI_QC_MODEL_DISPLAY_ALIASES.has(lower)) {
    return DEFAULT_AI_QC_MODEL
  }

  if (LEGACY_AI_QC_MODEL_IDS.has(id)) {
    return DEFAULT_AI_QC_MODEL
  }

  if (!/^claude-[a-z0-9.-]+$/i.test(id)) {
    return DEFAULT_AI_QC_MODEL
  }

  return id
}

export type AiQcPricingSettings = {
  aiQcModelId: string
  aiInputPricePerMillionUsd: number
  aiOutputPricePerMillionUsd: number
}

export const DEFAULT_AI_QC_PRICING: AiQcPricingSettings = {
  aiQcModelId: DEFAULT_AI_QC_MODEL,
  aiInputPricePerMillionUsd: DEFAULT_AI_INPUT_PRICE_PER_M,
  aiOutputPricePerMillionUsd: DEFAULT_AI_OUTPUT_PRICE_PER_M,
}

export type AiQcRates = {
  inputPerM: number
  outputPerM: number
}

export function resolveAiQcRates(settings: Partial<AiQcPricingSettings> | null | undefined): AiQcRates {
  return {
    inputPerM: positiveRate(settings?.aiInputPricePerMillionUsd, DEFAULT_AI_INPUT_PRICE_PER_M),
    outputPerM: positiveRate(settings?.aiOutputPricePerMillionUsd, DEFAULT_AI_OUTPUT_PRICE_PER_M),
  }
}

export function resolveAiQcModelId(settings: Partial<AiQcPricingSettings> | null | undefined): string {
  return normalizeAiQcModelId(settings?.aiQcModelId)
}

function positiveRate(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  return n
}
