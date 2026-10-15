import { BrowserWindow, session as electronSession } from 'electron'
import { HoneysCookieJar } from './honeysCookieJar.mjs'
import { adoptHoneysPortalBrowserWindow } from './honeysPortalBrowser.mjs'

/** Canonical URLs (overridden when credentials supply a custom portal base). */
export const DEFAULT_LOGIN_URL = 'https://www.honeysplace.com/login'
export const DEFAULT_CHOOSE_ACCOUNT_URL = 'https://www.honeysplace.com/choose-account'
export const DEFAULT_HOME_URL = 'https://www.honeysplace.com/home'
export const DEFAULT_ACCOUNT_NUMBER = '22197DS'

/**
 * DOM selectors from HTML/login_page.html
 * - input#email[name="email"]
 * - input#password[name="password"]
 * - button[type="submit"].btn-primary-custom ("Login")
 */
const SELECTORS = {
  email: 'input#email[name="email"]',
  password: 'input#password[name="password"]',
  submit: 'form[action="/login"] button[type="submit"].btn-primary-custom',
  loginHeading: 'h5.fw-normal',
}

/**
 * Success markers from HTML/confirmation_page.html
 * - .choose-account-page
 * - h1.ca-title "Choose Account"
 * - #table-choose-account
 */
const SUCCESS_MARKERS = {
  pageRoot: '.choose-account-page',
  title: 'h1.ca-title',
  accountsTable: '#table-choose-account',
}

const NAVIGATION_TIMEOUT_MS = 90_000
/** Max time for Select retries until /home (first click + 3s wait, then 1s between retries). */
const HOME_NAVIGATION_TIMEOUT_MS = 60_000
const POST_LOAD_DELAY_MS = { min: 2000, max: 3000 }

