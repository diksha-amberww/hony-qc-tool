import {
  AI_QC_MODEL_DISPLAY_NAME,
  DEFAULT_AI_QC_MODEL,
  normalizeAiQcModelId,
  resolveAiQcConfig,
} from './aiQcConfig.mjs'
import { recordAiCallUsage } from './aiUsageMetrics.mjs'
import { prepareVisionImage, preferCatalogImageUrl } from './qcImagePrep.mjs'
import {
  capPixelFallbackImageScore,
  mergeImageSimilarityScores,
  visualSimilarityPercentFromBase64,
} from './qcVisualFallback.mjs'

/**
 * @param {string} apiKey
 * @param {Array<{ role: string, content: unknown }>} messages
 * @param {object} [options]
 * @param {string} [options.model]
 * @param {number} [options.maxTokens]
 * @param {string} [options.system]
 * @param {{ inputPerM?: number, outputPerM?: number }} [options.rates]
 * @param {string} [options.label]
 */
async function anthropicMessages(apiKey, messages, options = {}) {
  const aiConfig = resolveAiQcConfig({
    ...options,
    aiQcModelId: options.aiQcModelId ?? options.model,
  })
  const model = normalizeAiQcModelId(aiConfig.model || DEFAULT_AI_QC_MODEL)
  const maxTokens = options.maxTokens ?? 64
  const system = typeof options.system === 'string' ? options.system.trim() : ''

  console.log(`Anthropic QC request — ${AI_QC_MODEL_DISPLAY_NAME} (model: ${model})`)

  const requestBody = {
    model,
    max_tokens: maxTokens,
    messages,
  }
  if (system) requestBody.system = system
  if (typeof options.temperature === 'number' && Number.isFinite(options.temperature)) {
    requestBody.temperature = options.temperature
  }

  const label = options.label ?? 'anthropic'
  let requestBodyJson = ''
  try {
    requestBodyJson = JSON.stringify(requestBody)
  } catch (stringifyErr) {
    const msg =
      stringifyErr instanceof Error ? stringifyErr.message : String(stringifyErr)
    console.error(`[anthropicMessages][${label}] Failed to JSON.stringify request body:`, msg)
    throw new Error(`Anthropic request serialization failed: ${msg}`)
  }

  let res
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: requestBodyJson,
    })
  } catch (networkErr) {
    const msg = networkErr instanceof Error ? networkErr.message : String(networkErr)
    console.error(`[anthropicMessages][${label}] fetch() failed:`, msg, networkErr)
    throw new Error(`Anthropic network error: ${msg}`)
  }

  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof body?.error?.message === 'string' ? body.error.message : `HTTP ${res.status}`
    const type = typeof body?.error?.type === 'string' ? body.error.type : ''
    console.error(
      `[anthropicMessages][${label}] API error HTTP ${res.status}`,
      type ? `type=${type}` : '',
      detail,
      JSON.stringify(body).slice(0, 2000),
    )
    throw new Error(`Anthropic API error: ${detail}`)
  }

  const textBlock = Array.isArray(body.content)
    ? body.content.find((b) => b?.type === 'text')
    : null
  const text = textBlock?.text ?? ''
  const inputTokens = Number(body.usage?.input_tokens) || 0
  const outputTokens = Number(body.usage?.output_tokens) || 0

  if (outputTokens > 10 && options.label) {
    console.warn(
      `[QC AI] High output tokens (${outputTokens}) for ${options.label}:`,
      JSON.stringify(String(text).slice(0, 200)),
    )
  }

  recordAiCallUsage({
    inputTokens,
    outputTokens,
    rates: { inputPerM: aiConfig.inputPerM, outputPerM: aiConfig.outputPerM },
    label: options.label,
  })

  return {
    text,
    usage: body.usage ?? {},
    model,
    inputTokens,
    outputTokens,
    stopReason: body.stop_reason ?? '',
  }
}

/**
 * Anthropic vision expects raw base64 in `data` (not a data: URI). Strips accidental prefixes.
 * @param {string} data
 * @param {string} [mediaType]
 */
export function anthropicBase64ImageSource(data, mediaType = 'image/jpeg') {
  let raw = String(data ?? '').trim()
  let type = String(mediaType ?? 'image/jpeg').trim() || 'image/jpeg'
  const dataUri = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(raw)
  if (dataUri) {
    type = dataUri[1].toLowerCase()
    raw = dataUri[2]
  }
  raw = raw.replace(/\s/g, '')
  return { type: 'base64', media_type: type, data: raw }
}

/**
 * @param {string} message
 * @param {{ inputTokens?: number, outputTokens?: number, rawText?: string }} [meta]
 */
function aiResponseError(message, meta = {}) {
  const raw = meta.rawText != null ? String(meta.rawText).trim() : ''
  const err = new Error(raw ? `${message} Raw: ${raw.slice(0, 240)}` : message)
  err.inputTokens = Number(meta.inputTokens) || 0
  err.outputTokens = Number(meta.outputTokens) || 0
  return err
}

/** @param {unknown} value @param {string} [fallback] */
export function coerceAiPromptText(value, fallback = 'No Title Found') {
  const s = String(value ?? '').trim()
  if (!s || s === '—' || s === '-') return fallback
  return s
}

/** @param {unknown} value */
export function coerceAiImageUrl(value) {
  const s = String(value ?? '').trim()
  if (!s || s === '—' || s === '-') return ''
  return /^https?:\/\//i.test(s) ? s : ''
}

/**
 * @param {object} vendorData
 * @param {object} amazonData
 * @param {{ vendorTitle?: string, amazonTitle?: string, vendorImage?: string, amazonImage?: string }} resolved
 * @param {(line: string) => void} [onLine]
 */
