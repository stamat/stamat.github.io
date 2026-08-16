#!/usr/bin/env node

// Posting newly published blog entries to X: OAuth 1.0a signing, the 280 character budget, and
// nothing else. Which entries count as new, and how their text is composed, is in `share.mjs`.

import { createHmac, randomBytes } from 'node:crypto'

import { cli } from './share.mjs'

const ENDPOINT = 'https://api.x.com/2/tweets'
const WHOAMI = 'https://api.x.com/2/users/me' // --whoami, to prove the signing and the keys without posting
const TWEET_LIMIT = 280
const URL_WEIGHT = 23 // every link costs this much whatever its length, t.co rewrites it

const ENV = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET']

/** RFC 3986 percent encoding — encodeURIComponent leaves five characters OAuth wants escaped. */
export function percentEncode (value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/**
 * The string an OAuth 1.0a signature is computed over. The request body is absent from it on
 * purpose: it is JSON, not form-encoded, so by the spec it contributes no parameters.
 */
export function signatureBaseString (method, url, params) {
  const normalized = Object.keys(params).sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&')
  return `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(normalized)}`
}

export function authorizationHeader ({ method, url, consumerKey, consumerSecret, token, tokenSecret, nonce, timestamp }) {
  const params = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp),
    oauth_token: token,
    oauth_version: '1.0'
  }
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`
  params.oauth_signature = createHmac('sha1', signingKey)
    .update(signatureBaseString(method, url, params))
    .digest('base64')

  return `OAuth ${Object.keys(params).sort()
    .map((key) => `${percentEncode(key)}="${percentEncode(params[key])}"`)
    .join(', ')}`
}

async function signedFetch (method, url, body, env) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: authorizationHeader({
        method,
        url,
        consumerKey: env.X_API_KEY,
        consumerSecret: env.X_API_SECRET,
        token: env.X_ACCESS_TOKEN,
        tokenSecret: env.X_ACCESS_SECRET,
        nonce: randomBytes(16).toString('hex'),
        timestamp: Math.floor(Date.now() / 1000)
      }),
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })

  const text = await response.text()
  if (!response.ok) throw new Error(`X returned ${response.status}: ${text}`)
  return text
}

export const x = {
  name: 'X',
  env: ENV,
  limit: TWEET_LIMIT,
  urlWeight: URL_WEIGHT,
  post: (text, env) => signedFetch('POST', ENDPOINT, { text }, env),
  commands: {
    '--whoami': { env: ENV, run: (env) => signedFetch('GET', WHOAMI, null, env) }
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) cli(x)
