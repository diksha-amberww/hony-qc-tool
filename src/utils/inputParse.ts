import type { InputFieldDef } from '../data/inputFields'
import { normalizeHeader } from '../data/inputFields'

export type InputRow = Record<string, string>

const ASIN_RE = /^B[0-9A-Z]{9}$/i
const UPC_RE = /^\d{8,14}$/

/** Cap collected messages so huge invalid pastes don't allocate unbounded error arrays. */
const DEFAULT_MAX_ERRORS = 200

function splitLine(line: string): string[] {
  return line.split(/\t|,/).map((p) => p.trim())
}

function tryMapHeader(cells: string[], fields: InputFieldDef[]): Record<string, number> | null {
  const indexByNorm = new Map<string, number>()
  cells.forEach((cell, i) => {
    const key = normalizeHeader(cell)
    if (key) indexByNorm.set(key, i)
  })

  const mapping: Record<string, number> = {}
  for (const field of fields) {
    const idx = indexByNorm.get(normalizeHeader(field.label))
    if (idx === undefined) return null
    mapping[field.id] = idx
  }
  return mapping
}

function pushCapped(errors: string[], message: string, maxErrors: number): boolean {
  if (errors.length >= maxErrors) return false
  errors.push(message)
  return errors.length < maxErrors
}

export function parseDelimitedText(
  raw: string,
  fields: InputFieldDef[],
  options?: { maxErrors?: number },
): { rows: InputRow[]; errors: string[] } {
  const maxErrors = options?.maxErrors ?? DEFAULT_MAX_ERRORS
  const errors: string[] = []
  if (fields.length === 0) {
    return { rows: [], errors: ['No input fields selected. Save at least one field first.'] }
  }

  const chunks = raw.split(/\r?\n/)
  const lines: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    const trimmed = chunks[i].trim()
    if (trimmed.length > 0) lines.push(trimmed)
  }

  if (lines.length === 0) {
    return { rows: [], errors: ['No data rows found'] }
  }

  const expectedLabels = fields.map((f) => f.label).join(' | ')
  let startIndex = 0
  let columnMap = tryMapHeader(splitLine(lines[0]), fields)

  if (columnMap) {
    startIndex = 1
    if (lines.length === 1) {
      return { rows: [], errors: ['Header row found but no data rows'] }
    }
  } else {
    columnMap = Object.fromEntries(fields.map((f, i) => [f.id, i]))
  }

  const maxIdx = Math.max(...Object.values(columnMap))
  const rows: InputRow[] = []
  let truncated = false

  for (let i = startIndex; i < lines.length; i++) {
    const rowNum = i - startIndex + 1
    const parts = splitLine(lines[i])

    if (parts.length <= maxIdx) {
      if (!pushCapped(
        errors,
        `Row ${rowNum}: expected columns (${expectedLabels}), found ${parts.length} value(s)`,
        maxErrors,
      )) {
        truncated = true
        break
      }
      continue
    }

    const row: InputRow = {}
    for (const field of fields) {
      row[field.id] = parts[columnMap[field.id]] ?? ''
    }
    rows.push(row)
  }

  if (truncated) {
    errors.push(`… additional parse issues omitted (showing first ${maxErrors})`)
  }

  return { rows, errors }
}

export function validateRows(
  rows: InputRow[],
  fields: InputFieldDef[],
  options?: { maxErrors?: number },
): string[] {
  const maxErrors = options?.maxErrors ?? DEFAULT_MAX_ERRORS
  const errors: string[] = []
  if (fields.length === 0) {
    return ['No input fields selected. Save at least one field first.']
  }
  if (rows.length === 0) {
    return ['No valid data rows to validate']
  }

  const uniqueField = fields.find((f) => f.id === 'part_sku') ?? fields[0]
  const seen = new Set<string>()
  let truncated = false

  for (let index = 0; index < rows.length; index++) {
    if (errors.length >= maxErrors) {
      truncated = true
      break
    }

    const row = rows[index]
    const rowNum = index + 1

    for (const field of fields) {
      const value = (row[field.id] ?? '').trim()
      if (!value) {
        if (!pushCapped(errors, `Row ${rowNum}: ${field.label} is empty`, maxErrors)) {
          truncated = true
          break
        }
        continue
      }
      if (field.kind === 'asin' && !ASIN_RE.test(value)) {
        if (
          !pushCapped(
            errors,
            `Row ${rowNum}: ${field.label} must match B + 9 alphanumeric characters`,
            maxErrors,
          )
        ) {
          truncated = true
          break
        }
      }
      if (field.kind === 'upc' && !UPC_RE.test(value)) {
        if (!pushCapped(errors, `Row ${rowNum}: ${field.label} must be 8–14 digits`, maxErrors)) {
          truncated = true
          break
        }
      }
    }

    if (truncated) break

    const key = (row[uniqueField.id] ?? '').trim()
    if (key) {
      if (seen.has(key)) {
        if (
          !pushCapped(errors, `Row ${rowNum}: duplicate ${uniqueField.label} "${key}"`, maxErrors)
        ) {
          truncated = true
          break
        }
      }
      seen.add(key)
    }
  }

  if (truncated) {
    errors.push(`… additional validation issues omitted (showing first ${maxErrors})`)
  }

  return errors
}

export function buildPastePlaceholder(fields: InputFieldDef[]): string {
  return fields.map((f) => f.label.replace(/\s+/g, '_')).join('\t')
}

export function buildSamplePaste(fields: InputFieldDef[]): string {
  const samples: Record<string, string[]> = {
    part_sku: ['SKU-A1', 'SKU-B2', 'SKU-C3'],
    asin: ['B08AB1CD2E', 'B08AB1CD2F', 'B08AB1CD30'],
    brand: ['Acme', 'Acme', 'Nova'],
    line: ['Pro', 'Lite', 'Pro'],
    upc: ['012345678905', '012345678912', '012345678929'],
  }
  return [0, 1, 2]
    .map((i) => fields.map((f) => samples[f.id]?.[i] ?? `VAL${i + 1}`).join('\t'))
    .join('\n')
}