export function logDebugAiInputs(vendorData, amazonData, resolved = {}, onLine) {
  const vendorTitle =
    resolved.vendorTitle ??
    coerceAiPromptText(vendorData?.title ?? vendorData?.productTitle, 'No Title Found')
  const amazonTitle =
    resolved.amazonTitle ??
    coerceAiPromptText(
      amazonData?.title ?? amazonData?.itemName ?? amazonData?.productTitle,
      'No Title Found',
    )
  const vendorImage =
    resolved.vendorImage ??
    (coerceAiImageUrl(vendorData?.imageUrl ?? vendorData?.image) || '(missing image URL)')
  const amazonImage =
    resolved.amazonImage ??
    (coerceAiImageUrl(amazonData?.imageUrl ?? amazonData?.image) || '(missing image URL)')

  const lines = [
    `DEBUG AI INPUT - Amazon Title: ${amazonTitle}`,
    `DEBUG AI INPUT - Vendor Title: ${vendorTitle}`,
    `DEBUG AI INPUT - Amazon Image: ${amazonImage}`,
    `DEBUG AI INPUT - Vendor Image: ${vendorImage}`,
  ]
  for (const line of lines) {
    console.log(line)
    onLine?.(line)
  }
}

/**
 * @param {string} text
 * @returns {number | null}
 */
function parseScoreFromModelText(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      const score = Number(parsed.score ?? parsed.similarity ?? parsed.similarityScore)
      if (Number.isFinite(score)) return clampScore(score)
    } catch {
      // fall through
    }
  }
  const numMatch = text.match(/\b(\d{1,3})\b/)
  if (numMatch) return clampScore(Number(numMatch[1]))
  return null
}

function clampScore(n) {
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, Math.round(n)))
}

/**
 * Strip formatting symbols; keep only lowercase alphanumeric (core sequence).
 * @param {string} value
 */
export function stripModelCoreAlphanumeric(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Longest contiguous substring of `shorter` that appears in `longer` (same sequence).
 * @param {string} shorter
 * @param {string} longer
 */
function longestSharedContiguousCore(shorter, longer) {
  if (!shorter || !longer) return 0
  let a = shorter
  let b = longer
  if (a.length > b.length) {
    a = longer
    b = shorter
  }
  let best = 0
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j <= a.length; j++) {
      const sub = a.slice(i, j)
      if (b.includes(sub) && sub.length > best) best = sub.length
    }
  }
  return best
}

/**
 * Lenient model/SKU match: symbol-insensitive, prefix/suffix tolerant, 50% core overlap rule.
 * @param {string} vendorModel
 * @param {string} amazonModel
 */
export function lenientModelNumberMatch(vendorModel, amazonModel) {
  const vendorCore = stripModelCoreAlphanumeric(vendorModel)
  const amazonCore = stripModelCoreAlphanumeric(amazonModel)
  if (!vendorCore || !amazonCore) return false
  if (vendorCore === amazonCore) return true

  const shorter =
    vendorCore.length <= amazonCore.length ? vendorCore : amazonCore
  const longer =
    vendorCore.length <= amazonCore.length ? amazonCore : vendorCore

  if (longer.includes(shorter)) return true

  const shared = longestSharedContiguousCore(shorter, longer)
  const minOverlap = Math.ceil(shorter.length * 0.5)
  return shared >= minOverlap
}

/**
 * @param {string} vendorModel
 * @param {string} amazonModel
 */
export function buildModelNumberMatchPrompt(vendorModel, amazonModel) {
  return `Same physical product? Compare vendor vs Amazon model/SKU. Ignore hyphens/spaces and vendor prefixes when the alphanumeric core matches (>=50% contiguous overlap of shorter core in longer). Reply ONLY: YES or NO.

Vendor: ${vendorModel || '(empty)'}
Amazon: ${amazonModel || '(empty)'}`
}

/**
 * @param {string} text
 * @returns {'YES' | 'NO' | 'REVIEW' | null}
 */
function parseYesNoReviewFromModelText(text) {
  const trimmed = String(text ?? '').trim()
  const upper = trimmed
    .toUpperCase()
    .replace(/[.!,]+$/g, '')
    .trim()
  if (upper === 'YES' || upper === 'NO' || upper === 'REVIEW') return upper
  const prefixed = upper.match(/^(?:ANSWER:\s*)(YES|NO|REVIEW)$/)
  return prefixed ? prefixed[1] : null
}

/** @param {string} text @returns {'YES' | 'NO' | null} */
function parseYesNoFromModelText(text) {
  const parsed = parseYesNoReviewFromModelText(text)
  if (parsed === 'REVIEW') return null
  return parsed
}

/**
 * @param {string} vendorModel
 * @param {string} amazonModel
 * @param {string} apiKey
 * @param {object} [options]
 */
const PRODUCT_MATCH_SYSTEM =
  'You output only a single JSON object with the exact keys requested. No markdown, preamble, or extra text.'

/** Room for JSON output; vision calls need headroom (low limits can yield stop_reason=max_tokens with empty text). */
const PRODUCT_MATCH_MAX_TOKENS = 1024

const TITLE_MISSING_PLACEHOLDER = 'No Title Found'

/**
 * @param {string} vendorTitle
 * @param {string} amazonTitle
 */
