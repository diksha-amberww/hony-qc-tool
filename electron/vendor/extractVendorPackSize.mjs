/**
 * Vendor delivered-unit pack size: count of items shipped (bottles, cans, packs),
 * not volume (oz/ml) or wholesale case count.
 */

/** Wholesale / inner-container wording (not customer pack size). */
const PER_CONTAINER_UNIT =
  'bag|bags|bg|box|boxes|bx|case|cases|cs|pack|packs|pk|carton|cartons|ca|book|books|copy|copies'

/** Units in title patterns like 2/pack, 2/ct — excludes wholesale "case". */
const PACK_SLASH_UNITS =
  'bag|bags|bg|box|boxes|bx|pack|packs|pk|carton|cartons|roll|rolls|ct|cnt|count|book|books'

const DELIVERED_UNITS =
  'bottle|bottles|can|cans|jar|jars|tube|tubes|carton|cartons|box|boxes|bag|bags|roll|rolls|unit|units|item|items|packet|packets'

const NAMED_PACKS = {
  single: 1,
  twin: 2,
  double: 2,
  dual: 2,
  triple: 3,
  quad: 4,
}

const UNIT_CANONICAL = {
  bag: 'bag',
  bags: 'bag',
  bg: 'bag',
  pack: 'pack',
  packs: 'pack',
  pk: 'pack',
  case: 'case',
  cases: 'case',
  cs: 'case',
  box: 'box',
  boxes: 'box',
  bx: 'box',
  carton: 'carton',
  cartons: 'carton',
  ca: 'carton',
  ct: 'ct',
  cnt: 'ct',
  count: 'ct',
  bottle: 'bottle',
  bottles: 'bottle',
  can: 'can',
  cans: 'can',
  jar: 'jar',
  jars: 'jar',
  tube: 'tube',
  tubes: 'tube',
  roll: 'roll',
  rolls: 'roll',
  unit: 'unit',
  units: 'unit',
  item: 'each',
  items: 'each',
  each: 'each',
  book: 'book',
  books: 'book',
  copy: 'copy',
  copies: 'copy',
}

/**
 * Normalize pack-size unit for Amazon mapping (bag, pack, case, box, ct, …).
 * @param {unknown} raw
 * @returns {string}
 */
export function canonicalPackSizeUnit(raw) {
  const key = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .trim()
  if (!key) return 'each'
  return UNIT_CANONICAL[key] || key
}

const WORD_QTY = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
}

