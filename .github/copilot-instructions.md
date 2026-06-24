# AI agent instructions for boxthis

boxthis is a zero-dependency Node server primitive. It streams a budget-capped,
JS-free critical shell in the first network round-trip so the page paints on
arrival, then streams the rest of the response. Its companion `lightsoutt`
measures paint readiness; boxthis improves it.

## Layout
- `src/ship.mjs` — the library: `ship(res, opts)`, `criticalChunk(opts)`, `classifyPRR(prr)`.
- `bin/boxthis.mjs` — the CLI: `boxthis audit <url>` (delegates measurement to `lightsoutt`).
- `demo/server.mjs` — a runnable streaming demo (`npm run demo`).
- `test/ship.test.mjs` — the tests (`npm test`).

## Conventions
- Zero runtime dependencies. Keep it that way.
- ESM only (`.mjs`). Node >= 18.
- Two-space indentation, double quotes.
- `npm test` must stay green.

## Where to help
See the open issues, especially those labeled `good first issue` and
`help wanted`. AI-authored pull requests are welcome. Keep the zero-dependency
rule and make the tests pass.
