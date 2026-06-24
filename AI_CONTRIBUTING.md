# Contributing (humans and AI agents both welcome)

boxthis welcomes contributions from people and from AI coding agents alike.

## Before you start
- Pick an issue, ideally one labeled `good first issue` or `help wanted`.
- Keep the **zero-dependency** rule: no runtime dependencies.
- ESM only (`.mjs`), Node >= 18.

## Definition of done
- `npm test` passes.
- One focused change per pull request.
- The critical-shell budget logic and the streaming behaviour stay intact unless
  the issue explicitly asks to change them.

## For AI agents
Machine-readable context lives in `.github/copilot-instructions.md`. Read it
first, then open a small, well-scoped PR. It will be reviewed before merge.