export function buildProductMatchPrompt(vendorTitle, amazonTitle) {
  return `Compare vendor vs Amazon listing for QC. Judge TITLE and IMAGE independently (title YES does not imply image YES).

TITLE — product identity, not word matching:
- YES only when both titles are the same sellable product a buyer would receive: same item, color, size, scent, flavor, and pack count. Extra Amazon marketing words stay YES.
- NO for a different product, color, size, scent, flavor, or count (e.g. strawberry vs mint, lubricant vs vibrator, cream vs skirt, red blindfold vs animal print).
- If a title is missing or identity cannot be determined, title_result is NO and title_match_percent is 0. Never omit title fields.

TITLE SCORING (title_match_percent must match title_result):
- Same product (title_result YES): 85–100 even when vendor title is short and word overlap is low.
- Different product (title_result NO): 0–10.

IMAGE — same product and variant in the photos. Apply this packaging rule in order:

1. Identify the product in each image, ignoring whether it is loose or boxed.
2. SAME packaging situation, score high (image_result YES, image_match_percent 90–100):
   - One side shows the product with no outer box.
   - The other side shows that same product, its retail box, or both the product and its box.
   - A box-only photo matches a product-only photo when the box is the outer package of that same product (same item, color, size, scent, count).
3. Different packaging of the product itself is NO, score low (0–10). Use this only when the package artwork, product line, color, size, scent, or count is a different product, not merely because one photo includes a box and the other does not.
4. Multiple products in one image: do not call it a match just because the expected product also appears. Image is YES only when both images are clearly that one product (or that one product plus its own box). A group shot, assortment, or a second different product makes image NO and image_match_percent 0–10.
5. Missing or unreadable image: image_result NO, image_match_percent 0. Never omit image fields.

IMAGE SCORING (image_match_percent must match image_result):
- Same product including loose vs boxed: 90–100.
- Different product, different package identity, or multiple products: 0–10.
- Missing image: 0.

Image 1 = vendor listing photo. Image 2 = Amazon listing photo.

Vendor title: ${vendorTitle || '(empty)'}
Amazon title: ${amazonTitle || '(empty)'}

Reply with JSON only in this exact shape (no other keys):
{"title_result":"YES|NO","title_match_percent":0-100,"image_result":"YES|NO","image_match_percent":0-100}`
}

/**
 * @param {string} text
 * @returns {{ titleResult: 'YES' | 'NO', titlePercent: number, imageResult: 'YES' | 'NO', imagePercent: number } | null}
 */
export function parseProductMatchFromModelText(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  let parsed
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    return null
  }
  const titleResult = String(parsed.title_result ?? '')
    .trim()
    .toUpperCase()
  const imageResult = String(parsed.image_result ?? '')
    .trim()
    .toUpperCase()
  if (titleResult !== 'YES' && titleResult !== 'NO') return null
  if (imageResult !== 'YES' && imageResult !== 'NO') return null
  const titlePercent = Number(parsed.title_match_percent)
  const imagePercent = Number(parsed.image_match_percent)
  if (!Number.isFinite(titlePercent) || !Number.isFinite(imagePercent)) return null
  return {
    titleResult,
    titlePercent: clampScore(titlePercent),
    imageResult,
    imagePercent: clampScore(imagePercent),
  }
}

/**
 * @param {{ titleResult: 'YES' | 'NO', titlePercent: number, imageResult: 'YES' | 'NO', imagePercent: number }} parsed
 */
export function applyProductMatchBanding(parsed) {
  let titlePercent = parsed.titlePercent ?? 0
  let imagePercent = parsed.imagePercent ?? 0
  if (parsed.titleResult === 'YES') {
    if (titlePercent < 85) titlePercent = 85
  } else if (titlePercent > 10) {
    titlePercent = 10
  }
  if (parsed.imageResult === 'YES') {
    if (imagePercent < 90) imagePercent = 90
  } else if (imagePercent > 10) {
    imagePercent = 10
  }
  return {
    titleResult: parsed.titleResult,
    titlePercent,
    imageResult: parsed.imageResult,
    imagePercent,
    titleSameProduct: parsed.titleResult === 'YES',
  }
}

const PRODUCT_MATCH_FAIL = {
  titleResult: 'NO',
  titlePercent: 0,
  imageResult: 'NO',
  imagePercent: 0,
  titleSameProduct: false,
}

function isTitleMissingForQc(title) {
  const s = String(title ?? '').trim()
  return !s || s === TITLE_MISSING_PLACEHOLDER
}

/**
 * One Claude call per SKU: both titles and both images together.
 * @param {string} vendorTitle
 * @param {string} amazonTitle
 * @param {string} vendorImageUrl
 * @param {string} amazonImageUrl
 * @param {string} apiKey
 * @param {object} [options]
 */
