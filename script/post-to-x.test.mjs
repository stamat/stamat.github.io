// Covers the OAuth 1.0a signing, which is wrong silently: percent encoding and the signature base
// string assembled from it. A single character escaped wrong signs a request X rejects with 401
// and no clue which of the four secrets is at fault.
//
// Deliberately not covered: the HTTP call. It needs a network to be meaningful and has no logic
// worth a fake — `--whoami` is what proves the keys against the live API. Front matter reading and
// the character budget moved to `share.test.mjs` along with the code.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { percentEncode, signatureBaseString } from './post-to-x.mjs'

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
