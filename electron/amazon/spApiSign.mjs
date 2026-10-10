/**
 * Build an authenticated SP-API GET using Login with Amazon (LWA) access token only.
 *
 * @param {{ host: string, path: string, query?: string, accessToken: string }} opts
 */
export function buildSpApiGetRequest(opts) {
  const host = opts.host
  const canonicalPath = opts.path.startsWith('/') ? opts.path : `/${opts.path}`
  const query = opts.query?.trim() ?? ''
  const url = query
    ? `https://${host}${canonicalPath}?${query}`
    : `https://${host}${canonicalPath}`

  return {
    url,
    headers: {
      'x-amz-access-token': opts.accessToken,
      Accept: 'application/json',
      'User-Agent': 'HonyQcTool/1.0 (Language=Node)',
    },
  }
}