export async function scoreProductMatch(
  vendorTitle,
  amazonTitle,
  vendorImageUrl,
  amazonImageUrl,
  apiKey,
  options = {},
) {
  const debugLog = (line) => {
    console.log(line)
    if (typeof options.onDebugLog === 'function') options.onDebugLog(line)
  }

  const vendor = coerceAiPromptText(vendorTitle)
  const amazon = coerceAiPromptText(amazonTitle)
  const vendorUrl = preferCatalogImageUrl(coerceAiImageUrl(vendorImageUrl))
  const amazonUrl = preferCatalogImageUrl(coerceAiImageUrl(amazonImageUrl))

  debugLog('[QC product match][1 input] Vendor title: ' + JSON.stringify(vendorTitle ?? ''))
  debugLog('[QC product match][1 input] Amazon title: ' + JSON.stringify(amazonTitle ?? ''))
  debugLog('[QC product match][1 input] Coerced vendor title: ' + JSON.stringify(vendor))
  debugLog('[QC product match][1 input] Coerced amazon title: ' + JSON.stringify(amazon))
  debugLog(
    '[QC product match][1 input] Vendor image URL (raw): ' +
      JSON.stringify(String(vendorImageUrl ?? '').trim() || '(empty)'),
  )
  debugLog(
    '[QC product match][1 input] Amazon image URL (raw): ' +
      JSON.stringify(String(amazonImageUrl ?? '').trim() || '(empty)'),
  )
  debugLog(
    '[QC product match][1 input] Vendor image URL (coerced): ' +
      JSON.stringify(vendorUrl || '(invalid or missing)'),
  )
  debugLog(
    '[QC product match][1 input] Amazon image URL (coerced): ' +
      JSON.stringify(amazonUrl || '(invalid or missing)'),
  )

  logDebugAiInputs(
    { title: vendorTitle, productTitle: vendorTitle },
    { title: amazonTitle, itemName: amazonTitle },
    {
      vendorTitle: vendor,
      amazonTitle: amazon,
      vendorImage: vendorUrl || '(missing image URL)',
      amazonImage: amazonUrl || '(missing image URL)',
    },
  )

  if (!apiKey?.trim()) {
    throw aiResponseError('Anthropic API key is missing for product match comparison.')
  }

  let forceTitleNo = isTitleMissingForQc(vendor) || isTitleMissingForQc(amazon)
  let forceImageNo = !vendorUrl || !amazonUrl

  debugLog(
    '[QC product match][1 input] forceTitleNo=' +
      forceTitleNo +
      ' forceImageNo=' +
      forceImageNo +
      ' (before image download)',
  )

  let vendorImg = null
  let amazonImg = null
  if (!forceImageNo) {
    vendorImg = await prepareVisionImage(vendorUrl, { debugLabel: 'vendor' })
    amazonImg = await prepareVisionImage(amazonUrl, { debugLabel: 'amazon' })
    debugLog(
      '[QC product match][1 input] Vendor image download: ' +
        (vendorImg
          ? `ok mediaType=${vendorImg.mediaType} base64Chars=${String(vendorImg.data ?? '').length}`
          : 'FAILED'),
    )
    debugLog(
      '[QC product match][1 input] Amazon image download: ' +
        (amazonImg
          ? `ok mediaType=${amazonImg.mediaType} base64Chars=${String(amazonImg.data ?? '').length}`
          : 'FAILED'),
    )
    if (!vendorImg || !amazonImg) {
      forceImageNo = true
      vendorImg = null
      amazonImg = null
      debugLog(
        '[QC product match][1 input] forceImageNo=true after download failure; vision images omitted from API request',
      )
    }
  } else {
    debugLog(
      '[QC product match][1 input] Skipping image download (missing/invalid URL); API request is text-only for titles',
    )
  }

  const prompt = buildProductMatchPrompt(
    isTitleMissingForQc(vendor) ? '' : vendor,
    isTitleMissingForQc(amazon) ? '' : amazon,
  )

  /** @type {Array<{ type: string, source?: object, text?: string }>} */
  const content = []
  if (vendorImg && amazonImg) {
    content.push({
      type: 'image',
      source: anthropicBase64ImageSource(vendorImg.data, vendorImg.mediaType),
    })
    content.push({
      type: 'image',
      source: anthropicBase64ImageSource(amazonImg.data, amazonImg.mediaType),
    })
  }
  content.push({ type: 'text', text: prompt })

  let inputTokens = 0
  let outputTokens = 0
  let modelUsed = options.model ?? DEFAULT_AI_QC_MODEL
  const { onDebugLog: _omitDebug, maxTokens: _omitMaxTokens, ...anthropicOptions } = options

  const attemptCall = async (attemptIndex) => {
    const imageBlockCount = content.filter((b) => b.type === 'image').length
    const promptChars = prompt.length
    let approxPayloadBytes = 0
    try {
      approxPayloadBytes = JSON.stringify({
        role: 'user',
        content: content.map((block) => {
          if (block.type === 'image' && block.source?.data) {
            return {
              type: 'image',
              source: {
                type: block.source.type,
                media_type: block.source.media_type,
                dataLength: String(block.source.data).length,
              },
            }
          }
          return block
        }),
      }).length
    } catch (sizeErr) {
      const msg = sizeErr instanceof Error ? sizeErr.message : String(sizeErr)
      debugLog('[QC product match][1.5 payload] Could not estimate payload size: ' + msg)
      approxPayloadBytes = -1
    }
    debugLog(
      '[QC product match][1.5 payload] attempt=' +
        (attemptIndex + 1) +
        ' sending ' +
        imageBlockCount +
        ' image block(s), prompt text length: ' +
        promptChars +
        ', approx user-message JSON bytes (base64 counted by length): ' +
        approxPayloadBytes,
    )

    let apiResponse
    try {
      apiResponse = await anthropicMessages(
        apiKey,
        [{ role: 'user', content }],
        {
          ...anthropicOptions,
          maxTokens: PRODUCT_MATCH_MAX_TOKENS,
          system: PRODUCT_MATCH_SYSTEM,
          label: anthropicOptions.label ?? 'product match',
        },
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      debugLog(
        '[QC product match][API error] attempt=' +
          (attemptIndex + 1) +
          ' anthropicMessages threw: ' +
          msg,
      )
      console.error('[QC product match][API error] attempt=' + (attemptIndex + 1), err)
      throw err
    }

    const {
      text,
      inputTokens: inTok,
      outputTokens: outTok,
      model,
      stopReason,
    } = apiResponse
    inputTokens += inTok
    outputTokens += outTok
    modelUsed = model || modelUsed
    const rawResponse = String(text ?? '')
    debugLog(
      '[QC product match][2 raw AI response] attempt=' +
        (attemptIndex + 1) +
        ' model=' +
        (model || modelUsed) +
        ' stop_reason=' +
        (stopReason || '(none)') +
        ' charLength=' +
        rawResponse.length,
    )
    debugLog('[QC product match][2 raw AI response] body:\n' + rawResponse)
    const parsed = parseProductMatchFromModelText(rawResponse)
    debugLog(
      '[QC product match][3 parser] parseProductMatchFromModelText → ' +
        (parsed == null ? 'null (parse failed or invalid YES/NO/percents)' : JSON.stringify(parsed)),
    )
    if (!parsed) return null
    const banded = applyProductMatchBanding(parsed)
    debugLog('[QC product match][4 banding] applyProductMatchBanding → ' + JSON.stringify(banded))
    return banded
  }

  let result = null
  debugLog('[QC product match] Starting Anthropic attempts (max 2)')
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      debugLog('[QC product match] Calling attemptCall(' + attempt + ')')
      result = await attemptCall(attempt)
      if (result) break
      if (attempt === 0) {
        debugLog('[QC product match] Invalid response; retrying once.')
      }
    } catch (err) {
      const usage =
        err && typeof err === 'object'
          ? {
              inputTokens: Number(err.inputTokens) || 0,
              outputTokens: Number(err.outputTokens) || 0,
            }
          : { inputTokens: 0, outputTokens: 0 }
      inputTokens += usage.inputTokens
      outputTokens += usage.outputTokens
      const msg = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : ''
      debugLog(
        '[QC product match][catch] attempt=' +
          attempt +
          ' failed: ' +
          msg +
          (usage.inputTokens || usage.outputTokens
            ? ` (tokens in=${usage.inputTokens} out=${usage.outputTokens})`
            : ' (0 tokens recorded on error)'),
      )
      console.error('[QC product match][catch] attempt=' + attempt, err)
      if (stack) {
        debugLog('[QC product match][catch] stack: ' + stack.split('\n').slice(0, 6).join(' | '))
      }
      if (attempt === 0) {
        debugLog('[QC product match] API/transport error; retrying once.')
        continue
      }
      debugLog(
        '[QC product match] Both attempts failed; using NO/0 defaults. Last error: ' + msg,
      )
      result = { ...PRODUCT_MATCH_FAIL }
      break
    }
  }

  if (!result) {
    result = { ...PRODUCT_MATCH_FAIL }
    debugLog(
      '[QC product match] Using PRODUCT_MATCH_FAIL defaults after failed parse/API: ' +
        JSON.stringify(result),
    )
  }

  if (forceTitleNo) {
    debugLog('[QC product match] Overriding title to NO/0 (missing title or placeholder)')
    result = {
      ...result,
      titleResult: 'NO',
      titlePercent: 0,
      titleSameProduct: false,
    }
  }
  if (forceImageNo) {
    debugLog('[QC product match] Overriding image to NO/0 (missing URL or download failure)')
    result = {
      ...result,
      imageResult: 'NO',
      imagePercent: 0,
    }
  }

  debugLog(
    '[QC product match][final] Returning scores: title=' +
      result.titlePercent +
      ' (' +
      result.titleResult +
      ') image=' +
      result.imagePercent +
      ' (' +
      result.imageResult +
      ') titleSameProduct=' +
      result.titleSameProduct,
  )

  return {
    titleResult: result.titleResult,
    titleScore: result.titlePercent,
    imageResult: result.imageResult,
    imageScore: result.imagePercent,
    titleSameProduct: result.titleSameProduct,
    inputTokens,
    outputTokens,
    model: modelUsed,
  }
}

