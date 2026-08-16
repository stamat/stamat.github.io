// Covers the parts of post-to-x that are wrong silently: percent encoding, the signature base
// string assembled from it, front matter reading, and the 280 character budget.
//
// Deliberately not covered: the HTTP call and the git range walk. Both need a network or a
// repository to be meaningful, and neither has logic worth a fake — the first real post is
// what proves them, and `--dry-run` is what checks the range before it goes out.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { percentEncode, signatureBaseString, frontmatter, isPublished, composePost } from './post-to-x.mjs'

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
