---
layout: blog-post
title: How a derail led me to create the fastest object deduplication function
description: A sequel, thirteen years late, on the CRC32 HashCache and how it became dedupe() in book-of-spells.
date: 2026-08-12
published: true
category: code
---

_A sequel, thirteen years late, to [JavaScript: quickly find very large objects in a large array](https://stamat.wordpress.com/2013/07/03/javascript-quickly-find-very-large-objects-in-a-large-array/) and [JavaScript object ordered property stringify](https://stamat.wordpress.com/2013/07/03/javascript-object-ordered-property-stringify/)._

## How the derail happened

In 2012 I started working with my good friend Marko — Kokos (eng. Coconut) on a startup idea, [emotate.com](https://emotate.com). We were building a social network from scratch. Back in the day I thought I would be considered a shit engineer if I didn't build everything from scratch. Insane, right? Like anyone cares. Well in my defense, that's how you learn. (That's how you learn that no one really cares, lol)

We've split the work: he was doing the backend and I was doing the frontend. We've decided to go for a split architecture communicating using [JSON-RPC](https://www.jsonrpc.org/) — Why? Why not? This in turn meant that we need to validate JSON often, so we quickly sprung into writing our own validation schema but quickly after we discovered the existence of [JSON Schema](https://json-schema.org/) and decided to adopt that into the backend.

Then it got me thinking, if the schema exists on the backend I can get it served to the frontend and validate form requests before they ever reached the server, reducing the load on the server for invalid requests.

This idea, which is now an industry standard, was new at the time. The HTML5 native form validation had just exited the draft phase in 2012 as well. I just wanted to style errors and provide a nice user experience, and save on some server compute at the same time.

So I started building form validation automation called [formality](https://github.com/stamat/formality) and to power it I started building a fast and lightweight JSON Schema validator [jules](https://github.com/stamat/jules) in a declarative manner so it can run in the browser and so it can be easily extended for future drafts or a release. In my defense there were not a lot of schema validators at the time, maybe just one other, probably for node.

Then I got to the `enum` and `uniqueItems` schema properties which can hold objects... Means finding a needle in an enum stack or making sure that the array of objects is unique. What did I do next? Did I actually need to use `enum` and `uniqueItems` properties in my project's schemas? Of course I didn't. But that didn't stop me to completely derail like a madman. Kids, learn from my mistakes. Cause it seems that I never did. I still have this tension to maniacally go into details of random shit, even now that we have AI, even more. I could say it's autism, but I would just be cowering behind a term.

## The derail

So the problem was a simple one, what if I have millions of `enum` entries? (btw, never happening) How will we efficiently find the needle JSON in a stack of JSON objects? Should we walk? Should we use stringified JSON as map keys to quickly find what we are looking for?

The idea was also simple, what if I could map the JSON objects in a hash map as hash keys with object value and then query for the object via the hash key of the needle.

```javascript
const larry = { id: 1490, name: "Larry Smith" };
const larryFromElsewhere = { name: "Larry Smith", id: 1490 };

JSON.stringify(larry); // {"id":1490,"name":"Larry Smith"}
JSON.stringify(larryFromElsewhere); // {"name":"Larry Smith","id":1490}
```

The issue here is that the objects in JavaScript have unordered properties. They can be ordered though, but you can't expect them to be ordered. So first thing we needed a function to alphabetically order the keys in an object so we could produce a serialized JSON with sorted keys. What I did was in detail described in this old post: [JavaScript object ordered property stringify](https://stamat.wordpress.com/2013/07/03/javascript-object-ordered-property-stringify/). BTW, `Object.keys(v).sort()` does natively what I wrote by myself being a stubborn guy as I am, ES5 shipped it in 2009. How do I live with myself? Hardly...

Secondly we should hash the serialized ordered JSON object and create a system of buckets to evade the possible collisions of a hashing algorithm. Since I'm a math noob, I tried to find a lightweight hashing function, and somehow ended up with [CRC32](https://en.wikipedia.org/wiki/Cyclic_redundancy_check). Why? It was long ago and I can't remember. Most probably that was the only one I could find that someone had already wrote. When we have a collision we store the multiple objects in an array under the hash (called a bucket) and we do a deep equal between the needle and the members of the bucket. Collisions are rare for small sets and this is exactly why we can gain speed. But on very small sets we do go significantly slower than just doing the walk, meaning deep equal.

The final solution is explained in this old post: [JavaScript: quickly find very large objects in a large array](https://stamat.wordpress.com/2013/07/03/javascript-quickly-find-very-large-objects-in-a-large-array/).

It was 2013 and Google had its library of utilities in the Closure Library. It had just what I needed `goog.structs.Map()` and `goog.object.getKeys(obj).sort()`. I certainly didn't want to introduce dependencies. Ridiculous. I was like I could do much better... Taking on giants as a simple David was my fetish springing from my rebellious nature. The architecture I came up with was sound, unlike myself. Everything worked super fast and there were zero misses. On large sets of course.

My schema validator jules didn't even need this precision...

## The sequel

It's 2026 now. I desire to focus all of my work under one roof, therefore I'm going through my old repos and looking at what aged well and what didn't and I'm just killing them one by one. So when the aliens come they can see all of my failures along with my victories. I will also rest at ease that long after I'm gone there will be something left behind me. Like my own [poops](https://github.com/stamat/poops).

So I stumbled upon formality and jules, and of course I ran a strong LLM to tell me how retarded I was, but to my own surprise, I wasn't. These projects were pretty advanced for when they were created — I just suck at marketing. (Wow, maths, marketing, what else should be on the list? Ah I know, physical training...)

I decided to salvage what can be salvaged and give the core of this "research" a new home in my salvage library [`book-of-spells`](https://github.com/stamat/book-of-spells). "You're a wizard, Harry." — "I'm a what?" The architecture refreshed and the work is now in a deduplicating function `dedupe` (I want everyone to know that `dupe` means `ass` in Serbian, thank you), function to compare two objects `deepEqual` and a haystack `DeepSet` which enables you to find the JSON object needle, containing the bucket + verify architecture which actually does the same thing as `dedupe`. More on that later.

I also threw in the `clone` update while I'm being all recursive and shit. New JavaScript data types after 13 years, huh? Who would have thought?

By the power of AI bestowed upon me. I HAVE THE POWER! (Obvious He-Man reference, well, not so obvious for younger audiences. Even I was a semi toddler back when this was the best toy/show ever. And I'm pretty old.) Along with every other developer that has a clue what they are doing, or even if they just believe that they have a clue.

Honestly thank God for AI because my crap wouldn't sort itself out without it, and I do love life. And yes God, because AI is part of evolution. Everything human made mimics nature, therefore all software mimics nature. God is nature. Therefore God "made" LLMs, and also people mimic God. Therefore they are in his image... Just ask my main man Spinoza.

### Is there something faster than CRC32?

Yes. [FNV-1a](https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function). Both are 32-bit checksums, both collide, neither one is more correct than the other. The reason is that in 2013 I was feeding the wrong food to the wrong animal: **CRC32 eats bytes, FNV-1a eats values.**

Same object `{ b: 2, a: 1 }` — keys typed out of order, which is the case this whole thing exists for. Sorted and serialized first, because that is post one and everything below leans on it:

```javascript
function orderedStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(orderedStringify).join(",") + "]";
  const keys = Object.keys(v).sort(); // ← the whole of post one
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + orderedStringify(v[k]))
      .join(",") +
    "}"
  );
}

const s = orderedStringify({ b: 2, a: 1 }); // {"a":1,"b":2} — thirteen characters
```

**CRC32**:

```javascript
// 256 precomputed 32-bit values, built once at load
const TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  TABLE[n] = c >>> 0;
}

let h = 0xffffffff;
for (let i = 0; i < s.length; i++)
  h = TABLE[(h ^ s.charCodeAt(i)) & 0xff] ^ (h >>> 8);
h = (h ^ 0xffffffff) >>> 0;

// per character: mask to one byte, index the table, shift, XOR
//
//   {  0xea2ab8c6      ,  0xb5883232
//   "  0xa78d0cd9      "  0x1d029856
//   a  0xc51db6b2      b  0x21a9f62d
//   "  0xf0ca8ef2      "  0x909eb467
//   :  0x954f800c      :  0x154ab3fd
//   1  0x58fd0391      2  0x0bce9592
//                      }  0x30be317c
//
//   flip every bit →   0xcf41ce83
```

**FNV-1a**:

```javascript
let h = 2166136261;
for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
h = h >>> 0;

// per character: XOR it in, multiply. no table, nothing to look up
//
//   {  0xfe0c521a      ,  0x5a9df7ee
//   "  0x25656e28      "  0x72ad1624
//   a  0x27ac9ceb      b  0xcc7a1032
//   "  0x3dbad06b      "  0xf4274930
//   :  0x7e15ef83      :  0x63d7fabe
//   1  0x2e885536      2  0xb8ff6a64
//                      }  0x5314055b
//
//   done →             0x5314055b
```

Two 32-bit numbers, `0xcf41ce83` and `0x5314055b`. Bucket labels, nothing more. Thirteen characters, thirteen steps each — what differs is the cost of one step: a load from a 1 KB table, or a multiply in a register.

The rest of the gap is what a CRC can't swallow. It is defined over bytes, so a number has to be chopped into eight of them before it goes in; FNV-1a takes anything up to 32 bits, so the walk hands it the float64 halves whole. Which means the string can go: instead of serializing the object and hashing the text, mix the object's own parts into the accumulator as you walk it.

```javascript
const mix = (h, x) => Math.imul(h ^ x, 16777619);
const f64 = new Float64Array(1),
  u32 = new Uint32Array(f64.buffer);

function fold(h, v) {
  if (v === null) return mix(h, 1);
  if (typeof v === "boolean") return mix(h, v ? 4 : 5);
  if (typeof v === "number") {
    h = mix(h, 2); // tag: a number follows
    f64[0] = v; // read its 64 bits...
    h = mix(h, u32[0]); // ...as two 32-bit halves
    return mix(h, u32[1]);
  }
  if (typeof v === "string") {
    h = mix(h, 3);
    for (let i = 0; i < v.length; i++) h = mix(h, v.charCodeAt(i));
    return h;
  }
  h = mix(h, 11); // object opens
  for (const k of Object.keys(v).sort()) {
    // 2013's sorted keys, still here
    for (let i = 0; i < k.length; i++) h = mix(h, k.charCodeAt(i));
    h = fold(h, v[k]);
  }
  return mix(h, 12); // object closes
}

fold(2166136261, { b: 2, a: 1 }) >>> 0;

//   object opens, keys sorted → [a,b]       11   0x0e0c6b4a
//   key char "a"                            97   0x488cb4b1
//   number tag                               2   0xe88075c9
//   low bits of 1                            0   0xcb396b6b
//   high bits of 1                  1072693248   0xc4141971
//   key char "b"                            98   0xbea378e9
//   number tag                               2   0x065759f1
//   low bits of 2                            0   0xec829663
//   high bits of 2                  1073741824   0xf492bdd9
//   object closes                           12   0xd800d64f
//
//   done →                                       0xd800d64f
```

Ten multiplies, and `{"a":1,"b":2}` was never built — no string, no escaping, nothing held. Same sort as `orderedStringify` does, moved inside the walk: sort each object's keys at the moment you reach it, mix in that order, throw the key list away. Post one, surviving inside post two. `{ a: 1, b: 2 }` folds to the same `0xd800d64f` while `JSON.stringify` still hands back two different strings.

The tags are what keep shape from leaking: `11` and `12` mean an object opened and closed, so `{ a: 1 }` and the bare number `1` can't collapse onto the same walk.

Measured over the same traversal with the same tokens, every row bucketing and verifying through the same `deepEqual`, so the hash is the only variable. 12,513 documents — [11,351 real GitHub events](https://github.com/json-iterator/test-data) plus 1,162 injected duplicates — on Node v25.3.0, Apple M1 Pro. Each row is a median of 7; the spread is across two separate runs:

| key derivation                              | time           |
| ------------------------------------------- | -------------- |
| FNV-1a folded during the walk               | **88 – 97 ms** |
| native `zlib.crc32` over canonical string   | 165 – 175 ms   |
| CRC32 folded during the walk                | 180 – 187 ms   |
| SHA-1 over canonical string                 | 200 – 211 ms   |
| canonical string as Map key                 | 214 – 229 ms   |
| FNV-1a over canonical string                | 215 – 232 ms   |
| table-driven JS CRC32 over canonical string | 229 – 263 ms   |

Rows one and three are the swap alone — same walk, same tokens, only the mixing step differs: 1.9× and 2.0× across the two runs, 1.4× on the generated corpus the repo checks in. Call it roughly double and never quote it as a constant. The last three rows overlap each other, so don't read an order into them; what they say together is that building the string costs more than any hash run over it.

Collisions tie. 1 each at 100,000 distinct values; 103 against 91 at a million. CRC32 lands nearer — twelve extra `deepEqual` calls, and the ordering flips with the seed. FNV-1a wins on speed and ties on everything else, which is the only argument available: a hash that cannot be wrong can only be fast or slow.

### `deepEqual`

Does exactly what the function name says, checks if object A is equal to the object B, deeply, recursively.

```javascript
deepEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }); // true — key order isn't data
deepEqual([1, 2], [2, 1]); // false — array order is data
deepEqual(new Set([1, 2]), new Set([2, 1])); // true — set order isn't
deepEqual(NaN, NaN); // true
```

It walks both values side by side and quits at the first difference. It also survives the cases that make smaller implementations either lie or fall over: an object that contains itself terminates instead of blowing the stack, Maps and Sets are matched by contents instead of by reference, symbol keys count, two invalid dates are equal. Costs a little more than the minimal libraries and gets more inputs right, which is the trade it was written for.

| contender                    | equal, nested 3 deep | differs at the first key | Set of objects | cyclic         |
| ---------------------------- | -------------------- | ------------------------ | -------------- | -------------- |
| `deepEqual` (book-of-spells) | 1.1M ops/s           | **10.4M ops/s**          | **1.7M ops/s** | 133k ops/s     |
| fast-deep-equal 3.1.3        | **1.4M ops/s**       | 1.4M ops/s               | unsound        | 🤮 throws      |
| lodash `isEqual` 4.18.1      | 264k ops/s           | 2.8M ops/s               | 500k ops/s     | 1.1M ops/s     |
| es-toolkit `isEqual` 1.50.0  | 352k ops/s           | 3.3M ops/s               | 845k ops/s     | 1.5M ops/s     |
| `util.isDeepStrictEqual`     | 577k ops/s           | 6.9M ops/s               | 1.6M ops/s     | **2.3M ops/s** |

ops/s — comparisons finished per second, higher is better.

fast-deep-equal is ahead on a plain equal document, by 1.3×, and gives up entirely on the last two columns. Node's own is 17× ahead on cycles. This is not the fastest deep equal on the board — it is the one that answers every column.

### `dedupe`

Hand it an array, get the array back with the structural duplicates gone. First occurrence wins, order preserved, your input untouched.

```javascript
dedupe([{ a: 1 }, { a: 1 }, { b: 2 }]); // => { a: 1 }, { b: 2 }
```

Inside: fold each value to a number, look in that one bucket, `deepEqual` against the one or two things already sitting there. The alternative is comparing everything against everything — what every `uniqWith` on npm does — which is fine up to about thirty values and hopeless above it.

| contender                             | 2,000 uniques | 10,000 uniques | 100,000    | 1,000,000 |
| ------------------------------------- | ------------- | -------------- | ---------- | --------- |
| `dedupe` (book-of-spells)             | **2 ms**      | **15 ms**      | **171 ms** | **2.2 s** |
| lodash `uniqWith(isEqual)` 4.18.1     | 579 ms        | 16.4 s         | skipped    | skipped   |
| es-toolkit `uniqWith(isEqual)` 1.50.0 | 613 ms        | 16.7 s         | skipped    | skipped   |
| ramda `uniq` 0.32.0                   | 1.2 s         | 32.0 s         | skipped    | skipped   |
| object-hash 3.0.0 as Map key          | 60 ms         | 330 ms         | 3.9 s      | 33.4 s    |

The skips are declared, not decorative. Those three rows are the pairwise scan, and the two sizes that did run prove it: 5× the data costs lodash 28× the time against a theoretical 25×, which is a quadratic landing on its own curve. Extrapolate and 100,000 is about half an hour per run — arithmetic, not information. In fairness `uniqWith` solves a harder problem: it accepts any comparator, and an arbitrary comparator cannot be hashed. Fixing it to `deepEqual` is the specialisation that buys the linear shape.

object-hash is the only rival in the same architectural class — hash-keyed, linear, and still 15–24× behind, because it serialises every value and runs SHA-1 over the result.

Anyway check out the bench table, it will tell you who wrote the fastest dedupe. Wink wink.

### `DeepSet`

Promised earlier, so here it is. The platform's `Set` recognises people by their name badge — the reference. Hand it two objects that look identical and it files them as two strangers, because they are two allocations. Correct, and never what you want for data that came off a wire.

`DeepSet` recognises "faces":

```javascript
new Set([{ a: 1 }]).has({ a: 1 }); // false — different object, same content
new DeepSet([{ a: 1 }]).has({ a: 1 }); // true
new DeepSet([{ id: 7, name: "Al" }]).has({ name: "Al", id: 7 }); // true
```

Underneath it is the same mechanism powering `dedupe`: fold the value to a number, look in that one bucket, `deepEqual` to be sure. Which is why `[...new DeepSet(arr)]` is exactly `dedupe(arr)` — same pass, `dedupe` throws the index away and `DeepSet` hands it to you.

Use it when the same unchanging pile gets asked about over and over. For a single question `arr.some((x) => deepEqual(x, value))` beats it outright: the fold has to read your whole value before it can say a word, while `deepEqual` gives up on most candidates after a key or two. Building the index pays back from around thirty queries, and that figure barely moves between a thousand values and a hundred thousand.

One rule: **don't change a value while it's in there. It won't be reflected.** You will have to delete the old entry first and then add the new one. Because membership is decided by contents, not by the value or reference.

```javascript
const moving = { a: 1 };
const seen = new DeepSet([moving]);
moving.a = 2;
seen.has(moving); // false — it's in here, filed under who it used to be
```

Native `Set` has no such rule, because a reference survives being edited and a shape does not. Add copies if the originals move.

When you have a stack of 1000+ objects and you need to find the one, and you need it fast, use the `deepEqual`. If you need to query several times in a row, use the `DeepSet`. Wish this worked on my dating life... But I guess I wasn't too DEEP! 😱

### Bonus: `clone`

Copies a value all the way down, so editing the copy can never reach the original. The native `structuredClone` does that too and costs you nothing — until you hand it a function or a DOM node, where it throws outright, or a class instance, where it quietly hands back something less than you gave it.

```javascript
const options = { el: document.body, onDone: () => {} };
clone(options).onDone === options.onDone; // true — shared, because a function can't be copied
structuredClone(options); // throws DataCloneError
```

| contender                     | flat object, 8 keys | nested document | Uint8Array, 10,000 bytes | cyclic         |
| ----------------------------- | ------------------- | --------------- | ------------------------ | -------------- |
| `clone` (book-of-spells)      | 3.7M ops/s          | 530k ops/s      | **480k ops/s**           | **4.3M ops/s** |
| `structuredClone` (platform)  | 813k ops/s          | 264k ops/s      | 455k ops/s               | 820k ops/s     |
| JSON round-trip               | 1.6M ops/s          | 415k ops/s      | unsound                  | 🤮 throws      |
| rfdc 1.4.1                    | **6.6M ops/s**      | **1.1M ops/s**  | unsound                  | 🤮 throws      |
| lodash `cloneDeep` 4.18.1     | 1.7M ops/s          | 358k ops/s      | 848 ops/s                | 1.7M ops/s     |
| es-toolkit `cloneDeep` 1.50.0 | 2.4M ops/s          | 511k ops/s      | 14k ops/s                | 2.4M ops/s     |

ops/s — comparisons finished per second, higher is better.

rfdc wins the first two columns by up to 2×, and those defaults are exactly what the last two columns cost it. Same shape of trade as above: pay a little on plain data, get the copy back intact on everything else.

Rule of thumb: pure data and you are not already importing this, use `structuredClone`. Otherwise use `clone`.

Who are you? I'm your `structuredClone`. And who am I? You are my `clone` too. Remember the [MadTv Parody of Stolen Identity](https://www.youtube.com/watch?v=S_hWH2Aynpk)?

## Did I learn not to maniacally diverge after this?

I tried so hard, and got so far. In the end, who the f\* cares. Did I learn not to maniacally diverge after this, no. Should I have, yes.

The only thing where I got so far is in nesting my divergences. Honestly, this post is a divergence of a divergence of a divergence of a divergence. Insane. I'm thinking, maybe if I keep rowing the other direction, maybe I'll escape out of the trap I've set for myself.

Kids... You know why grownups do crazy shit that makes no logical sense? It's because they practice divergence and it goes too far so they start seriously lying to themselves and start believing in it. Why do they diverge? They can't face the truth. And the hardest truth is that we are all going to eventually die.

I promise that I will try my best not to diverge anymore. Diverges...