export async function scoreModelNumberMatch(vendorModel, amazonModel, apiKey, options = {}) {
  const prompt = buildModelNumberMatchPrompt(vendorModel, amazonModel)

  const { text, inputTokens, outputTokens, model } = await anthropicMessages(
    apiKey,
    [{ role: 'user', content: prompt }],
    { ...options, maxTokens: 8, label: options.label ?? 'model number match' },
  )

  const result = parseYesNoFromModelText(text)
  if (result == null) {
    throw new Error('Could not parse model number match (YES/NO) from model response.')
  }
  return { result, match: result === 'YES', inputTokens, outputTokens, model }
}

/**
 * @param {string} vendorTitle
 * @param {string} amazonTitle
 */
const QC_MINIMAL_SYSTEM =
  'You output only the exact answer requested. No preamble, markdown, punctuation, or newlines.'

const TITLE_SIMILARITY_MAX_TOKENS = 16

const IMAGE_SIMILARITY_MAX_TOKENS = 32

const IMAGE_QC_SYSTEM =
  'You compare two e-commerce catalog product photos for listing QC. Score visual sameness of the sellable item. Output only one integer 0-100 with no other text.'

const TITLE_PARSER_GRAY_MIN = 40
const TITLE_PARSER_GRAY_MAX = 60

/**
 * @param {string} vendorTitle
 * @param {string} amazonTitle
 * @param {string} [vendorBrand]
 * @param {string} [amazonBrand]
 * @param {string} [vendorModel]
 * @param {string} [amazonModel]
 */
export function buildTitleSimilarityPrompt(
  vendorTitle,
  amazonTitle,
  vendorBrand = '',
  amazonBrand = '',
  vendorModel = '',
  amazonModel = '',
) {
  return `TEXT-ONLY evaluation. Ignore images, UPC/barcode data, prices, and pack counts. Use only the listing text below.

STEP 1 — Extract the 4 core identity attributes from EACH title (and from brand/model fields if provided):
1) Brand
2) Model/Type
3) Size
4) Color
Example: "Raging Hard-On Blue Slim Line 5.5 inch" → Brand: Raging Hard-On, Type: Slim Line, Size: 5.5 inch, Color: Blue.

STEP 2 — Compare ONLY those 4 core attributes. Treat hyphenation, pluralization, and word order as the same (Hard-On = Hard Ons, Slim Line = Slimline).

DO NOT penalize the score if the longer title contains extra descriptive keywords (like "Anal Series", "Ass Play", etc.) that are missing from the shorter title. Focus ONLY on the core identity.

STRICT SCORING GUIDE:
- 90-100: Core identity (Brand, Size, Color, Type) matches perfectly, even if word count, punctuation, or extra descriptive words differ. Example that MUST score 90-100: Vendor "Raging Hard-On Blue Slim Line 5.5 inch" vs Amazon "Raging Hard Ons Slimline Anal Series 5.5 Inch Ass Play Ballsy - Blue".
- 40-60: Core identity partially matches, but there is some ambiguity (REVIEW zone).
- 0-30: Core identity clearly conflicts (e.g., different size, different color, or completely different product type).

Vendor title: ${vendorTitle || '(empty)'}
Amazon title: ${amazonTitle || '(empty)'}
Vendor brand (listing text): ${vendorBrand || '(not provided)'}
Amazon brand (listing text): ${amazonBrand || '(not provided)'}
Vendor model/SKU (listing text): ${vendorModel || '(not provided)'}
Amazon model/part number (listing text): ${amazonModel || '(not provided)'}

Do all comparison in your head. Your entire reply must be exactly one integer from 0 to 100 with no other characters (no words, punctuation, markdown, or newlines).`
}

