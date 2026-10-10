import net from 'node:net'
import { fetchLwaAccessToken } from './amazon/lwaToken.mjs'
import { testBitrix24Connection } from './bitrix24/bitrix24Api.mjs'
import {
  clearHoneysSession,
  ensureHoneysPortalSession,
  formatPortalLoginSuccessMessage,
  resolvePortalEndpoints,
} from './vendor/honeysPlaceSession.mjs'

const REDACT =
  /(?:sk-[a-zA-Z0-9_-]{8,}|xox[baprs]-\S+|Bearer\s+\S+|password[=:]\s*\S+|api[_-]?key[=:]\s*\S+)/gi

function redact(text) {
  return String(text).replace(REDACT, '[redacted]')
}

function logLine(lines, message) {
  lines.push(redact(message))
}

function createLogEmitter(emitLog) {
  const lines = []
  const nativePush = lines.push.bind(lines)
  lines.push = (...items) => {
    const length = nativePush(...items)
    for (const item of items) {
      emitLog?.(String(item))
    }
    return length
  }
  return lines
}

function readResponse(socket) {
  return new Promise((resolve, reject) => {
    socket.once('data', (buf) => resolve(buf.toString('utf8')))
    socket.once('error', reject)
    socket.setTimeout(12_000, () => reject(new Error('SMTP response timed out.')))
  })
}

function writeLine(socket, line) {
  socket.write(`${line}\r\n`)
}

async function smtpAuthTest(values, config, log) {
  const host = values[config.hostKey]?.trim()
  const port = Number.parseInt(values[config.portKey]?.trim() ?? '', 10)
  const user = values[config.userKey]?.trim()
  const pass = values[config.passKey]?.trim()

  if (!host || !port || !user || !pass) {
    logLine(log, 'Missing SMTP host, port, username, or password.')
    return { ok: false, message: 'Save required SMTP credentials before testing.', log }
  }

  logLine(log, `Connecting to ${host}:${port}`)

  return await new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const finish = (result) => {
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(15_000, () => {
      logLine(log, 'Connection timed out.')
      finish({ ok: false, message: 'SMTP connection timed out.', log })
    })

    socket.on('error', (err) => {
      logLine(log, err.message)
      finish({ ok: false, message: 'Could not connect to SMTP server.', log })
    })

    socket.on('connect', async () => {
      try {
        const greeting = await readResponse(socket)
        logLine(log, `Server: ${greeting.trim()}`)
        if (!greeting.startsWith('220')) {
          return finish({ ok: false, message: 'Unexpected SMTP greeting.', log })
        }

        writeLine(socket, 'EHLO qc-template')
        const ehlo = await readResponse(socket)
        logLine(log, 'EHLO accepted')

        writeLine(socket, 'AUTH LOGIN')
        const authPrompt = await readResponse(socket)
        if (!authPrompt.startsWith('334')) {
          logLine(log, `AUTH LOGIN: ${authPrompt.trim()}`)
          return finish({ ok: false, message: 'SMTP server did not accept AUTH LOGIN.', log })
        }

        writeLine(socket, Buffer.from(user, 'utf8').toString('base64'))
        await readResponse(socket)
        writeLine(socket, Buffer.from(pass, 'utf8').toString('base64'))
        const authResult = await readResponse(socket)
        logLine(log, `AUTH result code: ${authResult.slice(0, 3)}`)

        if (authResult.startsWith('235')) {
          writeLine(socket, 'QUIT')
          return finish({
            ok: true,
            message: 'Login successful — SMTP server accepted credentials.',
            log,
          })
        }

        return finish({ ok: false, message: 'SMTP authentication failed.', log })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'SMTP test failed.'
        logLine(log, msg)
        return finish({ ok: false, message: 'SMTP test failed.', log })
      }
    })
  })
}

async function testAnthropic(values, log) {
  const apiKey = values.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) {
    return { ok: false, message: 'Save an API key before testing.', log: ['Missing API key.'] }
  }

  logLine(log, 'Opening Anthropic API endpoint…')
  logLine(log, 'POST api.anthropic.com/v1/messages (minimal request)')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    }),
  })

  logLine(log, `HTTP ${res.status} ${res.statusText}`)
  if (res.status === 401 || res.status === 403) {
    return { ok: false, message: 'Authentication failed. Check the API key.', log }
  }
  if (res.ok) {
    return { ok: true, message: 'Login successful — Claude API key accepted.', log }
  }
  if (res.status >= 400 && res.status < 500) {
    return { ok: true, message: 'API key reached Anthropic (see log for HTTP details).', log }
  }
  return { ok: false, message: 'Could not verify Anthropic credentials.', log }
}

