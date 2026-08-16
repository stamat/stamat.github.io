// Covers the parts of post-to-x that are wrong silently: percent encoding, the signature base
// string assembled from it, front matter reading, and the 280 character budget.
//
// Deliberately not covered: the HTTP call and the git range walk. Both need a network or a
// repository to be meaningful, and neither has logic worth a fake — the first real post is
// what proves them, and `--dry-run` is what checks the range before it goes out.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { percentEncode, signatureBaseString, frontmatter, isPublished, isOptedOut, composePost } from './post-to-x.mjs'

test('percent encoding escapes the five characters encodeURIComponent leaves alone', () => {
  assert.equal(percentEncode("!'()*"), '%21%27%28%29%2A', 'a character OAuth wants escaped survived raw')
  assert.equal(percentEncode('~-._'), '~-._', 'an unreserved character was escaped')
  assert.equal(percentEncode('Ladies + Gentlemen'), 'Ladies%20%2B%20Gentlemen')
})

test('a secret with punctuation in it cannot break out of the string it is signed into', () => {
  assert.equal(percentEncode('se&cret=with?junk'), 'se%26cret%3Dwith%3Fjunk')
})

test('the signature base string is method, url and parameters, each encoded once', () => {
  const base = signatureBaseString('post', 'https://api.x.com/2/tweets', {
    oauth_nonce: 'abc',
    oauth_consumer_key: 'key'
  })
  assert.equal(base, 'POST&https%3A%2F%2Fapi.x.com%2F2%2Ftweets&oauth_consumer_key%3Dkey%26oauth_nonce%3Dabc')
})

test('parameters are sorted by key, not left in the order they were written', () => {
  const base = signatureBaseString('POST', 'https://x/', { b: '1', a: '2' })
  assert.match(base, /a%3D2%26b%3D1$/, 'parameters reached the base string unsorted')
})

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
  const text = composePost({ title: 'T'.repeat(200), description: 'D'.repeat(200), url })
  assert.ok(text.endsWith(`\n\n${url}`), 'the link was cut instead of the description')
  assert.ok(!text.includes('DDDD'), 'the description was kept past the budget')
  assert.ok(text.length - url.length + 23 <= 280, 'the post is over the limit once the link is weighed')
})

test('a title longer than the whole budget is truncated rather than dropped', () => {
  const text = composePost({ title: 'T'.repeat(400), url: 'https://stamat.info/blog/x.html' })
  assert.ok(text.startsWith('TTT'), 'the title vanished')
  assert.ok(text.includes('…'), 'the title was cut with no sign it was cut')
})

test('a short entry keeps its description', () => {
  const text = composePost({ title: 'Hello World!', description: 'A first post.', url: 'https://stamat.info/blog/hello-world.html' })
  assert.equal(text, 'Hello World!\n\nA first post.\n\nhttps://stamat.info/blog/hello-world.html')
})

test('a share message replaces the title and description, and still gets the link', () => {
  const text = composePost({
    share: 'Thirteen years late, but here it is.',
    title: 'How a classic derail led me to create a fast object deduplication function',
    description: 'A sequel.',
    url: 'https://stamat.info/blog/fastest-dedupe.html'
  })
  assert.equal(text, 'Thirteen years late, but here it is.\n\nhttps://stamat.info/blog/fastest-dedupe.html')
})

test('a share message that already carries the link does not get it twice', () => {
  const url = 'https://stamat.info/blog/x.html'
  const text = composePost({ share: `Read it here: ${url} — worth your time`, title: 'T', url })
  assert.equal(text.split(url).length - 1, 1, 'the link was appended on top of one already written')
})

test('an empty share falls back to the title, it does not post a blank', () => {
  const text = composePost({ share: '', title: 'Hello World!', url: 'https://stamat.info/blog/hello-world.html' })
  assert.equal(text, 'Hello World!\n\nhttps://stamat.info/blog/hello-world.html')
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
