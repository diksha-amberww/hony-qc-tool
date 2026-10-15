import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveHoneysUserDataPath } from '../electron/vendor/honeysUserDataPath.mjs'

const ENV_FILE = 'credentials.env'
const PLAIN_PREFIX = 'plain:'
const ENC_PREFIX = 'enc:'

function parseEnvLines(content) {
  const map = new Map()
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    map.set(key, value)
  }
  return map
}

function decodeStoredSecret(stored) {
  if (!stored) return null
  if (stored.startsWith(PLAIN_PREFIX)) {
    try {
      return Buffer.from(stored.slice(PLAIN_PREFIX.length), 'base64').toString('utf8')
    } catch {
      return null
    }
  }
  if (stored.startsWith(ENC_PREFIX)) {
    return null
  }
  return stored
}

/**
 * Load Claude / Anthropic API key from process.env or credentials.env (HonyQCTool userData).
 * Encrypted-at-rest (`enc:`) values require the Electron app; use ANTHROPIC_API_KEY in the environment for CLI runs.
 */
export async function loadAnthropicApiKey() {
  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim()
  if (fromEnv) return fromEnv

  const envPath = path.join(resolveHoneysUserDataPath(), ENV_FILE)
  let content
  try {
    content = await fs.readFile(envPath, 'utf8')
  } catch {
    throw new Error(
      `Anthropic API key not found. Save Claude Haiku 5.5 credentials in the app or set ANTHROPIC_API_KEY (expected ${envPath}).`,
    )
  }

  const map = parseEnvLines(content)
  const raw = map.get('ANTHROPIC_API_KEY')
  const plain = decodeStoredSecret(raw)
  if (plain?.trim()) return plain.trim()

  if (raw?.startsWith(ENC_PREFIX)) {
    throw new Error(
      'ANTHROPIC_API_KEY is encrypted with OS storage. Run QC from the Electron app or set ANTHROPIC_API_KEY for CLI.',
    )
  }

  throw new Error('ANTHROPIC_API_KEY is missing from credentials.env.')
}
