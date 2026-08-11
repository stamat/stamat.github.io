---
layout: blog-post
title: Hash for the bucket, walk for the truth
description: A sequel, thirteen years late, to two 2013 posts on object identity — the emotate story that caused them, what held, what aged, and how the CRC32 HashCache became dedupe() in book-of-spells.
date: 2026-08-06
published: true
category: code
---

_A sequel, thirteen years late, to [JavaScript: quickly find very large objects in a large array](https://stamat.wordpress.com/2013/07/03/javascript-quickly-find-very-large-objects-in-a-large-array/) and [JavaScript object ordered property stringify](https://stamat.wordpress.com/2013/07/03/javascript-object-ordered-property-stringify/)._

## How this started: emotate, and a friend called Coconut

In 2012 I was building emotate.com with my good friend Marko Maletić — Kokos (eng. Coconut). We split it
down the middle: he took the backend, I took the frontend. For the wire between us we
agreed on [JSON-RPC](https://www.jsonrpc.org/) — why? why not — which meant that
everything crossing the wire was a JSON document, and that we would be checking JSON
documents constantly, on both sides.

So we went looking, and we found [JSON Schema](https://json-schema.org/): a document that
describes the shape another document has to have — these fields are required, this one is
an email, that list may not repeat itself. Kokos wired it into the backend. And I thought:
why doesn't the browser get to use it too? The server already has the schema. Let it hand
the schema over, let the form check its payload against it in the browser, and stop the
invalid requests before they are ever sent. The server still decides — it always decides —
but it stops burning a round-trip to say _you forgot the email_.

That needed a schema validator in the browser, so I wrote one:
[jules](https://github.com/stamat/jules). And around it, the piece that fed it,
[formality](https://github.com/stamat/formality) — a form framework that collected an HTML
form into a JSON object, handed it to jules to check against the schema, and submitted it
over JSON-RPC only if it passed.

Worth saying what was special about jules in 2013, because the reason it existed aged
better than the code. Validating a form in the browser **against the same JSON Schema the
server would enforce** was a strange thing to want back then: the form world ran on
jQuery-validate's own rule DSL, wired per input, duplicated by hand from whatever the
backend checked — two vocabularies for one truth, drifting apart on schedule. One schema,
served by the backend, read by both ends, meant one vocabulary written once. ajv — today's
standard — [arrived on npm in May 2015](https://www.npmjs.com/package/ajv), two years
later; jules' contemporary was tv4, born the month before it and gone by 2017.

That idea is now so standard nobody remembers it needed arguing: shared-schema validation
on both ends is the entire pitch of the zod/valibot generation, of OpenAPI-driven forms,
of every "isomorphic validation" README.

formality aged less kindly, and for an honest reason: browsers grew into the job. HTML5
constraint validation, `<input type="email">`, `required`, the Constraint Validation API —
the platform absorbed most of what formality automated. What it did that the platform
still does not is the part that lived in jules: check a whole payload against a schema the
server sent.

Then jules ran into a wall. Two of JSON Schema's rules — `enum` ("this value must be one
of these") and `uniqueItems` ("this list may not repeat itself") — do not compare _text_.
They compare _things_: is this object one of those objects, does this list contain the
same object twice. That comparison is expensive, it happens per field, per keystroke, in a
browser in 2013. It had to be fast.

Getting it fast was the rabbit hole. And I love rabbit holes. Feast your eyes on this perfect example of scope divergence ladies and gentlemen. It produced two WordPress posts that July, and the
answer I shipped inside jules — which, as it turns out, was wrong in a way I only found
this year. That is the story below.

## The bug you never see

Start with the failure, because the failure is why any of it exists.

Two documents. Same fields, same values, and they were built by different code, so the
fields were set in a different order:

```javascript
const larry = { id: 1490, name: "Larry Smith" };
const larryFromElsewhere = { name: "Larry Smith", id: 1490 };

JSON.stringify(larry); // {"id":1490,"name":"Larry Smith"}
JSON.stringify(larryFromElsewhere); // {"name":"Larry Smith","id":1490}
```

Two strings. One Larry. And `JSON.stringify` is what everybody reaches for when they need
to ask "have I seen this object before" — turn it into text, compare the text. It is the
folk answer, and it is wrong, because it compares the order the fields were typed in
rather than what the document says.

How wrong: take a million JSON documents holding 99,864 duplicates, dedupe them with
`JSON.stringify` as the identity, and it keeps **98,697 of the duplicates**. No exception,
no warning, output that looks entirely plausible, and every count you derive from it is
off. A wrong answer that looks right is not debuggable. That sentence was the itch in
2013 and it has not stopped being true.

## Two posts, thirteen years ago

The July 2013 posts proposed two things, and they are both still the spine of this.

**One: if a string is going to _be_ an object's identity, sort the keys first,
recursively.** Walk the whole document, sort every object's fields into alphabetical
order at every level, _then_ turn it into text. Now the same data always produces the same
text, whatever order it was built in. I called it `orderedStringify`; the general name is
a **canonical form** — one agreed spelling per value.

**Two: to find duplicates in a big pile without comparing everything against everything,
file each document under a number and compare only inside the file.** I called it
HashCache: run [CRC32](https://en.wikipedia.org/wiki/Cyclic_redundancy_check) over the
canonical string to get a 32-bit number, use that as a shelf label, and when two documents
land on the same shelf, actually compare them. Collisions welcome.

Why involve a number at all, if the comparison decides anyway? Because a comparison needs
_two_ values in hand. It can answer "are these two the same"; it can never answer "have I
seen this one before" — and deduplication only ever asks the second question. A hash
answers it, by turning one value into one small number the value can be filed under.
Without that number, every arriving document has to be compared against every document
already kept: a million documents is five hundred billion comparisons. With it, you read
the number, find the handful of documents filed under the same one, and compare against
those alone. The comparison never gets cheaper. It stops happening five hundred billion
times.

That is the whole trick, and it is worth one sentence in plain words before the machinery
starts: **the number tells you where to look; looking is what tells you the truth.**

## Why I am writing this now

This year I have been sorting out my old code — walking the repositories a younger me left
behind, deciding what deserves a rewrite and what deserves a burial. That sweep reached
jules, and jules stands on these two posts. Which made claims a younger me benchmarked
once, on a browser that no longer exists, suddenly load-bearing again — and load-bearing
claims deserve questioning before anything new gets to stand on them.

So I audited both posts against a modern engine, reimplemented the idea in
[book-of-spells](https://github.com/stamat/book-of-spells) as [`dedupe()`](https://stamat.info/book-of-spells/global.html#dedupe), and benchmarked
all of it. Here is what survived, what aged, and what I had gotten wrong — the last part
first, because it is the best part.

## The audit — what thirteen years did to each post

### Post one: the ordered stringify

| 2013 claim                                                                                            | 2026 verdict                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Property order is not guaranteed, so stringify is nondeterministic                                    | Right then — ES5 left it unspecified and engines disagreed. ES2015 has since defined own-key order, so the spec citation aged — but the order is _insertion-dependent_, so equal objects still stringify to different bytes. The premise outlived its citation |
| Sort keys recursively — through nested objects _and_ arrays — then stringify → deterministic identity | Right — it is the ground-truth oracle every benchmark in this post is asserted against. Nothing in these tables gets to call itself correct except by agreeing with orderedStringify                                                                           |

A confession belongs here too: the 2013 jules port of this function skipped the recursion
into arrays, so an object nested inside an array kept its accidental key order. The blog
was righter than the code that cited it. If you canonicalize, canonicalize all the way
down — half a canonical form is a nondeterministic one with better marketing.

### Post two: HashCache

| 2013 claim                                                  | 2026 verdict                                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Hash into buckets, deep-compare inside the bucket           | Right — asserted sound at 1.1M documents, zero misses                            |
| Integer hash keys beat long string keys in the native table | Right, and the gap widened: 8.7 s vs 20.1 s at 1M in today's V8                  |
| Collisions are rare, ~1 per 100k                            | Right on the nose — 1.16 collisions expected at 100,000 values, 120 at a million |

That last row is the **birthday problem**, and it is the one piece of maths worth carrying
out of this post. Put 23 people in a room and there is a 50% chance two share a birthday —
absurd against 365 days, until you notice the question is not about people but about
_pairs_, and 23 people make 253 of them. Same here, with documents for people and the
fold's 4,294,967,296 possible values for days. n documents make n(n−1)/2 pairs, so the
odds of at least one shared number are 1 − e^−(n(n−1) / 2 × 4,294,967,296):

| documents | pairs           | collisions expected | odds of at least one |
| --------- | --------------- | ------------------- | -------------------- |
| 11,351    | 64,416,925      | 0.015               | 1.5%                 |
| 100,000   | 4,999,950,000   | 1.16                | 69%                  |
| 1,000,000 | 499,999,500,000 | 116                 | ~100%                |

Which is why the 11,351-document corpus finding zero collisions proves nothing — zero was
the 98.5% likely outcome. And why the bucket walk is not a tail-risk precaution: at the
million-document scale the benchmarks run, a hundred-odd collisions are not bad luck, they
are Tuesday.

I will take that scorecard. Post one's canonical form is still the identity; post two's
architecture is still the index. What 2026 improves is implementation vocabulary — and it
improves both posts with the same move.

## The two flows, side by side

Here is the entire 2013 pipeline, one document at a time, in words:

1. **Canonicalize.** Walk the document, sort every object's keys at every level, build one
   long string out of it.
2. **Hash.** Walk that string again, character by character, through a CRC32 table, and
   come out with a 32-bit number.
3. **Look up.** Find the shelf labelled with that number.
4. **Empty shelf** — never seen it. Keep the document, put it on the shelf, move on.
5. **Occupied shelf** — compare the document against the few already there. A match means
   duplicate, drop it. No match means the number was shared by accident, so keep the
   document and shelve it beside the ones it is not equal to.

And 2026:

1. **Fold.** Walk the document _once_, sorting each object's keys as you reach it, mixing
   every key and value into a single 32-bit number as you go. No string is ever built.
2. **Look up.** Find the shelf labelled with that number.
3. **Empty shelf** — keep the document, shelve it, move on.
4. **Occupied shelf** — `deepEqual` against the few already there, same verdict rules as
   above.

Steps 3, 4 and 5 are identical, which is the point: **the architecture did not need
rescuing, only its hash modernized.**

| part of the flow                      | 2013                                                | 2026                                                        | changed?                    |
| ------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------- | --------------------------- |
| Keys sorted before anything is hashed | yes, while building the string                      | yes, while folding                                          | no — post one, intact       |
| Intermediate canonical string         | built, held in memory, then read a second time      | never exists                                                | **gone**                    |
| Passes over the data                  | two — one to build the string, one to hash it       | one                                                         | **halved**                  |
| Hash function                         | CRC32, table-driven, in JS                          | FNV-1a, folded inline                                       | **swapped — ~2×**           |
| Shelf label                           | a 32-bit integer                                    | a 32-bit integer                                            | no — post two, intact       |
| The verdict inside the bucket         | a comparison (which jules skipped, and that was it) | `deepEqual` — cycles, Maps, Sets, typed arrays, symbol keys | same role, much wider reach |
| What a first occurrence means         | it wins, later arrivals are dropped                 | it wins, later arrivals are dropped                         | no                          |

Everything after this section is the detail behind those three "changed" rows, and the
measurements that justify them.

## What we improved: stop building the string

Chain the two posts and count the traversals. CRC32-over-ordered-stringify walks the value
to build post one's canonical string — sorting keys, escaping, concatenating megabytes —
then walks that string to compute post two's hash. The string exists only to be eaten.
2026's move: **fold the hash during the walk itself.**
[FNV-1a](https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function), 32
bits, mixed as the traversal visits live values — post one survives as the _ordering_ (keys still sorted,
folded name by name), post two survives as the _architecture_, and the string between them
retires. Numbers fold by their float bits; nothing intermediate ever materializes.

The verifier inside the bucket is now a real structural
[`deepEqual`](https://stamat.info/book-of-spells/global.html#deepEqual) — cycles, Maps, Sets, typed
arrays, symbol keys. Because the invariant only demands _never split equals_, the fold
is deliberately coarse wherever precision would risk it: every `NaN` one token, `-0` folds
as `0`, Sets and Maps fold by size alone. deepEqual matches their members in any order,
so an order-sensitive fold would split equal collections. A class instance folds exactly
like its plain-object twin, because data is data. Cycles terminate by a depth cap: past
depth 32 everything folds to one token, and since two equal values truncate at the same
node, the cap cannot split them either. Coarse buckets cost a comparison; they cannot cost
the answer.

### Why FNV-1a, and not the CRC32 that was already there

Two things changed between 2013 and now — the string went away, and the hash was swapped —
and a benchmark that moves both at once cannot say which one paid. So the grid is
deliberately 2×2: both hashes, each computed both ways, every row bucketing and verifying
through the same `deepEqual` so the clock is timing the key and nothing else
([11,351 real GitHub event objects](https://github.com/json-iterator/test-data) plus 10%
injected duplicates, Node 25.3.0, Apple M1 Pro, median of 7, 2026-08):

| key derivation                              | time       | what it isolates                                                        |
| ------------------------------------------- | ---------- | ----------------------------------------------------------------------- |
| FNV-1a folded during the walk               | **122 ms** | no string, no table, one traversal                                      |
| CRC32 folded during the walk                | 231 ms     | same walk, same tokens — **the hash swap alone, and it is ~2×**         |
| native `zlib.crc32` over canonical string   | 217 ms     | native hash, but the string build dominates — and browsers have no zlib |
| canonical string as Map key                 | 260 ms     | sound for JSON, but V8 hashes and retains kilobyte keys                 |
| FNV-1a over canonical string                | 278 ms     | the fast hash, crippled by the string it did not need                   |
| SHA-1 over canonical string                 | 256 ms     | object-hash's recipe, priced                                            |
| table-driven JS CRC32 over canonical string | 293 ms     | 2013's exact recipe: builds the string _and_ walks it again             |

Read the first two rows together and the hash swap is worth roughly 2× on its own — 1.7×
to 2.7× across runs, the timings drifting ±10 ms either way. The reason is
that **FNV-1a eats values; CRC32 eats bytes.** FNV mixes whatever you hand it in two
operations — an XOR and a multiply — so a character goes in whole and a number goes in as
the two halves of its float64 bits. A CRC is defined over a byte stream, so every one of
those has to be chopped into bytes first and fed through a 256-entry lookup table one byte
at a time: two table hits per character instead of one multiply, four per number half.
Over identical strings, in isolation, that is 592 MB/s against 297 MB/s.

Now the question that matters more: **is FNV-1a more _correct_?** No, and it cannot be,
because no hash in this design is. Correctness lives in `deepEqual` inside the bucket; the
hash only decides how many comparisons happen. Counting actual collisions on generated
documents says exactly that:

| distinct values | FNV-1a collisions | CRC32 collisions | birthday estimate |
| --------------- | ----------------- | ---------------- | ----------------- |
| 100,000         | 1                 | 1                | 1.16              |
| 1,000,000       | 103               | 91               | 116.42            |

Both land on the maths, and CRC32 lands _nearer_ it at a million — which is the finding,
not an embarrassment. A twelve-collision gap either way is twelve extra `deepEqual` calls
against 2.7 seconds of work, and the ordering flips with the seed. **FNV-1a wins on speed
and ties on everything else**, which is the whole of the argument, and the only argument
available: a hash that cannot be wrong can only be fast or slow.

The 2013 recipe is the slowest row — and still sound. The fold is the same idea minus the
string. Shipped as `dedupe(arr)` in book-of-spells: first occurrence wins, input untouched,
`deepEqual` decides what a duplicate is. Both tables above regenerate from
`bench/hash-choice.bench.mjs` in that repo.

The shelf has a proper name — a **bucket** — and the pile of kept documents is nothing more
than a table of them, a number on the left and everything that folded to it on the right:

```text
0x7efecc5c ─▶ [ Larry ]
0x1758cc5c ─▶ [ Larry, one daughter a year older ]
0xdd0287f4 ─▶ [ {1, 2} , {3, 4} ]   ← one number, two values: a collision
```

Two documents that differ by a single field land in different buckets, which is all the
routing has to achieve. The third bucket is the case the whole design is built around: two
values that are not equal sharing a number anyway. They sit there together, and the
comparison inside the bucket — never the number — is what keeps them apart.

### One document, five identities

The whole argument is about bytes, so here are the bytes — on the document the 2013
HashCache post used as its own test data, which may as well carry the sequel too:

```json
{
  "id": 1490,
  "married": true,
  "name": "Larry Smith",
  "sons": null,
  "daughters": [
    { "age": 25, "name": "Melissa" },
    { "age": 11, "name": "Melissa" }
  ]
}
```

Now take the same record from a second source — same fields, same values, keys arriving in
whatever order that source felt like, nested objects included. This is the case every
reshuffled clone in the benchmarks below stands for, and the folk identity cannot see it:

```javascript
JSON.stringify(larry);
// {"id":1490,"married":true,"name":"Larry Smith","sons":null,"daughters":[{"age":25,…
JSON.stringify(larryFromElsewhere);
// {"daughters":[{"name":"Melissa","age":25},…,"married":true,"id":1490}
// two strings, one Larry
```

| identity                                                                            | what it returns                                                                                                    | same for both |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------- |
| `JSON.stringify`                                                                    | the characters in the order they were typed                                                                        | **no**        |
| canonical string (`orderedStringify`)                                               | `{"daughters":[{"age":25,…}],"id":1490,"married":true,…,"sons":null}` — 129 characters, keys sorted at every level | yes           |
| CRC32 of that string — 2013's hash                                                  | `0x01aac45d`                                                                                                       | yes           |
| [SHA-1](https://en.wikipedia.org/wiki/SHA-1) of that string — object-hash's default | `fe43ecb8…1d4bce47`, 40 hex characters                                                                             | yes           |
| FNV-1a folded during the walk — 2026                                                | `0x7efecc5c`                                                                                                       | yes           |

`deepEqual` calls the two records equal and `dedupe` of the pair returns one document. The
four sound rows differ only in what they cost to agree: the canonical string is 129
characters that have to be built and held, CRC32 and SHA-1 then walk those 129 characters a
second time, and the fold walks the object once and keeps four bytes.

### What the fold actually does

One 32-bit accumulator, one rule — `h = (h XOR x) × 16777619`, starting from FNV-1a's
offset basis — applied to a walk of the live value. Shape enters as small tokens: an object
mixes one on the way in and another on the way out, so `{}` nested in an array cannot fold
like the array itself. Keys are sorted before anything is mixed, which is the whole of post
one surviving inside post two. Values mix by type: a string as its char codes, a number as
the two halves of its float64 bits, `true`, `false` and `null` as one token each.

Leisure suit Larry, step by step — the second daughter's six steps collapsed into one row, same shape as
her sister's, only the age differing:

| step                                                              | `h` after    |
| ----------------------------------------------------------------- | ------------ |
| seed — FNV-1a offset basis                                        | `0x811c9dc5` |
| object opens, keys sorted to `daughters, id, married, name, sons` | `0x0e0c6b4a` |
| key `"daughters"`                                                 | `0xc4ec1aa7` |
| array opens                                                       | `0xadadffea` |
| object opens, keys sorted to `age, name`                          | `0x49e9cf33` |
| key `"age"`                                                       | `0x690303f2` |
| number `25` — tag, then its float bits                            | `0xf2adf750` |
| key `"name"`                                                      | `0x20e259d3` |
| string `"Melissa"` — tag, then char codes                         | `0x0b208556` |
| object closes                                                     | `0xde31ecae` |
| _…second daughter, same six steps…_                               | `0x5b6219ea` |
| array closes                                                      | `0xbb6ebba0` |
| key `"id"`, number `1490`                                         | `0x974a5d95` |
| key `"married"`, boolean `true`                                   | `0x159daeb9` |
| key `"name"`, string `"Larry Smith"`                              | `0x7ed9e084` |
| key `"sons"`, `null`                                              | `0x269e2bb8` |
| object closes                                                     | `0x7efecc5c` |

No string was built, nothing was allocated, and the document was read once. Change one
nested field — a daughter turning 12 — and the accumulator moves to `0x1758cc5c`: a
different bucket, which is all the fold is asked for. Its low bits barely move, because a
difference can only propagate upward through the multiply, and that costs nothing here —
the bucket is keyed on all 32 bits, and `deepEqual` settles whoever lands together anyway.

None of this is cryptography, and it matters that it isn't. FNV-1a and CRC32 are
_checksums_ — 32 bits, cheap, collide by design, and picked for spreading values evenly
across buckets. [SHA-1](https://en.wikipedia.org/wiki/SHA-1) is a _cryptographic_ hash: 160
bits, and what those extra bits buy is collision **resistance** — the guarantee that nobody
can deliberately craft two different documents that hash the same in order to make your
program mistake one for the other. That is a real threat when the hash _is_ the verdict, as
it is for a git commit id or a password digest, and it is the reason object-hash reaches for
SHA-1 by default.

Here it buys nothing, and the reason is the invariant. This design never asks the hash to
be right — an attacker who forces a collision achieves one extra `deepEqual` call, and
`deepEqual` then tells the truth anyway. So the crypto is paid for on every document and
redeemed on none, which the table above prices at 256 ms against the fold's 122 ms. There
is a real case for hashing values cryptographically — content addressing, where the digest
travels instead of the data, and two parties must agree without either holding both values.
That is not dedupe. Dedupe holds both values; it can simply look. Which is the invariant,
with the fold held up to the light for a
moment — it is module-private, only `dedupe` is public:

```javascript
fold(new Set([1, 2])); // => 0xdd0287f4
fold(new Set([3, 4])); // => 0xdd0287f4 — different values, same bucket, on purpose
fold(new Set([2, 1])); // => 0xdd0287f4

dedupe([new Set([1, 2]), new Set([3, 4]), new Set([2, 1])]).length; // => 2
```

Sets fold by size alone, so all three land in one bucket — and the answer is still right:
`deepEqual` keeps `{1, 2}` and `{3, 4}` apart, and folds `{2, 1}` into the first, because
it matches members in any order. The hash routed. It never ruled.

## The numbers at scale

A second corpus, this one generated — seeded PRNG, four shape families, a million unique
documents, and after roughly every tenth of them one duplicate injected: a deep clone of
something already in the pile, every object's key order reshuffled on the way in. That is
1,099,864 documents holding 99,864 duplicates byte-level identity cannot see. _Known_
duplicates, because the canonical-string oracle counts the survivors and gets 1,000,000
exactly; every contender's output is asserted against that number before its time is
reported, and the _kept_ figures below are how far above it each one landed. A bench that
times wrong code measures nothing.

Five contenders. `dedupe` is the fold above. HashCache 2013 is CRC32 over the canonical
string, bucketed, deep-compared inside the bucket. The two _key_ rows are the same
one-liner — a `Set` of keys, first occurrence wins — differing only in what makes the key:
post one's sorted-key canonical string, which cannot let key order in, or raw
`JSON.stringify`, which cannot keep it out. The canonical row is also the oracle, so that
one is ground truth with a clock on it. Pairwise `deepEqual` is the O(N²) scan every
`uniqWith` on npm performs.

| input     | duplicates | dedupe     | HashCache 2013 | canon-str key | JSON.stringify key  | pairwise deepEqual  |
| --------- | ---------- | ---------- | -------------- | ------------- | ------------------- | ------------------- |
| 11,032    | 1,032      | **13 ms**  | 50 ms          | 44 ms         | 8 ms — kept 1,026   | 4.1 s               |
| 110,099   | 10,099     | **254 ms** | 578 ms         | 451 ms        | 103 ms — kept 9,982 | skipped — quadratic |
| 1,099,864 | 99,864     | **2.7 s**  | 8.7 s          | 20.1 s        | 5.2 s — kept 98,697 | skipped — quadratic |

Three things worth staring at. HashCache 2013 is sound at every size — the architecture
never needed rescuing, only its hash modernized. The `JSON.stringify` key is fastest at
small sizes and _wrong at every size_: at a million it finds 1,167 duplicates out of
99,864, and finds those by accident — a clone is caught only when the reshuffle happened to
deal the keys back in their original order, which the four-key flat documents do about one
time in twenty-four. Speed of the wrong answer is not a feature. And at a million documents
the thirteen-year-old design with its integer keys beats the canonical-string Map by 2.3× —
the exact claim from 2013, wider now.

## Against the ecosystem

What people actually `npm install` for this job, same corpus, same soundness assertion
(lodash 4.18.1, es-toolkit 1.50.0, ramda 0.32.0, object-hash 3.0.0):

| contender                      | 2,000 uniques | 10,000    | 100,000    | 1,000,000 |
| ------------------------------ | ------------- | --------- | ---------- | --------- |
| `dedupe` (book-of-spells)      | **5 ms**      | **23 ms** | **236 ms** | **2.7 s** |
| lodash `uniqWith(isEqual)`     | 760 ms        | 16.8 s    | skipped    | skipped   |
| es-toolkit `uniqWith(isEqual)` | 750 ms        | 18.3 s    | skipped    | skipped   |
| ramda `uniq`                   | 1.3 s         | 38.2 s    | skipped    | skipped   |
| object-hash as Map key         | 66 ms         | 326 ms    | 4.1 s      | 49.5 s    |

_Node 25.3.0 on an Apple M1 Pro, 16 GB — wall clock over a full pass, median of three,
single process; memory and browser engines not measured._

The skips are declared, not decorative: the three `uniqWith`-style rows are O(N²), and the
two sizes that _were_ measured prove it — 2,000 → 10,000 is 5× the data and lodash takes
22× the time, against a theoretical 25× (early duplicate hits shave the difference).
Extrapolating that curve, 100k is ~half an hour and 1M ~two days per run; those cells are
skipped because running them buys arithmetic, not information.

Every `uniqWith` on npm is the pairwise scan — a fast comparator wrapped in O(N²); the
comparator was never the bill. Though in fairness, `uniqWith` solves a harder problem: it
takes _any_ comparator, and an arbitrary comparator cannot be hashed. Fixing the
comparator to `deepEqual` is the specialization that unlocks the linear shape. object-hash
is the only rival benchmarked here in the same architectural class — hash-keyed and linear.
It pays for serializing each value and running a crypto hash over the result, 13–18× at
every size, while treating the hash as the verdict — the invariant's
second clause waiting to bite. All five got the right answer on this corpus; only the
bucket-verify designs are _guaranteed_ to.

## Where hashing loses, so you don't use this wrong

Here is the row I lose. **One pair** of large documents — [plotly's
`geojson-counties-fips.json`](https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json),
3.2 MB of US county polygons as served, 3.0 MB once re-serialized — and the public API on
both sides, `deepEqual(a, b)` against `dedupe([a, b])`, never the private `fold`, because
that is the choice a caller actually faces.

The pair is three independent `structuredClone`s of the parsed file: `deepEqual` opens with
an `a === b` fast path, and two references to one object would answer the equal case without
reading a byte. The unequal pair differs in the wrapper's first key — `type`, one string,
overwritten — which is the difference a structural walk meets on step one. Both pairs are
asserted before the clock starts, the equal one equal and the other not. Each cell runs for
a one-second wall budget rather than a fixed number of iterations, because these two rows
span nanoseconds to milliseconds and no single count serves both:

| case                        | structural walk — `deepEqual(a, b)` | hash both sides — `dedupe([a, b])` |
| --------------------------- | ----------------------------------- | ---------------------------------- |
| equal pair                  | **~170 ops/s**                      | ~50 ops/s                          |
| difference in the first key | **~8M ops/s**                       | ~75 ops/s                          |

Read the second row twice: on a pair that differs immediately, the walk is **a hundred
thousand times** faster. A hash must consume both values entirely before it can say
anything, so it reads 6 MB to answer a question the walk settles on the first key. The walk
stops at the first difference and allocates nothing.

Which raises the obvious question — if walking wins that badly, why hash at all? Because
that row is one pair, and the whole design is about not being asked one pair. Here are the
two contenders in full, which is the clearest way to see it. The pairwise scan, what every
`uniqWith` on npm does:

```javascript
function pairwise(arr) {
  const out = [];
  outer: for (const it of arr) {
    for (const x of out) if (deepEqual(x, it)) continue outer; // ← everything kept so far
    out.push(it);
  }
  return out;
}
```

And `dedupe`, which is the same nested loop with one line inserted above it:

```javascript
function dedupe(arr) {
  const buckets = new Map();
  const out = [];
  for (const it of arr) {
    const key = fold(it); // ← one walk of the value, one number
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, [it]);
      out.push(it);
      continue;
    }
    let seen = false;
    for (const c of bucket)
      if (deepEqual(c, it)) {
        seen = true;
        break;
      } // ← this bucket only
    if (!seen) {
      bucket.push(it);
      out.push(it);
    }
  }
  return out;
}
```

Both have an inner loop over previously kept values. The difference is entirely in what
that loop iterates: **everything kept so far**, against **one bucket** — which usually
holds one value, and holds two only when the fold collided. The tenth document is compared
against nine, or against zero. The millionth against 999,999, or still against zero. That
is the whole of O(N²) against O(N), and `fold` is what buys it.

So the honest thing is to measure where the line falls. Small flat documents, all distinct,
the corpus most generous to the pairwise scan:

| items | dedupe        | pairwise `deepEqual` | winner          |
| ----- | ------------- | -------------------- | --------------- |
| 2     | 564k ops/s    | **3.9M ops/s**       | pairwise 6.9×   |
| 8     | 152k ops/s    | **398k ops/s**       | pairwise 2.6×   |
| 16    | 76k ops/s     | **97k ops/s**        | pairwise 1.3×   |
| 32    | **34k ops/s** | 24k ops/s            | **dedupe 1.4×** |
| 128   | **9k ops/s**  | 1k ops/s             | dedupe 6.6×     |
| 1,000 | **1k ops/s**  | 24 ops/s             | dedupe 46×      |

**The crossover is around thirty values**, and the shape either side of it is the point:
pairwise wins by a fixed, small factor below the line and loses without bound above it. At
11,000 documents it is 4.1 s against 13 ms — measured. At a million it is 2.7 s against an
extrapolated two days, which is why that cell was never run.

Hashing never made a comparison faster. It made most of them not happen — and that trade
only clears once there are enough values that deleting comparisons is worth a fold apiece.
So: **walk a pair, hash a pile.** For a single `a` equals `b`, call `deepEqual` and never
hash.

The two halves of jules land on opposite sides of that line, which I did not know when I
wrote it. `uniqueItems` over a few thousand documents is the pile, and hashing was right.
But `enum` against a five-value list — the shape almost every real schema uses it in — is
five comparisons, settled before a fold could finish reading the first value. It should
simply have walked them. One number, thirty-ish, would have told me that in 2013. In
fairness to the younger me: I benchmarked the N-way case and was right about it, and never
claimed the small case either way. Good thing, since I would have claimed it wrong.

Thirty is an order of magnitude, not a constant. Duplicates let the pairwise scan exit
early and push the crossover right; larger documents make each fold dearer and push it
right as well. Measure your own shape before hardcoding anything.

### When not to use it

Everything above, as a table you can decide from — the rows `dedupe` loses included, since
those are the ones worth knowing:

| your situation                                       | reach for            | why                                                                                                                                                                                                               |
| ---------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One pair — is `a` equal to `b`?                      | `deepEqual(a, b)`    | The fold reads both values whole before it can speak; the walk quits at the first difference. Up to ~100,000× on an early mismatch                                                                                |
| Fewer than ~30 values                                | a pairwise scan      | Below the crossover the fold costs more than the comparisons it deletes                                                                                                                                           |
| A pile of JSON-shaped documents                      | **`dedupe`**         | The job it was built for: one fold per value, comparisons only inside a bucket                                                                                                                                    |
| Mostly Sets, Maps or Dates of the same size          | object-hash          | These fold by size or tag alone, so they pile into a few giant buckets and the in-bucket scan drifts back toward quadratic. Slower, never wrong — object-hash hashes collection members and would win that corpus |
| A comparator other than deep equality                | `uniqWith`           | An arbitrary comparator cannot be hashed, which is the harder problem `uniqWith` solves and the reason it eats O(N²)                                                                                              |
| An id to store, log, or send between machines        | SHA-256 and friends  | The fold is private, 32 bits, and collides on purpose — it is a routing hint inside one call, never an identity that outlives it                                                                                  |
| Untrusted input where a collision would be an attack | a cryptographic hash | FNV-1a is a checksum: cheap, and trivially collided on purpose. Safe here only because `deepEqual` overrules it                                                                                                   |

The last two are the same mistake twice, and it is the mistake this whole post is about
from the other side: **the fold is not an identity.** It routes. Ask it to be a verdict —
store it, transmit it, compare two of them and believe the answer — and you have rebuilt
the 2013 jules bug with a faster hash. Correctness never rests on the hash.

Benchmarks above are JSON documents, on one machine, in one engine. The claim ends where
the corpus does.

## Thirteen years later

emotate.com still waits for better days, will they arrive? — I would definitely love to, but who knows? formality was overtaken by the browser and laid to rest. jules is retired with a
tombstone in its README. What outlived the two is the smallest piece of the whole thing:
identity is a _sorted_ serialization, a hash is a routing hint and never a verdict, and
equality is decided by looking at the data. The 2013 posts got that part right. What 2026
adds is subtraction — the canonical string, the CRC table, and 98,697 silent misses, all
gone.

`dedupe()` and `deepEqual()` live in
[book-of-spells](https://github.com/stamat/book-of-spells), and three of the four tables
above regenerate from runnable scripts in its `bench/` directory — `dedupe.bench.mjs` for
the scale numbers, `hash-choice.bench.mjs` for the hash grid and the collision counts,
`pair.bench.mjs` for the row I lose and the crossover under it. Each runs on a corpus that
regenerates identically anywhere and takes `--corpus` for the real files linked here. Two
tables are not scripts: the ecosystem comparison is one session's measurement, and the
birthday table is arithmetic you can check yourself.

Kokos, my brother, I will always cherish the good old days that defined us.
