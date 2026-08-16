// Covers the parts of share.mjs that are wrong silently: front matter reading, the opt-out, and
// the character budget a post is composed against — including the budget differing per network.
//
// Deliberately not covered: the git range walk and `run` itself. Both need a repository and a
// network to be meaningful, and neither has logic worth a fake — the first real post is what
// proves them, and `--dry-run` is what checks the range before it goes out.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { frontmatter, isPublished, isOptedOut, composePost } from './share.mjs'

// X's budget, the tighter of the two: 280 characters and a flat 23 for the link.
const tweet = (fields) => composePost({ ...fields, limit: 280, urlWeight: 23 })

test('front matter reads scalar keys and strips the quotes around a value', () => {
  const fields = frontmatter('---\ntitle: "Hello: a greeting"\npublished: true\n---\n\nBody: not front matter\n')
  assert.equal(fields.title, 'Hello: a greeting', 'a colon inside the value truncated it')
  assert.equal(fields.published, 'true')
  assert.equal(fields.Body, undefined, 'a line past the closing --- was read as front matter')
})

test('an entry counts as published only when it says so', () => {
  assert.equal(isPublished('---\npublished: true\n---\n'), true)
  assert.equal(isPublished('---\npublished: false\n---\n'), false)
  assert.equal(isPublished('---\ntitle: Draft\n---\n'), false, 'a missing published key read as published')
  assert.equal(isPublished(''), false, 'a file absent at that commit read as published')
})

test('the link survives a title and description that together would overflow', () => {
  const url = 'https://stamat.info/blog/x.html'
  const text = tweet({ title: 'T'.repeat(200), description: 'D'.repeat(200), url })
  assert.ok(text.endsWith(`\n\n${url}`), 'the link was cut instead of the description')
  assert.ok(!text.includes('DDDD'), 'the description was kept past the budget')
  assert.ok(text.length - url.length + 23 <= 280, 'the post is over the limit once the link is weighed')
})

test('a title longer than the whole budget is truncated rather than dropped', () => {
  const text = tweet({ title: 'T'.repeat(400), url: 'https://stamat.info/blog/x.html' })
  assert.ok(text.startsWith('TTT'), 'the title vanished')
  assert.ok(text.includes('…'), 'the title was cut with no sign it was cut')
})

test('a short entry keeps its description', () => {
  const text = tweet({ title: 'Hello World!', description: 'A first post.', url: 'https://stamat.info/blog/hello-world.html' })
  assert.equal(text, 'Hello World!\n\nA first post.\n\nhttps://stamat.info/blog/hello-world.html')
})

test('a share message replaces the title and description, and still gets the link', () => {
  const text = tweet({
    share: 'Thirteen years late, but here it is.',
    title: 'How a classic derail led me to create a fast object deduplication function',
    description: 'A sequel.',
    url: 'https://stamat.info/blog/fastest-dedupe.html'
  })
  assert.equal(text, 'Thirteen years late, but here it is.\n\nhttps://stamat.info/blog/fastest-dedupe.html')
})

test('a share message that already carries the link does not get it twice', () => {
  const url = 'https://stamat.info/blog/x.html'
  const text = tweet({ share: `Read it here: ${url} — worth your time`, title: 'T', url })
  assert.equal(text.split(url).length - 1, 1, 'the link was appended on top of one already written')
})

test('an empty share falls back to the title, it does not post a blank', () => {
  const text = tweet({ share: '', title: 'Hello World!', url: 'https://stamat.info/blog/hello-world.html' })
  assert.equal(text, 'Hello World!\n\nhttps://stamat.info/blog/hello-world.html')
})

test('a link costs its own length where nothing rewrites it, and a flat 23 on X', () => {
  const url = `https://stamat.info/blog/${'a'.repeat(100)}.html`
  const wide = composePost({ title: 'T'.repeat(400), url, limit: 280 })
  const narrow = composePost({ title: 'T'.repeat(400), url, limit: 280, urlWeight: 23 })
  assert.ok(narrow.length > wide.length, 'the long link was charged as 23 on a network that does not shorten it')
  assert.ok(wide.length <= 280, 'the untouched link pushed the post over the limit')
})

test('a description that fits a long budget is kept where a short one would have cut it', () => {
  const fields = { title: 'T'.repeat(300), description: 'D'.repeat(300), url: 'https://stamat.info/blog/x.html' }
  assert.ok(!tweet(fields).includes('DDDD'), 'the description survived a 280 budget')
  assert.ok(composePost({ ...fields, limit: 3000 }).includes('DDDD'), 'the description was cut inside a 3000 budget')
})

test('share: false opts an entry out, and nothing else does', () => {
  assert.equal(isOptedOut(frontmatter('---\nshare: false\n---\n')), true)
  assert.equal(isOptedOut(frontmatter('---\ntitle: A post\n---\n')), false, 'an entry with no share key was skipped')
  assert.equal(isOptedOut(frontmatter('---\nshare: Some words.\n---\n')), false, 'a share message was read as an opt-out')
  assert.equal(isOptedOut(frontmatter('---\nshare: "false"\n---\n')), true, 'quoting it changed the meaning')
})

test('a published entry that opts out is still published, it is only unshared', () => {
  const source = '---\npublished: true\nshare: false\n---\n'
  assert.equal(isPublished(source), true, 'opting out of sharing was read as opting out of publishing')
  assert.equal(isOptedOut(frontmatter(source)), true)
})

test('a literal block scalar keeps the line breaks the author wrote', () => {
  const fields = frontmatter([
    '---',
    'title: A post',
    'share: |',
    '  First line.',
    '',
    '  Second line.',
    'published: true',
    '---',
    '',
    'Body.'
  ].join('\n'))
  assert.equal(fields.share, 'First line.\n\nSecond line.', 'the block was flattened or the indent survived')
  assert.equal(fields.published, 'true', 'the key after the block was swallowed by it')
  assert.equal(fields.title, 'A post')
})

test('a folded block scalar joins lines with spaces and keeps the paragraph break', () => {
  const fields = frontmatter('---\nshare: >\n  One two\n  three.\n\n  Next para.\n---\n')
  assert.equal(fields.share, 'One two three.\nNext para.')
})

test('a block scalar is not confused by a colon inside it', () => {
  const fields = frontmatter('---\nshare: |\n  Note: this has a colon\nafter: yes\n---\n')
  assert.equal(fields.share, 'Note: this has a colon', 'the colon line was parsed as a new key')
  assert.equal(fields.after, 'yes', 'the key after the block was lost')
})
