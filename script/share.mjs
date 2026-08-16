// Decides which blog entries just became published, composes a post out of each, and hands it to a
// network that knows only how to authenticate and how to send. Everything below is network
// agnostic; everything network specific lives in `post-to-<network>.mjs`. X is the only one.
//
// The post text is the entry's title and description, or whatever a `share:` front matter key
// holds instead — a `|` block there when it wants line breaks. The link is appended either way.
// `share: false` publishes the entry without posting it anywhere.
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

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const BLOG_DIR = 'src/markup/blog'
const MAX_PER_RUN = 5 // a rebase can hand this job a hundred commits; a burst of posts is a bug

const EMPTY_TREE_SHA = '0000000000000000000000000000000000000000'

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
 * `share: false` opts an entry out of being posted at all. Only the exact word — YAML's other
 * falsy spellings (`no`, `off`) are not read, because this parser sees strings, not booleans,
 * and quietly treating `no` as prose to post is worse than not accepting it.
 */
export const isOptedOut = (fields) => fields.share === 'false'

/**
 * `share` replaces title and description when set; the link is appended either way, unless the
 * author already wrote it into `share` — so the URL lands in the post exactly once.
 *
 * `urlWeight` is what the link costs against `limit`, which is not its length everywhere: X
 * rewrites every link through t.co and charges a flat 23 whatever was written.
 *
 * ponytail: a `share` long enough to truncate and carrying the URL inline can have that URL cut
 * mid-string. Budget for it in the front matter; guarding it needs URL-aware truncation.
 */
export function composePost ({ share, title, description, url, limit, urlWeight = url.length }) {
  const room = limit - urlWeight - 2
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

export function newlyPublished (baseSha, headSha) {
  const changed = git('diff', '--name-only', '--diff-filter=AM', baseSha, headSha, '--', BLOG_DIR)
    .split('\n')
    .filter((path) => path.endsWith('.md'))

  return changed.filter((path) => isPublished(readAt(headSha, path)) && !isPublished(readAt(baseSha, path)))
}

/**
 * A network is `{ name, env, limit, urlWeight, post, commands }`: the secrets it needs by
 * environment variable name, the budget its text is composed against, one `post(text, env)`, and
 * optional `--flag` commands, which is where a credential check that sends nothing goes — the
 * alternative way to find out a token died is a missed post.
 *
 * Each command carries its own `env`, so a secret only one command needs cannot fail a deploy.
 */
export async function run (network) {
  const dryRun = process.argv.includes('--dry-run')
  const flag = Object.keys(network.commands || {}).find((name) => process.argv.includes(name))
  const command = flag ? network.commands[flag] : null

  const required = command ? command.env : network.env
  const env = Object.fromEntries(required.map((key) => [key, process.env[key]]))
  const missing = required.filter((key) => !env[key])
  const credentialsError = () => new Error(`Missing ${network.name} credentials: ${missing.join(', ')}.`)

  if (command) {
    if (missing.length) throw credentialsError()
    console.log(await command.run(env))
    return
  }

  const baseSha = process.env.BASE_SHA
  const headSha = process.env.HEAD_SHA || 'HEAD'

  if (!baseSha || baseSha === EMPTY_TREE_SHA) {
    console.log('No base commit to compare against — nothing posted.')
    return
  }

  const siteUrl = JSON.parse(readFileSync('poops.json', 'utf8')).markup.options.site.url.replace(/\/$/, '')

  const found = newlyPublished(baseSha, headSha).map((path) => ({ path, fields: frontmatter(readAt(headSha, path)) }))
  if (!found.length) {
    console.log('No newly published entries — nothing posted.')
    return
  }

  // Opting out is counted before the cap, so silent entries cannot push loud ones off the end.
  const optedOut = found.filter((entry) => isOptedOut(entry.fields))
  const entries = found.filter((entry) => !isOptedOut(entry.fields))
  if (optedOut.length) console.log(`Opted out with share: false — ${optedOut.map((entry) => entry.path).join(', ')}`)
  if (!entries.length) {
    console.log('Every newly published entry opted out — nothing posted.')
    return
  }
  if (entries.length > MAX_PER_RUN) {
    console.log(`${entries.length} entries to share, capped at ${MAX_PER_RUN}. Not posted: ${entries.slice(MAX_PER_RUN).map((entry) => entry.path).join(', ')}`)
  }

  if (!dryRun && missing.length) throw credentialsError()

  for (const { path, fields } of entries.slice(0, MAX_PER_RUN)) {
    const text = composePost({
      share: fields.share,
      title: fields.title || basename(path, '.md'),
      description: fields.description,
      url: `${siteUrl}/blog/${basename(path, '.md')}.html`,
      limit: network.limit,
      urlWeight: network.urlWeight
    })

    if (dryRun) {
      console.log(`--- would post to ${network.name} (${path}) ---\n${text}`)
      continue
    }

    await network.post(text, env)
    console.log(`Posted ${path} to ${network.name}`)
  }
}

/** Every entry point wants the same two lines: run, print the message, exit non-zero. */
export function cli (network) {
  run(network).catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
