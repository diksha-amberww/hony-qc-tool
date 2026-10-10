const COOLDOWN_MS = 5000

/** @type {Promise<void>} */
let chain = Promise.resolve()

/** @type {number} */
let lastFinishedAt = 0

/**
 * Enforce a global minimum interval between Honey's catalog HTTP requests.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withHoneysRequestCooldown(fn) {
  const run = async () => {
    const now = Date.now()
    const waitMs = Math.max(0, COOLDOWN_MS - (now - lastFinishedAt))
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
    try {
      return await fn()
    } finally {
      lastFinishedAt = Date.now()
    }
  }

  const next = chain.then(run, run)
  chain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}