async function testOpenAi(values, log) {
  const apiKey = values.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    return { ok: false, message: 'Save an API key before testing.', log: ['Missing API key.'] }
  }

  logLine(log, 'Opening OpenAI API endpoint…')
  logLine(log, 'GET api.openai.com/v1/models')
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  logLine(log, `HTTP ${res.status} ${res.statusText}`)
  if (res.status === 401) {
    return { ok: false, message: 'Authentication failed. Check the API key.', log }
  }
  if (res.ok) {
    return { ok: true, message: 'OpenAI API accepted the credentials.', log }
  }
  return { ok: false, message: 'Could not verify OpenAI credentials.', log }
}

async function testHttpBearer(values, config, log) {
  const baseUrl = values[config.baseUrlKey]?.trim().replace(/\/+$/, '')
  const token = values[config.tokenKey]?.trim()
  if (!baseUrl || !token) {
    logLine(log, 'Missing base URL or token.')
    return { ok: false, message: 'Save base URL and API token before testing.', log }
  }

  const healthPath = config.healthPath ?? '/health'
  const url = `${baseUrl}${healthPath.startsWith('/') ? healthPath : `/${healthPath}`}`
  logLine(log, `GET ${url}`)
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  logLine(log, `HTTP ${res.status} ${res.statusText}`)

  if (res.status === 401 || res.status === 403) {
    return { ok: false, message: 'API authentication failed.', log }
  }
  if (res.ok) {
    return { ok: true, message: 'API health check succeeded.', log }
  }

  if (res.status === 404) {
    logLine(log, 'Health route not found; trying base URL.')
    const rootRes = await fetch(baseUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    logLine(log, `HTTP ${rootRes.status} ${rootRes.statusText}`)
    if (rootRes.status === 401 || rootRes.status === 403) {
      return { ok: false, message: 'API authentication failed.', log }
    }
    if (rootRes.ok || rootRes.status < 500) {
      return { ok: true, message: 'API responded (see log).', log }
    }
  }

  return { ok: false, message: 'API did not respond successfully.', log }
}

async function testAmazonSpApi(values, log) {
  logLine(log, 'POST api.amazon.com/auth/o2/token (refresh_token grant)')
  const lwa = await fetchLwaAccessToken({
    clientId: values.SP_API_CLIENT_ID,
    clientSecret: values.SP_API_CLIENT_SECRET,
    refreshToken: values.SP_API_REFRESH_TOKEN,
  })

  if (!lwa.ok) {
    logLine(log, lwa.error)
    return { ok: false, message: 'Amazon LWA authentication failed. Check SP-API credentials.', log }
  }

  logLine(log, 'Access token issued successfully.')
  return {
    ok: true,
    message: 'Login successful — Amazon SP-API token refresh verified.',
    log,
  }
}

async function testHoneysPortalLogin(values, config, log, options = {}) {
  const portalUrl = values.QC_PORTAL_URL?.trim().replace(/\/+$/, '')
  const email = values.QC_PORTAL_USERNAME?.trim()
  const password = values.QC_PORTAL_PASSWORD?.trim()
  const accountNumber =
    values.QC_PORTAL_ACCOUNT_NUMBER?.trim() || '22197DS'

  if (!portalUrl || !email || !password) {
    logLine(log, 'Missing portal URL, email, or password.')
    return { ok: false, message: 'Save portal credentials before testing.', log }
  }

  const endpoints = resolvePortalEndpoints(portalUrl, config.loginPath ?? '/login', config.confirmationPath ?? '/choose-account')
  logLine(log, `Opening portal page: ${endpoints.loginUrl}`)
  logLine(log, `Waiting for confirmation page: ${endpoints.confirmationUrl}`)
  const headlessScraping =
    typeof options.headlessScraping === 'boolean' ? options.headlessScraping : true
  logLine(log, `Headless scraping: ${headlessScraping ? 'ON (background browser)' : 'OFF (visible browser)'}`)
  logLine(log, 'Clearing saved session and browser cookies before test login…')
  await clearHoneysSession()

  const result = await ensureHoneysPortalSession({
    reuseSession: false,
    freshSession: true,
    clearStoredSession: false,
    headless: headlessScraping,
    loginPath: config.loginPath ?? '/login',
    confirmationPath: config.confirmationPath ?? '/choose-account',
    credentials: {
      rawPortalUrl: portalUrl,
      portalUrl,
      email,
      password,
      accountNumber,
      ttlMinutes: Number.parseInt(values.QC_PORTAL_SESSION_TTL_MIN ?? '', 10) || 120,
    },
    onLogLine: (line) => log.push(redact(line)),
  })

  if (!result.ok) {
    const err = result.error ?? 'Login test failed.'
    return {
      ok: false,
      message: err,
      log,
    }
  }

  return {
    ok: true,
    message: formatPortalLoginSuccessMessage(result.accountNumber ?? accountNumber),
    log,
  }
}

async function testPortalReachability(values, config, log) {
  const portalUrl = values.QC_PORTAL_URL?.trim().replace(/\/+$/, '')
  const username = values.QC_PORTAL_USERNAME?.trim()
  const password = values.QC_PORTAL_PASSWORD?.trim()

  if (!portalUrl || !username || !password) {
    logLine(log, 'Missing portal URL, username, or password.')
    return { ok: false, message: 'Save portal credentials before testing.', log }
  }

  logLine(log, `GET ${portalUrl}`)
  const rootRes = await fetch(portalUrl, { method: 'GET', redirect: 'follow' })
  logLine(log, `Portal root HTTP ${rootRes.status}`)

  const { loginUrl } = resolvePortalEndpoints(portalUrl, config.loginPath ?? '/login')
  logLine(log, `GET ${loginUrl}`)
  const loginRes = await fetch(loginUrl, { method: 'GET', redirect: 'follow' })
  logLine(log, `Login page HTTP ${loginRes.status}`)

  if (rootRes.status >= 500 || loginRes.status >= 500) {
    return { ok: false, message: 'Portal returned a server error.', log }
  }

  if (rootRes.status === 401 || rootRes.status === 403) {
    return { ok: false, message: 'Portal rejected the request (check URL).', log }
  }

  return {
    ok: true,
    message:
      'Portal is reachable. Extend the portal test handler for vendor-specific login flows.',
    log,
  }
}

async function testBitrix24Webhook(values, _config, log) {
  const webhookUrl = values.BITRIX24_WEBHOOK_URL?.trim()
  const apiToken = values.BITRIX24_API_TOKEN?.trim()
  if (!webhookUrl && !apiToken) {
    logLine(log, 'Missing webhook URL and API token.')
    return { ok: false, message: 'Save webhook URL or API token before testing.', log }
  }
  logLine(log, 'GET user.current via Bitrix24 REST')
  const result = await testBitrix24Connection({ webhookUrl, apiToken })
  if (!result.ok) {
    logLine(log, result.error ?? 'Connection failed')
    return { ok: false, message: result.error ?? 'Bitrix24 connection failed.', log }
  }
  logLine(log, result.message ?? 'OK')
  return {
    ok: true,
    message: result.message ?? 'Login successful — Bitrix24 connection verified.',
    log,
  }
}

const HANDLERS = {
  bitrix24_webhook: (values, _config, log) => testBitrix24Webhook(values, _config, log),
  anthropic_api: (values, _config, log) => testAnthropic(values, log),
  openai_api: (values, _config, log) => testOpenAi(values, log),
  http_bearer: (values, config, log) => testHttpBearer(values, config, log),
  amazon_sp_api: (values, _config, log) => testAmazonSpApi(values, log),
  portal_reachability: (values, config, log) => testPortalReachability(values, config, log),
  honeys_portal_login: (values, config, log, options) =>
    testHoneysPortalLogin(values, config, log, options),
  smtp_auth: (values, config, log) => smtpAuthTest(values, config, log),
}

/**
 * @param {string} handlerId
 * @param {Record<string, string>} values
 * @param {Record<string, string>} testConfig
 */
export async function runCredentialTestHandler(handlerId, values, testConfig, emitLog, options = {}) {
  const log = createLogEmitter(emitLog)
  const handler = HANDLERS[handlerId]
  if (!handler) {
    logLine(log, `No test handler registered for "${handlerId}".`)
    return {
      ok: false,
      message: 'No connection test is configured for this group.',
      log,
    }
  }

  try {
    const result = await handler(values, testConfig ?? {}, log, options)
    const lines = Array.isArray(result?.log) ? [...result.log] : [...log]
    return {
      ok: Boolean(result?.ok),
      message: String(result?.message ?? ''),
      log: lines.map(String),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Connection test failed.'
    logLine(log, msg)
    return { ok: false, message: redact(msg), log: [...log] }
  }
}