function normalizeText(str) {
  if (!str || typeof str !== 'string') return ''
  return str
    .replace(/&reg;/gi, '')
    .replace(/&trade;/gi, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/\u00ae|\u2122|\u00a9/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Drop a title count only when that number is the display/case/wholesale quantity
 * (e.g. "24 Packets Display"). Keep retail counts like "3 Pcs" / "2 Pack" / "in a Bag".
 * Never treat Pcs, Pack, or Bag as wholesale keywords.
 */
function isWholesaleDisplayQuantitySignal(title, signal) {
  const t = String(title || '').toLowerCase()
  const n = Number(signal?.value)
  if (!Number.isFinite(n)) return false
  const src = String(signal?.source ?? '')

  if (/\bdisplay\b/.test(t)) {
    if (new RegExp(`\\b${n}\\s*(packets?|packs?|pk|ct|count|boxes?)\\s+display\\b`, 'i').test(t)) {
      return true
    }
    if (src.includes('_packets')) return true
  }
  if (/\bwholesale\b/.test(t) && src.includes('_packets')) return true
  if (new RegExp(`\\bcase\\s+of\\s+${n}\\b`, 'i').test(t)) return true
  return false
}

/** Strip wholesale case fields so they never become pack size. */
function maskCasePackFields(text) {
  if (!text) return ''
  let masked = text
  masked = masked.replace(/\bcase\s*count\s*[:\s]*\d+/gi, '__CASE_COUNT__')
  masked = masked.replace(/\bcase\s*pack\s*[:\s]*\d+/gi, '__CASE_PACK__')
  masked = masked.replace(/\bcase\s*quantity\s*[:\s]*\d+/gi, '__CASE_QTY__')
  masked = masked.replace(/\b\d+\s*\/\s*cases?\b/gi, '__CASE_SLASH__')
  masked = masked.replace(/\b\d+\s+per\s+case\b/gi, '__PER_CASE__')
  masked = masked.replace(/\bminimum\s+order\s*(?:qty|quantity)?\s*[:\s]*\d+/gi, '__MIN_ORDER__')
  masked = masked.replace(/\bmin(?:imum)?\s*(?:order\s*)?(?:qty|quantity)\s*[:\s]+\s*\d+/gi, '__MIN_ORDER__')
  return masked
}

function maskFalsePositives(text) {
  if (!text) return ''
  let masked = maskCasePackFields(text)

  masked = masked.replace(/\b(\d+)\s*[-]?\s*in\s*[-]?\s*(\d+)\b/gi, '__FEATURE_$1_IN_$2__')
  masked = masked.replace(/\b(\d+)\s*[-]?\s*ply\b/gi, '__PLY_$1__')
  masked = masked.replace(
    /\b(\d+)\s*(mega|super|double|triple|big|giant|family|jumbo)\s*(rolls?|sheets?)?\s*[=]\s*(\d+)\s*(regular|standard|single|normal)?\s*(rolls?|sheets?)?\b/gi,
    '__EQUIV_$1_$4__',
  )
  masked = masked.replace(/\b(\d+(?:\.\d+)?)\s*%/g, '__PCT_$1__')
  masked = masked.replace(
    /\b(\d+)\s*x\s+(more|less|longer|faster|stronger|better|thicker|cleaning|power|absorbent|concentrated)\b/gi,
    '__MULT_$1__',
  )
  masked = masked.replace(
    /\b(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\b/gi,
    '__DIM_$1x$2x$3__',
  )
  masked = masked.replace(
    /\b(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(?=(?:inch|inches|in|cm|mm|ft|feet|"|')\b)/gi,
    '__DIM_$1x$2__',
  )

  masked = masked.replace(
    /\b(\d+(?:\.\d+)?)\s*(?:fl\.?\s*)?(?:oz|ounces?|fl\.?\s*oz|floz)\b/gi,
    '__VOL_$1_OZ__',
  )
  masked = masked.replace(
    /\b(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?|kilograms?|kg|grams?|g|mg|milligrams?)\b/gi,
    '__WT_$1__',
  )
  masked = masked.replace(
    /\b(\d+(?:\.\d+)?)\s*(?:ml|liters?|l|gallons?|gal|quarts?|qt|pints?|pt)\b/gi,
    '__VOL_$1__',
  )
  masked = masked.replace(
    /\b(\d+(?:\.\d+)?)\s*(?:inches?|inch|in|feet|ft|foot|cm|mm|meters?|m|yards?|yd)\b/gi,
    '__MEAS_$1__',
  )

  return masked
}

/** Mask inner contents (100 count, box of 2000 sheets) so they are not outer pack. */
function maskInnerContents(text) {
  if (!text) return ''
  let masked = text

  masked = masked.replace(
    new RegExp(
      `\\b(?:${PER_CONTAINER_UNIT})\\s+of\\s+(\\d+(?:,\\d{3})*)\\s+(?:screws?|sheets?|count|ct|pieces?|pcs?|items?|napkins?|bandages?|wipes?|tablets?|capsules?|pods?|rolls?)\\b`,
      'gi',
    ),
    '__INNER_CONTAINER__',
  )

  masked = masked.replace(
    /\b(\d+(?:,\d{3})*)\s*(?:count|ct)\b(?!\s*(?:pack|pk)\b)/gi,
    '__INNER_COUNT__',
  )

  masked = masked.replace(
    /\b(\d+(?:,\d{3})*)\s*(?:sheets?|screws?|pieces?|pcs?|napkins?|bandages?|wipes?|tablets?|capsules?|pods?)\b/gi,
    '__INNER_PIECES__',
  )

  return masked
}

function isPiecesPerContainer(n, text) {
  const re = new RegExp(
    `\\b${n}\\s*(?:pcs?|pieces?)\\s*/\\s*(?:${PER_CONTAINER_UNIT})\\b`,
    'i',
  )
  return re.test(String(text || ''))
}

function isInnerCountSignal(n, lowerText) {
  if (n <= 1) return false
  if (isPiecesPerContainer(n, lowerText)) return false

  const innerPatterns = [
    new RegExp(
      `\\b${n}\\s*(?:ct|count|pcs?|pieces?|sheets?|plates?|cups?|packets?|napkins?|bandages?|pads?|tablets?|capsules?|screws?)\\b`,
      'i',
    ),
    new RegExp(
      `\\bpack\\s+of\\s+${n}\\s+(?:plates?|napkins?|sheets?|cups?|spoons?|forks?|straws?|packets?|capsules?|tablets?|bandages?|wipes?|pieces?|items?|pads?|filters?|gloves?|screws?)\\b`,
      'i',
    ),
    new RegExp(
      `\\b(?:box|case|book|copy)\\s+of\\s+${n}\\b`,
      'i',
    ),
  ]
  return innerPatterns.some((re) => re.test(lowerText))
}

/**
 * @param {string} text - masked text
 * @param {string} sourcePrefix
 * @returns {Array<{ source: string, value: number, confidence: number, evidence: string }>}
 */
function extractLeadingContainersOfInner(rawText, sourcePrefix) {
  if (!rawText) return []
  const signals = []
  const lowerText = rawText.toLowerCase()
  const re = new RegExp(
    `\\b(\\d+)\\s+(?:${PER_CONTAINER_UNIT})\\s+of\\s+\\d+(?:,\\d{3})*\\b`,
    'gi',
  )
  let m
  while ((m = re.exec(lowerText)) !== null) {
    const val = Number.parseInt(m[1], 10)
    if (val >= 2 && val <= 10_000) {
      const unitMatch = m[0].match(
        new RegExp(`\\d+\\s+(${PER_CONTAINER_UNIT})\\s+of`, 'i'),
      )
      signals.push({
        source: `${sourcePrefix}_containers_of_inner`,
        value: val,
        unit: canonicalPackSizeUnit(unitMatch?.[1] || 'pack'),
        confidence: 96,
        evidence: `"${m[0]}" → ${val} containers`,
      })
    }
  }
  return signals
}

function shouldBlockInnerCount(val, lowerText, options = {}) {
  if (options.relaxInnerCheck) return false
  return isInnerCountSignal(val, lowerText)
}

function extractDeliveredCountSignals(text, sourcePrefix, options = {}) {
  if (!text) return []
  const signals = []
  const lowerText = text.toLowerCase()

  {
    const re = /\b(\d+)\s+packets?\b/gi
    let m
    while ((m = re.exec(lowerText)) !== null) {
      const val = Number.parseInt(m[1], 10)
      if (val >= 1 && val <= 10_000) {
        signals.push({
          source: `${sourcePrefix}_packets`,
          value: val,
          unit: 'pack',
          confidence: 99,
          evidence: `"${m[0]}" → ${val} packet(s)`,
        })
      }
    }
  }

  {
    const re = /\b(\d+)\s*[-]?\s*(?:pcs|pc|pieces?)\b/gi
    let m
    while ((m = re.exec(lowerText)) !== null) {
      const val = Number.parseInt(m[1], 10)
      if (val >= 1 && val <= 10_000) {
        signals.push({
          source: `${sourcePrefix}_pcs`,
          value: val,
          unit: 'each',
          confidence: 99,
          evidence: `"${m[0]}" → ${val} pc(s)`,
        })
      }
    }
  }

  {
    const re = /\b(\d+)\s*[-]?\s*(?:pcs|pc|pieces?)\s+in\s+a\s+bag\b/gi
    let m
    while ((m = re.exec(lowerText)) !== null) {
      const val = Number.parseInt(m[1], 10)
      if (val >= 1 && val <= 10_000) {
        signals.push({
          source: `${sourcePrefix}_pcs_in_bag`,
          value: val,
          unit: 'each',
          confidence: 99,
          evidence: `"${m[0]}" → ${val} pcs (retail bag)`,
        })
      }
    }
  }

  {
    const re = /\(?\bpack\s+of\s+(\d+)\)?/gi
    let m
    while ((m = re.exec(lowerText)) !== null) {
      const val = Number.parseInt(m[1], 10)
      if (val >= 1 && val <= 10_000 && !shouldBlockInnerCount(val, lowerText, options)) {
        signals.push({
          source: `${sourcePrefix}_pack_of`,
          value: val,
          unit: 'pack',
          confidence: 95,
          evidence: `"${m[0]}" → pack of ${val}`,
        })
      }
    }
  }

  {
    const re = /\b(\d+)\s*[-]?\s*pack(?!\w)/gi
    let m
    while ((m = re.exec(lowerText)) !== null) {
      const val = Number.parseInt(m[1], 10)
      if (val >= 2 && val <= 10_000 && !lowerText.includes(`pack of ${val}`)) {
        signals.push({
          source: `${sourcePrefix}_x_pack`,
          value: val,
          unit: 'pack',
          confidence: 90,
          evidence: `"${m[0]}" → ${val}-pack`,
        })
      }
    }
  }

  {
    const re = /\b(\d+)\s*[\/]?\s*pk\b/gi
    let m
    while ((m = re.exec(lowerText)) !== null) {
      const val = Number.parseInt(m[1], 10)
      if (val >= 2 && val <= 10_000) {
        signals.push({
          source: `${sourcePrefix}_xpk`,
          value: val,
          unit: 'pack',
          confidence: 88,
          evidence: `"${m[0]}" → ${val}PK`,
        })
      }
    }
  }

  {
    const re = new RegExp(`\\b(\\d+)\\s*\\/\\s*(${PACK_SLASH_UNITS})\\b`, 'gi')
    let m
    while ((m = re.exec(lowerText)) !== null) {
      const val = Number.parseInt(m[1], 10)
      if (val >= 2 && val <= 10_000) {
        signals.push({
          source: `${sourcePrefix}_per_container`,
          value: val,
          unit: canonicalPackSizeUnit(m[2]),
          confidence: 98,
          evidence: `"${m[0]}" → ${val} per ${m[2]}`,
        })
      }
    }
  }

  {
    const re = /\b(\d+)\s*(?:ct|cnt|count)\b/gi
    let m
    while ((m = re.exec(lowerText)) !== null) {
      const val = Number.parseInt(m[1], 10)
      if (val >= 2 && val <= 10_000 && !shouldBlockInnerCount(val, lowerText, options)) {
        signals.push({
          source: `${sourcePrefix}_x_ct`,
          value: val,
          unit: 'ct',
          confidence: 86,
          evidence: `"${m[0]}" → ${val} count`,
        })
      }
    }
  }

  {
    const re = new RegExp(
      `\\b(\\d+)\\s*(?:pcs?|pieces?)\\s*/\\s*(${PER_CONTAINER_UNIT})\\b`,
      'gi',
    )
    let m
    while ((m = re.exec(lowerText)) !== null) {
      const val = Number.parseInt(m[1], 10)
      if (val >= 2 && val <= 10_000) {
        signals.push({
          source: `${sourcePrefix}_pieces_per_container`,
          value: val,
          unit: canonicalPackSizeUnit(m[2]),
          confidence: 98,
          evidence: `"${m[0]}" → ${val} per ${m[2]}`,
        })
      }
    }
  }

  {
    const re = new RegExp(`\\b(\\d+)\\s+(${DELIVERED_UNITS})\\b`, 'gi')
    let m
    while ((m = re.exec(lowerText)) !== null) {
      const val = Number.parseInt(m[1], 10)
      if (val >= 1 && val <= 10_000 && !shouldBlockInnerCount(val, lowerText, options)) {
        signals.push({
          source: `${sourcePrefix}_delivered_units`,
          value: val,
          unit: canonicalPackSizeUnit(m[2]),
          confidence: 85,
          evidence: `"${m[0]}" → ${val} ${m[2]}`,
        })
      }
    }
  }

  {
    for (const [name, count] of Object.entries(NAMED_PACKS)) {
      if (count === 1) continue
      const re = new RegExp(`\\b${name}\\s*[-]?\\s*pack\\b`, 'gi')
      if (re.test(lowerText)) {
        signals.push({
          source: `${sourcePrefix}_named_pack`,
          value: count,
          unit: 'pack',
          confidence: 92,
          evidence: `"${name} pack" → ${count}`,
        })
      }
    }
  }

  {
    const wordAlt = Object.keys(WORD_QTY).join('|')
    const re = new RegExp(
      `\\b(?:includes?\\s+)?(?:(\\d+)|(${wordAlt}))\\s+(?:(?:ornaments?|pieces?|items?|pcs?)\\s+)?per\\s+(${PER_CONTAINER_UNIT})\\b`,
      'gi',
    )
    let m
    while ((m = re.exec(lowerText)) !== null) {
      const val = m[1] ? Number.parseInt(m[1], 10) : WORD_QTY[m[2].toLowerCase()]
      if (val >= 2 && val <= 10_000) {
        signals.push({
          source: `${sourcePrefix}_per_container_phrase`,
          value: val,
          unit: canonicalPackSizeUnit(m[3]),
          confidence: 98,
          evidence: `"${m[0]}" → ${val} per ${m[3]}`,
        })
      }
    }
  }

  return signals
}

function isWholesaleCaseSignal(signal) {
  const ev = String(signal?.evidence ?? '')
  return /\/\s*cases?\b|case\s*pack|case\s*count|per\s+case\b|__CASE_/i.test(ev)
}

function pickBestSignal(signals) {
  if (!signals.length) return null
  const filtered = signals.filter(
    (s) => s.value >= 1 && s.value <= 10_000 && !isWholesaleCaseSignal(s),
  )
  if (!filtered.length) return null
  filtered.sort((a, b) => b.confidence - a.confidence)
  return filtered[0]
}

/**
 * @param {string} text
 * @param {string} sourcePrefix
 */
function extractPackSignalsFromText(text, sourcePrefix) {
  if (!text) return []
  const normalized = normalizeText(text)
  const isTitle = sourcePrefix === 'title'
  const segment = isTitle
    ? maskFalsePositives(normalized)
    : maskInnerContents(maskFalsePositives(normalized))
  return [
    ...extractLeadingContainersOfInner(normalized, sourcePrefix),
    ...extractDeliveredCountSignals(segment, sourcePrefix, { relaxInnerCheck: isTitle }),
  ]
}

/**
 * Add-to-cart MOQ cross-check (Honey's qty stepper min / default value).
 * @param {{ packSize: string, packSizeSource: string, evidence: string }} extracted
 * @param {number | null | undefined} minOrderQty
 */
export function reconcilePackSizeWithMoq(extracted, minOrderQty) {
  const base = extracted ?? {
    packSize: '1',
    packSizeUnit: 'each',
    packSizeSource: 'default',
    evidence: '',
  }
  const packSizeUnit = canonicalPackSizeUnit(base.packSizeUnit || 'each')
  const moq = Number.parseInt(String(minOrderQty ?? ''), 10)
  if (!Number.isFinite(moq) || moq < 2) {
    return {
      ...base,
      packSizeUnit,
      minOrderQty: minOrderQty ?? undefined,
      moqVerified: false,
    }
  }

  const packN = Number.parseInt(base.packSize, 10)
  if (!Number.isFinite(packN) || packN < 1) {
    return {
      packSize: String(moq),
      packSizeUnit: 'each',
      packSizeSource: 'moq',
      evidence: `add-to-cart MOQ ${moq} (no title pack signal)`,
      minOrderQty: moq,
      moqVerified: true,
    }
  }

  if (base.packSizeSource === 'default' || packN === 1) {
    return {
      packSize: String(moq),
      packSizeUnit: packN === 1 && packSizeUnit !== 'each' ? packSizeUnit : 'each',
      packSizeSource: 'moq',
      evidence: `${base.evidence || 'default 1'} → MOQ ${moq} from add-to-cart`,
      minOrderQty: moq,
      moqVerified: true,
    }
  }

  if (packN === moq) {
    return {
      ...base,
      packSizeUnit,
      packSizeSource: `${base.packSizeSource}+moq`,
      evidence: `${base.evidence}; add-to-cart MOQ confirms ${moq}`,
      minOrderQty: moq,
      moqVerified: true,
    }
  }

  return {
    ...base,
    packSizeUnit,
    minOrderQty: moq,
    moqVerified: false,
    moqConflict: moq,
  }
}

/**
 * @param {object} input
 * @param {string} [input.title]
 * @param {string} [input.description]
 * @param {string[]} [input.attributeTexts]
 * @returns {{ packSize: string, packSizeSource: string, evidence: string }}
 */
export function extractVendorPackSize(input = {}) {
  const title = input.title ? normalizeText(input.title) : ''
  const description = input.description ? normalizeText(input.description) : ''
  const attributeTexts = Array.isArray(input.attributeTexts)
    ? input.attributeTexts.map((t) => normalizeText(t)).filter(Boolean)
    : []

  if (!title && !description && attributeTexts.length === 0) {
    const bare = reconcilePackSizeWithMoq(
      {
        packSize: '1',
        packSizeUnit: 'each',
        packSizeSource: 'default',
        evidence: 'no text; default 1',
      },
      input.minOrderQty,
    )
    return bare
  }

  const titleSignals = extractPackSignalsFromText(title, 'title').filter(
    (signal) => !isWholesaleDisplayQuantitySignal(title, signal),
  )
  const titleBest = pickBestSignal(titleSignals)
  if (titleBest) {
    const fromTitle = {
      packSize: String(titleBest.value),
      packSizeUnit: canonicalPackSizeUnit(titleBest.unit || 'pack'),
      packSizeSource: 'title',
      evidence: titleBest.evidence,
    }
    return reconcilePackSizeWithMoq(fromTitle, input.minOrderQty)
  }

  const secondarySignals = []
  if (description) {
    secondarySignals.push(...extractPackSignalsFromText(description, 'description'))
  }
  for (const [idx, attr] of attributeTexts.entries()) {
    secondarySignals.push(...extractPackSignalsFromText(attr, `attr${idx}`))
  }

  const secondaryBest = pickBestSignal(secondarySignals)
  if (secondaryBest) {
    const source = secondaryBest.source.startsWith('description') ? 'description' : 'attributes'
    const fromSecondary = {
      packSize: String(secondaryBest.value),
      packSizeUnit: canonicalPackSizeUnit(secondaryBest.unit || 'pack'),
      packSizeSource: source,
      evidence: secondaryBest.evidence,
    }
    return reconcilePackSizeWithMoq(fromSecondary, input.minOrderQty)
  }

  return reconcilePackSizeWithMoq(
    {
      packSize: '1',
      packSizeUnit: 'each',
      packSizeSource: 'default',
      evidence: 'no delivered-count signal; default 1',
    },
    input.minOrderQty,
  )
}

/**
 * @param {object} vendorData - scraped vendor fields
 * @returns {{ packSize: number, evidence: string[] }}
 */
export function resolveVendorPackSizeFromData(vendorData) {
  const attributeTexts = []
  const attrs = vendorData?.rawAttributes
  if (attrs && typeof attrs === 'object') {
    for (const v of Object.values(attrs)) {
      if (typeof v === 'string' && v.trim() && v.length < 200) attributeTexts.push(v)
    }
  }

  const moqRaw = vendorData?.minOrderQty ?? vendorData?.rawAttributes?.minOrderQty
  const extracted = extractVendorPackSize({
    title: vendorData?.productTitle ?? vendorData?.title,
    description: vendorData?.description,
    attributeTexts,
    minOrderQty: moqRaw,
  })

  const scraped = String(vendorData?.packSize ?? '').trim()
  let packSize = Number.parseInt(extracted.packSize, 10)
  const evidence = [extracted.evidence]
  if (extracted.moqVerified && moqRaw != null) {
    evidence.push(`add-to-cart MOQ verified (${moqRaw})`)
  } else if (extracted.moqConflict != null) {
    evidence.push(`MOQ ${extracted.moqConflict} differs from title pack ${packSize}`)
  }

  if (/^\d+$/.test(scraped)) {
    const n = Number.parseInt(scraped, 10)
    if (Number.isFinite(n) && n >= 1) {
      if (extracted.packSizeSource === 'default') {
        packSize = n
        evidence.push(`scraped packSize = ${n}`)
      }
    }
  }

  if (!Number.isFinite(packSize) || packSize < 1) packSize = 1

  return {
    packSize,
    packSizeUnit: canonicalPackSizeUnit(extracted.packSizeUnit || 'each'),
    evidence,
  }
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function parseAmazonPackSizeNumber(value) {
  const s = String(value ?? '').trim()
  if (/^\d+$/.test(s)) {
    const n = Number.parseInt(s, 10)
    return Number.isFinite(n) && n >= 1 ? n : 1
  }
  const m = s.match(/\b(\d+)\b/)
  if (m?.[1]) {
    const n = Number.parseInt(m[1], 10)
    return Number.isFinite(n) && n >= 1 ? n : 1
  }
  return 1
}