/**
 * 0–100 integer from the title model, same rules as the image parser.
 * @param {string} text
 * @returns {number | null}
 */
export function parseTitleSimilarityScoreFromModelText(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  const lines = raw.split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const lone = lines[i].match(/^(\d{1,3})\s*%?$/)
    if (lone) {
      const n = Number(lone[1])
      if (Number.isFinite(n) && n >= 0 && n <= 100) return clampScore(n)
    }
  }
  return parseImageSimilarityScoreFromModelText(text)
}

/**
 * @param {string} text
 * @returns {'YES' | 'NO' | 'REVIEW' | null}
 */
export function parseTitleProductMatchFromModelText(text) {
  const yesNo = parseYesNoReviewFromModelText(text)
  if (yesNo) return yesNo
  const score = parseTitleSimilarityScoreFromModelText(text)
  if (score == null) return null
  if (score >= 80) return 'YES'
  if (score >= TITLE_PARSER_GRAY_MIN && score <= TITLE_PARSER_GRAY_MAX) return 'REVIEW'
  if (score < TITLE_PARSER_GRAY_MIN) return 'NO'
  return 'REVIEW'
}

/**
 * @param {string} vendorTitle
 * @param {string} amazonTitle
 * @param {string} apiKey
 * @param {object} [options]
 * @param {string} [options.vendorBrand]
 * @param {string} [options.amazonBrand]
 * @param {string} [options.vendorModel]
 * @param {string} [options.amazonModel]
 */
export async function scoreTitleSimilarity(vendorTitle, amazonTitle, apiKey, options = {}) {
  const vendor = coerceAiPromptText(vendorTitle)
  const amazon = coerceAiPromptText(amazonTitle)
  const vendorBrand = coerceAiPromptText(options.vendorBrand ?? '', '')
  const amazonBrand = coerceAiPromptText(options.amazonBrand ?? '', '')
  const vendorModel = coerceAiPromptText(options.vendorModel ?? '', '')
  const amazonModel = coerceAiPromptText(options.amazonModel ?? '', '')
  logDebugAiInputs(
    { title: vendorTitle, productTitle: vendorTitle },
    { title: amazonTitle, itemName: amazonTitle },
    { vendorTitle: vendor, amazonTitle: amazon },
  )

  if (!apiKey?.trim()) {
    throw aiResponseError('Anthropic API key is missing for title comparison.')
  }

  const prompt = buildTitleSimilarityPrompt(
    vendor,
    amazon,
    vendorBrand === 'No Title Found' ? '' : vendorBrand,
    amazonBrand === 'No Title Found' ? '' : amazonBrand,
    vendorModel === 'No Title Found' ? '' : vendorModel,
    amazonModel === 'No Title Found' ? '' : amazonModel,
  )

  const { text, inputTokens, outputTokens, model } = await anthropicMessages(
    apiKey,
    [{ role: 'user', content: prompt }],
    {
      ...options,
      maxTokens: options.maxTokens ?? TITLE_SIMILARITY_MAX_TOKENS,
      system: QC_MINIMAL_SYSTEM,
      label: 'title similarity',
    },
  )
  const rawResponse = String(text ?? '')
  const cleanResponse = rawResponse.trim().replace(/[\n\r]+/g, '')
  console.log('📝 RAW TITLE RESPONSE:', cleanResponse)
  const score = parseTitleSimilarityScoreFromModelText(cleanResponse)
  if (score == null) {
    console.error(
      '🚨 RAW AI TITLE RESPONSE FAILED TO PARSE:',
      JSON.stringify(cleanResponse),
    )
  }
  const result = score != null ? parseTitleProductMatchFromModelText(cleanResponse) : null
  const sameProduct =
    score == null ? null : score >= 80 ? true : score < TITLE_PARSER_GRAY_MIN ? false : null
  return { result, sameProduct, score, inputTokens, outputTokens, model }
}

export function buildImageSimilarityPrompt() {
  return `VISUAL-ONLY evaluation. You see two product photos only. Do not use titles, brands, model numbers, UPCs, or any text metadata — judge pixels only.

Image 1 = vendor listing photo. Image 2 = Amazon listing photo.

Score whether these photos depict the SAME sellable product (same SKU), 0–100.

CRITICAL RULE FOR APPAREL/CLOTHING:
Clothing is often photographed worn by a model. You MUST IGNORE the model's face, body shape, pose, skin tone, and the background/lighting.
Focus ONLY on the physical product itself: its color, pattern, texture, style, and cut.
If one image shows the product worn by a model, and the other shows it laid flat, on a hanger, or on a different model, it is STILL A MATCH as long as the physical item's visual features are identical. Do not penalize for different photography styles.

CATALOG PRODUCT-ONLY PHOTOS (single item on white/neutral background, no retail box visible):
- Score 90–100 when the same physical product appears in both images (same shape, color, material, and details). Minor crop, resolution, compression, or JPEG artifacts are OK.
- Wellness, intimate, and novelty catalog items are normal merchandise — compare product visuals only; do not score low because of product category.

PACKAGED GOODS (bottles, boxes, jars, tubes with visible retail packaging):
- Score 0–35 (FAIL) if packaging is NOT the same: different cap vs pump, different bottle/box shape, different label artwork, refill vs bottle, bundle vs single, or clearly a different SKU.
- Score 90–100 when the same retail package is shown. Minor differences OK: crop, angle, lighting, background.

APPAREL / ACCESSORIES / LOOSE GOODS (apply the CRITICAL RULE above first):
- Score 90–100 when the item's color, pattern, texture, style, and cut match (same SKU). Ignore model, pose, and background.
- Score 0–35 only when the product type, color, pattern, or cut clearly differs.

- Score 40–60 when uncertain or partially obscured.

Reply with ONLY one integer from 0 to 100. No words or punctuation.`
}