const HOME_MARKERS = {
  headerRoot: '.hp-header-root',
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomDelay(min, max) {
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  return delay(lo + Math.floor(Math.random() * (hi - lo + 1)))
}

/** Injected into the page — scroll into view and dispatch a full click sequence (headless-safe). */
const FORCE_DOM_CLICK_HELPER = `function forceDomClick(el) {
      if (!el || !el.isConnected) return { ok: false, reason: 'disconnected' };
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const opts = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        detail: 1,
        button: 0,
        buttons: 1,
        clientX: cx,
        clientY: cy,
      };
      try {
        if (typeof PointerEvent === 'function') {
          el.dispatchEvent(
            new PointerEvent('pointerdown', { ...opts, pointerId: 1, pointerType: 'mouse' }),
          );
        }
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        if (typeof el.focus === 'function') {
          try {
            el.focus({ preventScroll: true });
          } catch {
            el.focus();
          }
        }
        if (typeof PointerEvent === 'function') {
          el.dispatchEvent(
            new PointerEvent('pointerup', { ...opts, pointerId: 1, pointerType: 'mouse' }),
          );
        }
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
        if (typeof el.click === 'function') {
          el.click();
        }
        return { ok: true, centerX: cx, centerY: cy };
      } catch (err) {
        return {
          ok: false,
          reason: 'click_failed',
          error: err && err.message ? String(err.message) : String(err),
        };
      }
    }`

function normalizePath(url) {
  try {
    return new URL(url).pathname.replace(/\/+$/, '').toLowerCase()
  } catch {
    return ''
  }
}

export function isChooseAccountUrl(url, confirmationUrl) {
  const path = normalizePath(url)
  const expected = normalizePath(confirmationUrl)
  return path === expected || path.endsWith('/choose-account')
}

export function isHomeUrl(url, homeUrl = DEFAULT_HOME_URL) {
  const path = normalizePath(url)
  const expected = normalizePath(homeUrl)
  return path === expected || path.endsWith('/home')
}

/**
 * @param {import('electron').WebContents} webContents
 */
export async function readHomePageState(webContents, homeUrl) {
  return webContents.executeJavaScript(
    `(() => {
      const path = window.location.pathname.replace(/\\/+$/,'').toLowerCase();
      const onHome = path.endsWith('/home');
      const hasHeader = Boolean(document.querySelector(${JSON.stringify(HOME_MARKERS.headerRoot)}));
      const chooseAccount = Boolean(document.querySelector(${JSON.stringify(SUCCESS_MARKERS.pageRoot)}));
      return {
        url: window.location.href,
        onHome,
        hasHeader,
        chooseAccount,
      };
    })()`,
    true,
  )
}

export async function verifyHomePageLoaded(webContents, homeUrl) {
  const state = await readHomePageState(webContents, homeUrl)
  return isHomeUrl(state.url, homeUrl) && state.hasHeader && !state.chooseAccount
}

/**
 * @param {import('electron').WebContents} webContents
 * @param {{ accountNumber: string, homeUrl: string, log: (msg: string) => void }} params
 */
export async function selectAccountAndWaitForHome(webContents, params) {
  const { accountNumber, homeUrl, log } = params
  const want = String(accountNumber ?? '').trim()
  if (!want) {
    return { ok: false, error: 'Account number is required to complete portal login.' }
  }

  const pageUrl = () => webContents.getURL()

  if (isHomeUrl(pageUrl(), homeUrl)) {
    log('Successfully navigated to Home Page')
    return { ok: true, finalUrl: pageUrl() }
  }

  log(`Step 6–7: Select account ${want} and wait for ${homeUrl}…`)

  const clickSelectScript = `(() => {
      ${FORCE_DOM_CLICK_HELPER}
      const want = ${JSON.stringify(want)};
      const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
      const rows = document.querySelectorAll(${JSON.stringify(`${SUCCESS_MARKERS.accountsTable} tbody tr`)});
      for (const row of rows) {
        if (!row.textContent || !row.textContent.includes(want)) continue;
        const cells = [...row.querySelectorAll('td')].map((td) => norm(td.textContent));
        if (!cells.some((text) => text === want)) continue;
        const selectEl =
          row.querySelector('a.ca-select-btn') ||
          [...row.querySelectorAll('a, button')].find((el) => norm(el.textContent) === 'Select');
        if (!selectEl) return { clicked: false, reason: 'no_button' };
        const clickOutcome = forceDomClick(selectEl);
        if (!clickOutcome.ok) {
          return {
            clicked: false,
            reason: clickOutcome.reason || 'click_failed',
            error: clickOutcome.error || '',
          };
        }
        return { clicked: true, href: selectEl.href || '' };
      }
      return { clicked: false, reason: 'not_found' };
    })()`

  const deadline = Date.now() + HOME_NAVIGATION_TIMEOUT_MS
  let clickAttempts = 0
  let sawAccountRow = false

  while (Date.now() < deadline) {
    if (isHomeUrl(pageUrl(), homeUrl)) {
      log('Successfully navigated to Home Page')
      return { ok: true, finalUrl: pageUrl() }
    }

    let clickResult
    try {
      clickResult = await webContents.executeJavaScript(clickSelectScript, true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`Select click script error: ${msg}`)
      await delay(500)
      continue
    }

    if (clickResult?.reason === 'not_found') {
      log(`Scanning table rows for account: ${want} (row not found yet)`)
      await delay(500)
      continue
    }

    if (clickResult?.reason === 'no_button') {
      return { ok: false, error: `Account ${want} found but Select button missing in that row.` }
    }

    if (!clickResult?.clicked) {
      const detail = clickResult?.error ? `: ${clickResult.error}` : ''
      return { ok: false, error: `Select click failed${detail}` }
    }

    sawAccountRow = true
    clickAttempts += 1
    if (clickAttempts === 1) {
      log(`Found account row for ${want}. Clicking Select (attempt ${clickAttempts})…`)
    } else {
      log(`Retrying Select click (attempt ${clickAttempts})…`)
    }
    log(`Current URL after click: ${pageUrl()}`)
    if (clickResult.href) {
      log(`Select href: ${clickResult.href}`)
    }

    const waitMs = clickAttempts === 1 ? 3000 : 1000
    await delay(waitMs)

    if (isHomeUrl(pageUrl(), homeUrl)) {
      log('Successfully navigated to Home Page')
      return { ok: true, finalUrl: pageUrl() }
    }

    log(`Not on home yet (URL: ${pageUrl()}), will click Select again…`)
  }

  if (!sawAccountRow) {
    return { ok: false, error: `Account ${want} not found in your account list` }
  }

  log(`Timed out waiting for home. Last URL: ${pageUrl()}`)
  return { ok: false, error: 'Timeout' }
}

/**
 * @param {string} html
 */
export function pageHtmlIndicatesCaptcha(html) {
  const lower = html.toLowerCase()
  return (
    lower.includes('g-recaptcha') ||
    lower.includes('recaptcha') ||
    lower.includes('hcaptcha') ||
    lower.includes('cf-turnstile') ||
    (lower.includes('captcha') && !lower.includes('choose account'))
  )
}

/**
 * @param {import('electron').WebContents} webContents
 */
async function readPageDiagnostics(webContents) {
  return webContents.executeJavaScript(
    `(() => {
      const text = (el) => (el?.textContent ?? '').replace(/\\s+/g, ' ').trim();
      const alerts = [...document.querySelectorAll('.alert, .alert-danger, .invalid-feedback')]
        .map(text)
        .filter(Boolean);
      const onLogin = ${JSON.stringify('/login')}.split('/').pop();
      const path = window.location.pathname.replace(/\\/+$/,'').toLowerCase();
      const stillOnLogin = path.endsWith(onLogin);
      const html = document.documentElement.innerHTML.toLowerCase();
      const captcha =
        html.includes('g-recaptcha') ||
        html.includes('recaptcha') ||
        html.includes('hcaptcha') ||
        html.includes('cf-turnstile');
      const wrongPassword =
        /credentials do not match|invalid email|incorrect password|wrong password/i.test(
          alerts.join(' ') + ' ' + document.body.innerText,
        );
      const success = {
        hasPage: Boolean(document.querySelector(${JSON.stringify(SUCCESS_MARKERS.pageRoot)})),
        hasTitle: text(document.querySelector(${JSON.stringify(SUCCESS_MARKERS.title)}))
          .toLowerCase()
          .includes('choose account'),
        hasTable: Boolean(document.querySelector(${JSON.stringify(SUCCESS_MARKERS.accountsTable)})),
      };
      const hasEmailField = Boolean(document.querySelector(${JSON.stringify(SELECTORS.email)}));
      const hasPasswordField = Boolean(document.querySelector(${JSON.stringify(SELECTORS.password)}));
      return {
        url: window.location.href,
        stillOnLogin,
        captcha,
        wrongPassword,
        alerts,
        success,
        hasEmailField,
        hasPasswordField,
      };
    })()`,
    true,
  )
}

/**
 * @param {import('electron').WebContents} webContents
 */
async function verifyChooseAccountLayout(webContents, confirmationUrl) {
  const diag = await readPageDiagnostics(webContents)
  return (
    isChooseAccountUrl(diag.url, confirmationUrl) &&
    diag.success.hasPage &&
    diag.success.hasTitle &&
    diag.success.hasTable
  )
}

function isLoginFormPresent(diag) {
  return Boolean(diag?.hasEmailField && diag?.hasPasswordField)
}

function isChooseAccountSuccess(diag, confirmationUrl) {
  return (
    isChooseAccountUrl(diag.url, confirmationUrl) &&
    diag.success?.hasPage &&
    diag.success?.hasTitle &&
    diag.success?.hasTable
  )
}

async function clearBrowserDataForOrigin(sess, origin) {
  await sess.clearStorageData({ origin })
  await sess.clearCache()
  const cookies = await sess.cookies.get({ url: origin })
  for (const cookie of cookies) {
    const url = `${origin}${cookie.path || '/'}`
    try {
      await sess.cookies.remove(url, cookie.name)
    } catch {
      // ignore per-cookie removal errors
    }
  }
}

function classifyFailure(diag) {
  if (diag.captcha) return 'CAPTCHA'
  if (diag.wrongPassword) return 'Wrong Password'
  if (diag.stillOnLogin) {
    const alert = diag.alerts[0]
    return alert ? `Login failed — ${alert}` : 'Still on login page after submit'
  }
  return 'Timeout'
}

/**
 * @param {import('electron').BrowserWindow} win
 * @param {{
 *   confirmationUrl: string
 *   accountNumber: string
 *   homeUrl: string
 *   headless: boolean
 *   keepBrowserForScraping?: boolean
 *   partitionSession: import('electron').Session
 *   origin: string
 *   log: (msg: string) => void
 * }} params
 */
async function finalizeHoneysPortalLogin(win, params) {
  const { confirmationUrl, accountNumber, homeUrl, headless, log, partitionSession, origin } =
    params
  const showWindow = headless === false

  if (isHomeUrl(win.webContents.getURL(), homeUrl)) {
    const homeOk = await verifyHomePageLoaded(win.webContents, homeUrl)
    if (homeOk) {
      log('Already on Honey\'s Place home — reusing active session.')
    }
  } else {
    const layoutOk = await verifyChooseAccountLayout(win.webContents, confirmationUrl)
    if (!layoutOk) {
      log('Login failed: reached unexpected page (Choose Account layout not matched).')
      if (!showWindow && !win.isDestroyed()) win.close()
      return { ok: false, error: 'Login did not match Choose Account confirmation layout.' }
    }

    const accountStep = await selectAccountAndWaitForHome(win.webContents, {
      accountNumber,
      homeUrl,
      log,
    })
    if (!accountStep.ok) {
      const err = accountStep.error ?? 'Account selection failed.'
      log(`Login failed: ${err}`)
      if (!showWindow && !win.isDestroyed()) win.close()
      return { ok: false, error: err }
    }
  }

  const finalUrl = win.webContents.getURL()

  const electronCookies = await partitionSession.cookies.get({ url: origin })
  const jar = new HoneysCookieJar()
  for (const cookie of electronCookies) {
    jar.ingestElectronCookie(cookie)
  }

  if (headless && params.keepBrowserForScraping) {
    adoptHoneysPortalBrowserWindow(win)
    log('Browser session kept open for Livewire scraping.')
  } else if (headless) {
    win.close()
  } else {
    adoptHoneysPortalBrowserWindow(win)
    log('Debug mode: browser window left open — close it when finished inspecting.')
  }

  return { ok: true, jar, finalUrl, browserWindow: win.isDestroyed() ? null : win }
}

/**
 * Step-by-step Honey's Place portal login in an Electron BrowserWindow.
 *
 * @param {{
 *   loginUrl: string
 *   confirmationUrl: string
 *   email: string
 *   password: string
 *   headless: boolean
 *   freshSession?: boolean
 *   accountNumber?: string
 *   homeUrl?: string
 *   keepBrowserForScraping?: boolean
 *   log: (msg: string) => void
 * }} params
 */
export async function loginHoneysPlaceWithBrowser(params) {
  const { loginUrl, confirmationUrl, email, password, headless, log } = params
  const accountNumber = String(params.accountNumber ?? DEFAULT_ACCOUNT_NUMBER).trim()
  const homeUrl = params.homeUrl ?? DEFAULT_HOME_URL
  const freshSession = params.freshSession !== false
  const showWindow = headless === false
  const origin = new URL(loginUrl).origin
  const partition = freshSession
    ? `honeys-fresh-${Date.now()}`
    : 'honeys-portal-persist'

  if (freshSession) {
    log('Clearing Honey\'s Place browser cookies and storage (fresh test session)…')
    await clearBrowserDataForOrigin(electronSession.defaultSession, origin)
  }

  log(`Step 1: Navigate to ${loginUrl}`)
  log(`Headless mode: ${headless ? 'ON (background browser)' : 'OFF (visible window for debug)'}`)

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: showWindow,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition,
      backgroundThrottling: false,
    },
  })

  const partitionSession = win.webContents.session
  if (freshSession) {
    await clearBrowserDataForOrigin(partitionSession, origin)
  }

  let loginSubmitted = false

  const waitForSuccessOrFailure = () =>
    new Promise((resolve, reject) => {
      const deadline = Date.now() + NAVIGATION_TIMEOUT_MS

      const check = async () => {
        if (win.isDestroyed()) {
          reject(new Error('Login window closed before completion.'))
          return
        }

        let diag
        try {
          diag = await readPageDiagnostics(win.webContents)
        } catch {
          schedule()
          return
        }

        if (diag.captcha) {
          cleanup()
          resolve({ ok: false, error: 'CAPTCHA' })
          return
        }

        if (isChooseAccountSuccess(diag, confirmationUrl)) {
          cleanup()
          resolve({ ok: true, finalUrl: diag.url })
          return
        }

        if (diag.stillOnLogin && (diag.wrongPassword || diag.alerts.length > 0)) {
          cleanup()
          resolve({ ok: false, error: classifyFailure(diag) })
          return
        }

        if (Date.now() >= deadline) {
          cleanup()
          resolve({ ok: false, error: 'Timeout' })
          return
        }

        schedule()
      }

      const schedule = () => {
        setTimeout(() => {
          void check()
        }, 500)
      }

      let lastLoggedNav = ''
      let lastLoggedNavAt = 0
      const onNavigate = (_event, url) => {
        const now = Date.now()
        if (url !== lastLoggedNav || now - lastLoggedNavAt > 1500) {
          log(`Navigated → ${url}`)
          lastLoggedNav = url
          lastLoggedNavAt = now
        }
        void check()
      }

      const cleanup = () => {
        win.webContents.removeListener('did-navigate', onNavigate)
        win.webContents.removeListener('did-navigate-in-page', onNavigate)
      }

      win.webContents.on('did-navigate', onNavigate)
      win.webContents.on('did-navigate-in-page', onNavigate)
      void check()
    })

  try {
    await win.loadURL(loginUrl)

    log('Step 2: Waiting 2–3s for the login page to settle…')
    await randomDelay(POST_LOAD_DELAY_MS.min, POST_LOAD_DELAY_MS.max)

    const preSubmit = await readPageDiagnostics(win.webContents)
    if (preSubmit.captcha) {
      return { ok: false, error: 'CAPTCHA' }
    }

    const alreadyOnChooseAccount = isChooseAccountSuccess(preSubmit, confirmationUrl)
    const alreadyOnHome =
      isHomeUrl(preSubmit.url, homeUrl) && (await verifyHomePageLoaded(win.webContents, homeUrl))

    if (alreadyOnChooseAccount) {
      log(`Loaded ${preSubmit.url} — already authenticated (continuing to account selection).`)
    } else if (alreadyOnHome) {
      log(`Loaded ${preSubmit.url} — home page already active (reusing session).`)
      return finalizeHoneysPortalLogin(win, {
        confirmationUrl,
        accountNumber,
        homeUrl,
        headless,
        keepBrowserForScraping: params.keepBrowserForScraping,
        partitionSession,
        origin,
        log,
      })
    } else if (!isLoginFormPresent(preSubmit)) {
      log(`Expected login form at ${loginUrl} but page is: ${preSubmit.url}`)
      if (isChooseAccountUrl(preSubmit.url, confirmationUrl)) {
        log('On Choose Account without login form — continuing account selection.')
      } else {
        if (!showWindow && !win.isDestroyed()) win.close()
        return { ok: false, error: 'Could not find login form fields (#email / #password).' }
      }
    } else {
    log('Step 3: Filling email and password fields')
    const fillResult = await win.webContents.executeJavaScript(
      `(() => {
        const emailEl = document.querySelector(${JSON.stringify(SELECTORS.email)});
        const passEl = document.querySelector(${JSON.stringify(SELECTORS.password)});
        if (!emailEl || !passEl) {
          return { ok: false, reason: 'missing_fields' };
        }
        const setValue = (el, value) => {
          el.focus();
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        setValue(emailEl, ${JSON.stringify(email)});
        setValue(passEl, ${JSON.stringify(password)});
        return { ok: true };
      })()`,
      true,
    )

    if (!fillResult?.ok) {
      return { ok: false, error: 'Could not find login form fields (#email / #password).' }
    }

    log('Step 4: Clicking Login')
    const clickResult = await win.webContents.executeJavaScript(
      `(() => {
        const btn = document.querySelector(${JSON.stringify(SELECTORS.submit)});
        if (!btn) return { ok: false, reason: 'missing_submit' };
        btn.click();
        return { ok: true };
      })()`,
      true,
    )

    if (!clickResult?.ok) {
      return { ok: false, error: 'Could not find the Login submit button.' }
    }

    loginSubmitted = true
    log(`Step 5: Waiting for ${confirmationUrl} and Choose Account layout…`)
    const outcome = await waitForSuccessOrFailure()

    if (!outcome.ok) {
      const err = outcome.error === 'Timeout' ? 'Timeout' : outcome.error
      log(`Login failed: ${err}`)
      if (!showWindow && !win.isDestroyed()) win.close()
      return { ok: false, error: err }
    }
    }

    return finalizeHoneysPortalLogin(win, {
      confirmationUrl,
      accountNumber,
      homeUrl,
      headless,
      keepBrowserForScraping: params.keepBrowserForScraping,
      partitionSession,
      origin,
      log,
    })
  } catch (err) {
    if (!win.isDestroyed()) win.close()
    const msg = err instanceof Error ? err.message : String(err)
    if (/timed out|timeout/i.test(msg)) {
      return { ok: false, error: 'Timeout' }
    }
    return { ok: false, error: msg || 'Browser login failed.' }
  }
}
