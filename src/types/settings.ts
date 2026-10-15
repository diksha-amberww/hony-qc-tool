import {
  DEFAULT_AI_INPUT_PRICE_PER_M,
  DEFAULT_AI_OUTPUT_PRICE_PER_M,
  DEFAULT_AI_QC_MODEL,
} from '../config/aiQc'
import type { AiQcPricingSettings } from '../config/aiQc'

export type { AiQcPricingSettings } from '../config/aiQc'

/** Vendor-neutral application settings (persisted locally). */

/** Allowed range for Title / Image similarity thresholds in Settings. */
export const QC_SIMILARITY_THRESHOLD_MIN = 5
export const QC_SIMILARITY_THRESHOLD_MAX = 100

export type QcThresholdSettings = {
  /** Min title similarity required to pass (5–100). */
  titleSimilarityPercent: number
  /** Min image similarity required to pass (5–100). */
  imageSimilarityPercent: number
}

export type QcAiCostSettings = {
  /** Skip title LLM when lexical similarity is very high/low. */
  qcTitleLexicalHybrid: boolean
  /** Skip vision when strong pass/fail signals agree (UPC+model+title+pack+brand). */
  qcAggressiveAiCostMode: boolean
  /** Call Claude for ambiguous model numbers when local match fails. */
  qcModelAiEnabled: boolean
}

export type ScrapingBehaviorSettings = {
  /** When true, authenticate before scraping (SWDT-style); when false, scrape without login (GLID-style). */
  vendorLoginRequired: boolean
  /** Reuse an authenticated vendor session when available. */
  reuseVendorSession: boolean
  /** Run vendor browser headless; when false, allow a visible window. */
  headlessScraping: boolean
}

export const ERROR_ENGINE_RETRY_MIN = 3
export const ERROR_ENGINE_RETRY_MAX = 5
export const ERROR_ENGINE_BACKOFF_MIN_MS = 500
export const ERROR_ENGINE_BACKOFF_MAX_MS = 30_000

export type ErrorEngineSettings = {
  /** Global automatic scrape error recovery (pause → relogin → resume). */
  errorEngineEnabled: boolean
  /** Relogin attempts after a scrape failure (3–5). */
  errorEngineMaxRetries: number
  /** Base delay (ms) for exponential backoff between relogin attempts. */
  errorEngineBackoffBaseMs: number
}

export type AppSettings = QcThresholdSettings &
  QcAiCostSettings &
  ScrapingBehaviorSettings &
  ErrorEngineSettings &
  AiQcPricingSettings

export const DEFAULT_APP_SETTINGS: AppSettings = {
  titleSimilarityPercent: 70,
  imageSimilarityPercent: 70,
  qcTitleLexicalHybrid: true,
  qcAggressiveAiCostMode: false,
  qcModelAiEnabled: false,
  vendorLoginRequired: true,
  reuseVendorSession: true,
  headlessScraping: true,
  errorEngineEnabled: true,
  errorEngineMaxRetries: 4,
  errorEngineBackoffBaseMs: 2000,
  aiQcModelId: DEFAULT_AI_QC_MODEL,
  aiInputPricePerMillionUsd: DEFAULT_AI_INPUT_PRICE_PER_M,
  aiOutputPricePerMillionUsd: DEFAULT_AI_OUTPUT_PRICE_PER_M,
}

export const AI_QC_PRICING_KEYS: (keyof AiQcPricingSettings)[] = [
  'aiQcModelId',
  'aiInputPricePerMillionUsd',
  'aiOutputPricePerMillionUsd',
]

export const QC_THRESHOLD_KEYS: (keyof QcThresholdSettings)[] = [
  'titleSimilarityPercent',
  'imageSimilarityPercent',
]

export const QC_AI_COST_KEYS: (keyof QcAiCostSettings)[] = [
  'qcTitleLexicalHybrid',
  'qcAggressiveAiCostMode',
  'qcModelAiEnabled',
]

export const SCRAPING_BEHAVIOR_KEYS: (keyof ScrapingBehaviorSettings)[] = [
  'vendorLoginRequired',
  'reuseVendorSession',
  'headlessScraping',
]

export const ERROR_ENGINE_KEYS: (keyof ErrorEngineSettings)[] = [
  'errorEngineEnabled',
  'errorEngineMaxRetries',
  'errorEngineBackoffBaseMs',
]