/** @param {string} text @param {string} [stopReason] */
export function isAiVisionUnavailable(text, stopReason) {
  if (String(stopReason ?? '').toLowerCase() === 'refusal') return true
  const t = String(text ?? '').trim().toLowerCase()
  if (!t) return true
  return (
    /\b(sorry|cannot|can't|unable|not able|won't|will not|refuse|refusing|policy|inappropriate|not allowed)\b/.test(
      t,
    ) && !/\b(yes|no)\b/.test(t)
  )
}

/**
 * YES/NO same-product, or a 0–100 integer. Returns null when the reply is unusable.
 * @param {string} text
 * @returns {number | null}
 */
export function parseImageSimilarityScoreFromModelText(text) {
  const cleaned = String(text ?? '')
    .trim()
    .replace(/[\n\r]+/g, '')
  if (!cleaned) return null

  const yesNo = parseYesNoFromModelText(cleaned)
  if (yesNo === 'YES') return 100
  if (yesNo === 'NO') return 0

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      const score = Number(parsed.score ?? parsed.similarity ?? parsed.similarityScore)
      if (Number.isFinite(score)) return clampScore(score)
    } catch {
      // fall through
    }
  }

  const whole = cleaned.match(/^(\d{1,3})\s*%?$/)
  if (whole) {
    const n = Number(whole[1])
    if (Number.isFinite(n) && n >= 0 && n <= 100) return clampScore(n)
  }

  /** Prefer the last 0–100 integer (avoids treating "0-100" boilerplate as score 0). */
  const candidates = []
  const re = /\d{1,3}/g
  let match
  while ((match = re.exec(cleaned)) !== null) {
    const n = Number(match[0])
    if (Number.isFinite(n) && n >= 0 && n <= 100) candidates.push(n)
  }
  if (!candidates.length) return null
  return clampScore(candidates[candidates.length - 1])
}

/**
 * @param {string} vendorImageUrl
 * @param {string} amazonImageUrl
 * @param {string} apiKey
 * @param {object} [options]
 */
