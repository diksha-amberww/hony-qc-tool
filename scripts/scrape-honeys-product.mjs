/**
 * Honey's Place product scraper (cheerio).
 *
 * Live fetch requires a valid session at:
 *   %APPDATA%\\HonyQCTool\\honeys-portal-session.json
 * (override userData with HONY_QC_USER_DATA). Log in via the desktop app first.
 *
 * Usage:
 *   npm run scrape:honeys
 *   npm run scrape:honeys -- --fixture HTML/response.html HTML/response2.html
 *   npm run scrape:honeys -- --url <productUrl> --referrer <referrerUrl> [--pretty]
 *
 * Live fetches use fetchWithSessionRecovery: on logout, the queue pauses until
 * honeys-portal-session.json is updated (log in via the desktop app), then retries.
 * --fixture mode never touches the network or session.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HONEYS_REQUEST_PROFILES, profileFetchHeaders } from './honeysRequestProfiles.mjs'
import { fetchWithSessionRecovery } from './honeysSessionFetch.mjs'
import { isHoneysAuthOrBlockPage, parseHoneysProductHtml } from './parseHoneysProductCheerio.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.join(__dirname, '..')

function parseArgs(argv) {
  const args = {
    fixtures: [],
    url: '',
    referrer: '',
    pretty: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--pretty') args.pretty = true
    else if (arg === '--fixture') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        args.fixtures.push(argv[++i])
      }
    } else if (arg === '--url' && argv[i + 1]) {
      args.url = argv[++i]
    } else if (arg === '--referrer' && argv[i + 1]) {
      args.referrer = argv[++i]
    }
  }

  return args
}

function resolveFixturePath(fixturePath) {
  if (path.isAbsolute(fixturePath)) return fixturePath
  return path.join(PROJECT_ROOT, fixturePath)
}

/**
 * @param {Response} res
 * @param {string} html
 */
function assertProductResponse(res, html, contextUrl) {
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Authentication failed (HTTP ${res.status}) for ${contextUrl}`)
  }
  if (isHoneysAuthOrBlockPage(html)) {
    throw new Error(`Session expired or blocked for ${contextUrl}. Log in via the desktop app.`)
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${contextUrl}`)
  }
}

async function fetchProductHtml(url, headers) {
  const { response: res, html } = await fetchWithSessionRecovery(url, {
    method: 'GET',
    headers,
  })
  assertProductResponse(res, html, url)
  return html
}

async function scrapeFromProfile(profile) {
  const headers = profileFetchHeaders(profile)
  const html = await fetchProductHtml(profile.url, headers)
  const data = parseHoneysProductHtml(html, profile.url)
  if (!data) {
    throw new Error(`Could not parse product page: ${profile.url}`)
  }
  return { profileId: profile.id, ...data }
}

async function scrapeFromUrl(url, referrer) {
  const headers = profileFetchHeaders({
    referrer,
    headers: {
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'accept-language': 'en-US,en;q=0.9',
      'upgrade-insecure-requests': '1',
    },
  })
  const html = await fetchProductHtml(url, headers)
  const data = parseHoneysProductHtml(html, url)
  if (!data) throw new Error(`Could not parse product page: ${url}`)
  return data
}

async function scrapeFromFixture(fixturePath) {
  const abs = resolveFixturePath(fixturePath)
  const html = await fs.readFile(abs, 'utf8')
  const data = parseHoneysProductHtml(html, `file://${abs}`)
  if (!data) throw new Error(`Could not parse fixture: ${abs}`)
  return { fixture: abs, ...data }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let results

  if (args.fixtures.length > 0) {
    results = []
    for (const fixture of args.fixtures) {
      results.push(await scrapeFromFixture(fixture))
    }
  } else if (args.url) {
    results = [await scrapeFromUrl(args.url, args.referrer)]
  } else {
    results = []
    for (const profile of HONEYS_REQUEST_PROFILES) {
      results.push(await scrapeFromProfile(profile))
    }
  }

  const output = args.pretty ? JSON.stringify(results, null, 2) : JSON.stringify(results)
  process.stdout.write(`${output}\n`)
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(message)
  process.exit(1)
})
