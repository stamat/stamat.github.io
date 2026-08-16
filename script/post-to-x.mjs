#!/usr/bin/env node

// Posts blog entries to X when they become published, one post per entry, never twice.
//
// The post text is the entry's title and description, or whatever a `share:` front matter key
// holds instead — a `|` block there when it wants line breaks. The link is appended either way.
//
// "Became published" is decided by comparing two commits rather than by keeping a list of
// what was already posted: an entry counts as new when `published` is true at HEAD and was
// false or absent at BASE_SHA. That covers both a file added already published and a draft
// flipped on later, and it needs no state file and no commit back to the branch — which
// would retrigger the deploy this job hangs off.
//
// The trade the above makes: a force-push or a re-run over the same range reposts, and a
// range that skips over the flip posts nothing. Both are manual acts, and --dry-run is here
// to check a range before it goes out.

import { createHmac, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const BLOG_DIR = 'src/markup/blog'
const ENDPOINT = 'https://api.x.com/2/tweets'
const WHOAMI = 'https://api.x.com/2/users/me' // --whoami, to prove the signing and the keys without posting
const TWEET_LIMIT = 280
const URL_WEIGHT = 23 // every link costs this much whatever its length, t.co rewrites it
const MAX_PER_RUN = 5 // a rebase can hand this job a hundred commits; a burst of posts is a bug

const EMPTY_TREE_SHA = '0000000000000000000000000000000000000000'

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

/**
 * Scalars and `|`/`>` block scalars. Block support exists for `share`, which is prose written
 * for a timeline and wants its line breaks — a quoted one-liner would hand back a literal `\n`.
 *
 * Lists are still dropped silently, so `tags` reads as empty — ponytail: naive on purpose, and
 * the day a value this reads becomes a list, take the `yaml` package poops already pulls in
 * rather than growing this further.
 */
export function frontmatter (source) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)
  if (!block) return {}
  const fields = {}
  const lines = block[1].split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const pair = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(lines[i])
    if (!pair) continue
    const [, key, inline] = pair
    const style = /^([|>])([+-]?)\s*$/.exec(inline)

    if (!style) {
      fields[key] = inline.trim().replace(/^["'](.*)["']$/, '$1')
      continue
    }

    // Indented or blank lines belong to the block; the first line at column zero ends it.
    const body = []
    while (i + 1 < lines.length && (lines[i + 1].trim() === '' || /^[ \t]/.test(lines[i + 1]))) body.push(lines[++i])

    const indent = Math.min(...body.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)[0].length), Infinity)
    const text = body.map((l) => l.slice(Number.isFinite(indent) ? indent : 0))
    // `|` keeps every newline, `>` folds runs of text into one line and a blank line into a break.
    const joined = style[1] === '|'
      ? text.join('\n')
      : text.reduce((out, line) => (line.trim() ? (out && !out.endsWith('\n') ? `${out} ${line}` : out + line) : `${out}\n`), '')
    fields[key] = style[2] === '+' ? joined : joined.replace(/\n+$/, '')
  }

  return fields
}

export const isPublished = (source) => frontmatter(source).published === 'true'

/**
 * `share` replaces title and description when set; the link is appended either way, unless the
 * author already wrote it into `share` — so the URL lands in the post exactly once.
 *
 * ponytail: a `share` long enough to truncate and carrying the URL inline can have that URL cut
 * mid-string. Budget for it in the front matter; guarding it needs URL-aware truncation.
 */
export function composePost ({ share, title, description, url }) {
  const room = TWEET_LIMIT - URL_WEIGHT - 2
  let text = share || title
  if (!share && description && text.length + description.length + 2 <= room) text += `\n\n${description}`
  if (text.length > room) text = `${text.slice(0, room - 1).trimEnd()}…`
  return text.includes(url) ? text : `${text}\n\n${url}`
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' })

/** Empty string when the path does not exist at that commit, so a new file reads as unpublished. */
function readAt (sha, path) {
  try {
    return execFileSync('git', ['show', `${sha}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

function newlyPublished (baseSha, headSha) {
  const changed = git('diff', '--name-only', '--diff-filter=AM', baseSha, headSha, '--', BLOG_DIR)
    .split('\n')
    .filter((path) => path.endsWith('.md'))

  return changed.filter((path) => isPublished(readAt(headSha, path)) && !isPublished(readAt(baseSha, path)))
}

async function signedFetch (method, url, body, credentials) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: authorizationHeader({
        method,
        url,
        ...credentials,
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

async function main () {
  const dryRun = process.argv.includes('--dry-run')
  const credentials = {
    consumerKey: process.env.X_API_KEY,
    consumerSecret: process.env.X_API_SECRET,
    token: process.env.X_ACCESS_TOKEN,
    tokenSecret: process.env.X_ACCESS_SECRET
  }
  const credentialsMissing = Object.values(credentials).some((value) => !value)
  const CREDENTIALS_ERROR = 'Missing X credentials: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN and X_ACCESS_SECRET are all required.'

  if (process.argv.includes('--whoami')) {
    if (credentialsMissing) throw new Error(CREDENTIALS_ERROR)
    console.log(await signedFetch('GET', WHOAMI, null, credentials))
    return
  }

  const baseSha = process.env.BASE_SHA
  const headSha = process.env.HEAD_SHA || 'HEAD'

  if (!baseSha || baseSha === EMPTY_TREE_SHA) {
    console.log('No base commit to compare against — nothing posted.')
    return
  }

  const siteUrl = JSON.parse(readFileSync('poops.json', 'utf8')).markup.options.site.url.replace(/\/$/, '')

  const paths = newlyPublished(baseSha, headSha)
  if (!paths.length) {
    console.log('No newly published entries — nothing posted.')
    return
  }
  if (paths.length > MAX_PER_RUN) {
    console.log(`${paths.length} newly published entries, capped at ${MAX_PER_RUN}. Not posted: ${paths.slice(MAX_PER_RUN).join(', ')}`)
  }

  if (!dryRun && credentialsMissing) throw new Error(CREDENTIALS_ERROR)

  for (const path of paths.slice(0, MAX_PER_RUN)) {
    const fields = frontmatter(readAt(headSha, path))
    const text = composePost({
      share: fields.share,
      title: fields.title || basename(path, '.md'),
      description: fields.description,
      url: `${siteUrl}/blog/${basename(path, '.md')}.html`
    })

    if (dryRun) {
      console.log(`--- would post (${path}) ---\n${text}`)
      continue
    }

    await signedFetch('POST', ENDPOINT, { text }, credentials)
    console.log(`Posted ${path}`)
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