export async function scoreImageSimilarity(vendorImageUrl, amazonImageUrl, apiKey, options = {}) {
  const vendorUrl = preferCatalogImageUrl(coerceAiImageUrl(vendorImageUrl))
  const amazonUrl = preferCatalogImageUrl(coerceAiImageUrl(amazonImageUrl))
  logDebugAiInputs(
    { imageUrl: vendorImageUrl, image: vendorImageUrl },
    { imageUrl: amazonImageUrl, image: amazonImageUrl },
    { vendorImage: vendorUrl || '(missing image URL)', amazonImage: amazonUrl || '(missing image URL)' },
  )

  if (!apiKey?.trim()) {
    throw aiResponseError('Anthropic API key is missing for image comparison.')
  }
  if (!vendorUrl || !amazonUrl) {
    throw aiResponseError(
      `Missing image URL(s) for comparison (vendor=${vendorUrl ? 'ok' : 'missing'}, amazon=${amazonUrl ? 'ok' : 'missing'}).`,
    )
  }

  const vendorImg = await prepareVisionImage(vendorUrl, { debugLabel: 'vendor' })
  const amazonImg = await prepareVisionImage(amazonUrl, { debugLabel: 'amazon' })

  if (!vendorImg || !amazonImg) {
    throw aiResponseError(
      `Could not download one or both product images (vendor=${vendorUrl}, amazon=${amazonUrl}).`,
    )
  }

  const prompt = buildImageSimilarityPrompt()

  const { text, inputTokens, outputTokens, model, stopReason } = await anthropicMessages(
    apiKey,
    [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: anthropicBase64ImageSource(vendorImg.data, vendorImg.mediaType),
          },
          {
            type: 'image',
            source: anthropicBase64ImageSource(amazonImg.data, amazonImg.mediaType),
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
    {
      ...options,
      maxTokens: IMAGE_SIMILARITY_MAX_TOKENS,
      system: IMAGE_QC_SYSTEM,
      label: 'image similarity',
    },
  )

  const rawResponse = String(text ?? '')
  const cleanResponse = rawResponse.trim().replace(/[\n\r]+/g, '')
  console.log('🖼️ RAW IMAGE RESPONSE:', cleanResponse)
  let score = parseImageSimilarityScoreFromModelText(cleanResponse)
  const refused = isAiVisionUnavailable(cleanResponse, stopReason)
  if (refused) {
    score = null
  }

  const pixelRaw = await visualSimilarityPercentFromBase64(vendorImg.data, amazonImg.data)

  if (score == null) {
    console.error(
      '🚨 RAW AI IMAGE RESPONSE FAILED TO PARSE:',
      JSON.stringify(cleanResponse),
      stopReason ? `(stop_reason=${stopReason})` : '',
    )
    const capped = capPixelFallbackImageScore(pixelRaw)
    if (capped != null) {
      console.log(
        `🖼️ IMAGE VISUAL FALLBACK SCORE: ${pixelRaw} → capped ${capped} (packaging-safe)`,
      )
      score = capped
    }
  } else {
    const merged = mergeImageSimilarityScores(score, pixelRaw)
    if (merged != null && merged !== score) {
      console.log(
        `🖼️ IMAGE SCORE MERGE: AI ${score} + pixel ${pixelRaw} → ${merged} (catalog duplicate guard)`,
      )
      score = merged
    }
  }
  const unavailable = score == null && refused
  return {
    score,
    sameProduct: score != null ? score >= 80 : null,
    unavailable: unavailable || score == null,
    inputTokens,
    outputTokens,
    model,
  }
}

const MODEL_MATCH_SELF_TEST_CASES = [
  { vendor: '61028-01', amazon: '6102801', expect: true },
  { vendor: '473', amazon: 'ABC473', expect: true },
  { vendor: 'LA-8888QWHT', amazon: '8888Q07002', expect: true },
]

/** @returns {{ pass: boolean, results: Array<{ vendor: string, amazon: string, expect: boolean, got: boolean }> }} */
export function runModelNumberMatchSelfTest() {
  const results = MODEL_MATCH_SELF_TEST_CASES.map(({ vendor, amazon, expect }) => {
    const got = lenientModelNumberMatch(vendor, amazon)
    return { vendor, amazon, expect, got }
  })
  const pass = results.every((r) => r.got === r.expect)
  return { pass, results }
}

const isSelfTestCli =
  typeof process.argv[1] === 'string' &&
  process.argv[1].replace(/\\/g, '/').endsWith('qcAiSimilarity.mjs')

if (isSelfTestCli && process.argv.includes('--test-model')) {
  const { pass, results } = runModelNumberMatchSelfTest()
  for (const r of results) {
    const status = r.got === r.expect ? 'OK' : 'FAIL'
    console.log(`${status}: vendor="${r.vendor}" amazon="${r.amazon}" → ${r.got ? 'YES' : 'NO'}`)
  }
  process.exit(pass ? 0 : 1)
}

const TITLE_SIMILARITY_SELF_TEST = {
  amazon:
    'Leg Avenue womens Lace Garter Belt and Thong Set adult exotic hosiery, White, Plus Size',
  vendor: 'Lace Garterbelt with Matching Thong - Queen Size - White',
  expectSameProduct: true,
}

/** @returns {{ pass: boolean, results: Array<{ input: string, expect: number | null, got: number | null }> }} */
export function runTitleProductMatchParserSelfTest() {
  const cases = [
    { input: 'YES', expect: 100 },
    { input: 'NO', expect: 0 },
    { input: ' yes ', expect: 100 },
    { input: '92', expect: 92 },
    { input: ' 85 ', expect: 85 },
    { input: '0', expect: 0 },
    { input: '100', expect: 100 },
    { input: 'Score: 85', expect: 85 },
    { input: '85%', expect: 85 },
    { input: '{"score":90}', expect: 90 },
    { input: 'no numbers here', expect: null },
    { input: '999', expect: null },
    { input: '0-100: 88', expect: 88 },
    { input: 'On a 0 to 100 scale, 95', expect: 95 },
  ]
  const results = cases.map(({ input, expect }) => ({
    input,
    expect,
    got: parseTitleSimilarityScoreFromModelText(input),
  }))
  const pass = results.every((r) => r.got === r.expect)
  return { pass, results }
}

/** @returns {{ pass: boolean, results: Array<{ input: string, expect: number | null, got: number | null }> }} */
export function runImageSimilarityParserSelfTest() {
  const cases = [
    { input: 'YES', expect: 100 },
    { input: 'NO', expect: 0 },
    { input: ' yes ', expect: 100 },
    { input: '92', expect: 92 },
    { input: ' 85 ', expect: 85 },
    { input: '0', expect: 0 },
    { input: '100', expect: 100 },
    { input: 'Score: 85', expect: 85 },
    { input: '85%', expect: 85 },
    { input: '{"score":90}', expect: 90 },
    { input: 'no numbers here', expect: null },
    { input: '999', expect: null },
    { input: '0-100: 88', expect: 88 },
    { input: 'On a 0 to 100 scale, 95', expect: 95 },
  ]
  const results = cases.map(({ input, expect }) => ({
    input,
    expect,
    got: parseImageSimilarityScoreFromModelText(input),
  }))
  const pass = results.every((r) => r.got === r.expect)
  return { pass, results }
}

if (isSelfTestCli && process.argv.includes('--test-title')) {
  const parserRun = runTitleProductMatchParserSelfTest()
  for (const r of parserRun.results) {
    const status = r.got === r.expect ? 'OK' : 'FAIL'
    console.log(`${status}: parser("${r.input}") → ${r.got ?? '(null)'}`)
  }
  if (!parserRun.pass) process.exit(1)

  let apiKey = process.env.ANTHROPIC_API_KEY?.trim() || ''
  if (!apiKey) {
    try {
      const { loadAnthropicApiKey } = await import('./qcCredentialReader.mjs')
      apiKey = (await loadAnthropicApiKey()) || ''
    } catch (err) {
      console.log(
        `SKIP live title AI test: ${err instanceof Error ? err.message : String(err)}`,
      )
      console.log('Set ANTHROPIC_API_KEY to run the Leg Avenue live check.')
      process.exit(0)
    }
  }

  const { amazon, vendor, expectSameProduct } = TITLE_SIMILARITY_SELF_TEST
  const titleResult = await scoreTitleSimilarity(vendor, amazon, apiKey, {
    label: 'title similarity self-test',
  })
  const ok =
    titleResult.score != null &&
    titleResult.score >= 80 &&
    titleResult.sameProduct === expectSameProduct
  console.log(
    `${ok ? 'OK' : 'FAIL'}: Leg Avenue titles → score ${titleResult.score} (model: ${titleResult.model})`,
  )
  if (!ok) {
    console.log(`Expected: score >= 80 (same product: ${expectSameProduct})`)
  }
  process.exit(ok ? 0 : 1)
}

if (isSelfTestCli && process.argv.includes('--test-image-parser')) {
  const { pass, results } = runImageSimilarityParserSelfTest()
  for (const r of results) {
    const status = r.got === r.expect ? 'OK' : 'FAIL'
    console.log(`${status}: image parser("${r.input}") → ${r.got ?? '(null)'}`)
  }
  process.exit(pass ? 0 : 1)
}
