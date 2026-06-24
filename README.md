# boxthis

**Reach the network floor: paint visible content as close as the network allows, then stream the rest.**

[`lightsout`](https://github.com/theharshal30/lightsout) measures the **network floor** — the earliest first paint
the network permits. Its [benchmark](https://github.com/theharshal30/lightsout/blob/main/bench/RESULTS.md) found what
actually keeps real pages from reaching that floor: **JavaScript.** Sites that
paint early (Figma, Dell) win not because their HTML is small, but because they
put *visible content* on the wire first and defer the script. Sites that paint
late ship a tiny HTML shell and then make the browser wait on megabytes of JS —
their document "fits 14 KB" and it buys them nothing.

`boxthis` is the tool for the winning strategy. The goal isn't merely to *fit*
under 14 KB; it's to **reach the floor** — get real, styled, above-the-fold
content painted in the first round-trip with **no client JavaScript in the way**,
then stream everything else. Small is the means; *early* is the goal.

You give it a **critical shell** (above-the-fold HTML + inline critical CSS) and a
list of **deferred parts** (slow data, below-the-fold sections). It:

1. **Flushes the shell immediately** — the browser's incremental parser paints it
   as soon as the first chunk lands, i.e. in the first round-trip.
2. **Measures that shell against the 14 KB budget** (the `lightsout` check) and
   warns — or throws, in `strict` mode — if it busts.
3. **Streams the deferred parts** afterwards, in the same HTTP response, as each
   one resolves. Slow data arrives late, but the user already saw the page.

**No client JavaScript.** The shell is plain streamed HTML, so it paints with no
extra round-trips. (A JS-powered "render early" widget would be self-defeating —
the script is itself a sub-resource that costs the round-trip you're saving.)

```js
import { createServer } from "node:http";
import { ship } from "boxthis";

createServer(async (req, res) => {
  const r = await ship(res, {
    head: "<style>/* critical, inlined CSS */</style>",
    critical: "<header>…above the fold…</header>",      // flushed now
    deferred: [
      async () => renderComments(await db.comments()),  // streamed when ready
    ],
  });
  // r → { gzip, fits, over, roundTrips, networkFloorMs, classification }
  // e.g. { gzip: 8124, fits: true, roundTrips: 1, networkFloorMs: 150,
  //        classification: "Floor-limited" }
});
```

### It's a paint-efficiency library, not a byte-budget library

`ship()` doesn't just check a size; it reports the **network floor** of the shell
it streamed — and because that shell is JS-free and self-styled, the browser
paints it *on arrival*. So the shell's [Paint Readiness Ratio](https://github.com/theharshal30/lightsout#paint-readiness-ratio--classification)
(floor ÷ real FCP) is **≈ 1.0 — "Floor-limited"** by construction. That's the
whole goal: not "small HTML," but **paint at the floor**.

Don't take the "by construction" on faith — measure it. Serve the page and point
lightsout at it:

```bash
lightsout http://localhost:8014 --fcp
#   network floor       150 ms
#   actual FCP          ~180 ms   (measured in headless Chrome)
#   paint readiness       ~0.9    ✅ Floor-limited
```

Compare that to the JS-bound homepages in lightsout's
[benchmark](https://github.com/theharshal30/lightsout/blob/main/bench/RESULTS-hq.md) (PRR 0.03–0.11). Same network floor,
wildly different first paint — the difference is exactly the JavaScript boxthis
keeps out of the critical path.

## Why this works (the one-paragraph version you can defend)

A browser renders HTML incrementally as bytes arrive on a chunked response. If the
server flushes a complete, self-styled shell *first*, the browser paints it without
waiting for the slow parts of the page. Keeping that first flush under ~14 KB
(gzipped) means it fits TCP's initial congestion window and lands in a single
round-trip. `boxthis` is a ~150-line, zero-dependency helper that enforces exactly
that shape and guards the budget.

It's the same idea as React 18 streaming SSR / Suspense — but tiny, framework-
agnostic, and **explicitly budget-aware** (it fails at the 14 KB boundary, which
frameworks don't).

## Run the demo

```bash
npm run demo
# open http://localhost:8014  — hero paints instantly, comments stream in ~1.2s later
# curl --no-buffer -s http://localhost:8014   — watch the bytes arrive in two bursts
# http://localhost:8014/over  — see the budget guard fire
```

## `boxthis audit` — gate on paint readiness

Does a served page actually paint at the network floor? Audit it:

```bash
boxthis audit http://localhost:3000          # target: PRR ≥ 0.8 (Floor-limited)
boxthis audit https://example.com --target 0.8 --rtt 150
```

```
  boxthis audit — http://localhost:8014
  ════════════════════════════════════════════════════
  paint readiness   0.87   ✅ Floor-limited
  network floor     150 ms
  actual FCP        172 ms   (measured in headless Chrome)

  boxthis target    PRR ≥ 0.80   ✅ PASS
```

Exit code is `1` when the page misses the target, so it drops into CI next to
your boxthis-rendered routes. This is the relationship the benchmark created:

> **lightsout *measures* paint readiness. boxthis *improves* it. `boxthis audit`
> *gates* on it.** A boxthis page passes its own audit (PRR 0.87 above); ordinary
> JS homepages fail it (Spotify: PRR 0.03 ❌).

Measurement is delegated to the companion [`lightsout`](https://github.com/theharshal30/lightsout) tool (`lightsout
<url> --fcp --json`), so there's one source of truth for the number — boxthis
just applies its target.

## API

### `ship(res, options) → Promise<{ gzip, fits, over, roundTrips, networkFloorMs, classification }>`

| option | type | meaning |
| --- | --- | --- |
| `critical` | `string \| () => string` | Above-the-fold markup. **Must be synchronous** — it paints first, so it can't await. |
| `head` | `string \| () => string` | Inline `<head>` content (critical CSS, `<title>`, preloads). Synchronous. |
| `deferred` | `Array<string \| Promise \| () => (string\|Promise)>` | Streamed in order, each as it resolves. Put slow work here. |
| `budget` | `number` | First-flush byte budget. Default `14 * 1024`. |
| `rtt` | `number` | Assumed RTT (ms) for the reported `networkFloorMs`. Default `150`. |
| `strict` | `boolean` | `true` → throw on budget bust instead of warning. |
| `onBudget` | `(info) => void` | Custom over-budget handler (overrides the default warning). |
| `headers` | `object` | Extra response headers. |

The result reports paint-efficiency: `networkFloorMs` is the floor the shell
reaches (`roundTrips × rtt`) and `classification` is its
[PRR bucket](https://github.com/theharshal30/lightsout#paint-readiness-ratio--classification) — `"Floor-limited"`
for a shell that paints on arrival. Also sends `x-boxthis: fit` /
`x-boxthis: over;by=<bytes>` so a proxy/CDN/CI can read the verdict without
parsing the body.

### `criticalChunk({ head, body, budget, rtt }) → { html, gzip, fits, over, roundTrips, networkFloorMs, classification }`

Compose and measure the shell **without sending anything** — useful in a build step
or test to assert the critical path stays under budget and at the network floor.

### `classifyPRR(prr) → "Floor-limited" | … | "JS-bound" | null`

The five-bucket classifier (mirrors `lightsout`). Feed it a real measured PRR
(`networkFloorMs ÷ FCP`) to label any page, not just a boxthis shell.

## Honest limitations (know these before you defend it online)

- **Compression middleware can defeat streaming.** A gzip layer that buffers the
  whole response before compressing erases the early flush. Configure it to flush
  per-write (`boxthis` calls `res.flush?.()` to cooperate), or compress upstream.
- **Buffering proxies/CDNs.** nginx `proxy_buffering on`, some CDNs, and a few
  corporate proxies hold the response until it's complete. Streaming needs an
  unbuffered path end-to-end.
- **The 14 KB budget is measured on the gzipped shell as a standalone estimate.**
  The real on-the-wire size depends on how your server compresses the stream — same
  honest caveat as `lightsout`.
- **It needs a server (SSR).** Static hosts can't stream dynamically; for static
  pages the equivalent is "inline critical CSS, put above-the-fold first" at build
  time.
- **In-order streaming only (v1).** Out-of-order streaming (render slots as they
  finish, regardless of document order) needs a small inline script to slot content
  into place — deliberately omitted to keep the shell JS-free. It's the natural v2.
- **TLS/TCP handshakes still happen first.** `boxthis` optimises the *data* round-
  trips after the request; the connection setup cost is fixed and separate.

## License

MIT
