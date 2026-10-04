# UNSCROLL

The existing screen-time picker and 18 visual palettes are preserved. The next screen is a native textarea styled as full-page typography, with a caret and brief cobalt glyph overlays. Input remains native for selection, composition, paste and mobile editing.

## Run it

```bash
cp .env.example .env      # add your OpenRouter key
npm run dev               # http://localhost:8787
```

`npm run dev` builds the bundle and serves the real Worker handler on your machine, so no Cloudflare account is needed. `npm test` runs fully offline, and `npm run build` writes `dist/server/index.js`.

## Scripts

- `npm run dev`: build, then serve locally on `PORT` (default 8787) with `.env` loaded.
- `npm start`: serve the existing `dist/server/index.js` without rebuilding.
- `npm run build`: writes `dist/server/index.js` (Worker bundle with `web/` embedded) and `public/` (static output Vercel serves).
- `npm test`: request boundaries, plan validation, allocation arithmetic, resource allowlisting, escaping, continuity, the OpenRouter request contract, and the Vercel function adapter.
- `node tests/live.mjs`: optional live-provider scenarios. Reads `OPENROUTER_API_KEY` from the environment. `FULL_TEST=1` runs the full topic/time matrix, `REMAINING=1` the short one. Never put a key in source.

## Deployment targets

- **Vercel**: `vercel.json` sets `outputDirectory: public`; `api/plan.js` handles `POST /api/plan`. Add `OPENROUTER_API_KEY` in the dashboard — `.env` is gitignored and never reaches Vercel.
- **Cloudflare Workers**: `wrangler.toml` points at `dist/server/index.js`; `wrangler secret put OPENROUTER_API_KEY`.

`api/plan.js` imports the same `server/index.js` handler the Worker uses, so there is one copy of the planning logic across all three targets.

## Runtime

`OPENROUTER_API_KEY` is required and stays server-side; the browser only ever talks to `/api/plan`. `OPENROUTER_MODEL` overrides the default `deepseek/deepseek-v4.1-flash`. `RATE_LIMIT_PER_MINUTE` sets the per-IP request guard, defaulting to 3; the limiter is in-memory and per Worker instance, so use provider-side quotas to bound aggregate spend.

Requests go to `POST https://openrouter.ai/api/v1/chat/completions` with `Authorization: Bearer …`, `response_format` set to a strict JSON schema, reasoning disabled, `stream: false`, a `max_tokens` budget scaled to the number of requested possibilities, and a bounded per-attempt timeout inside an 80s overall deadline. Rate limits (429) and upstream failures (408/500/502/503/524/529) retry with jittered exponential backoff, as the provider documents. A 400/422 drops structured-output mode and retries with plain-JSON instructions. A 404 on an overridden model falls back to `deepseek/deepseek-v4.1-flash`. Token counts and cost are logged server-side; no secret is logged or returned.

`POST /api/plan` accepts free-form interest, an integer minute budget, optional prior-session context and excluded titles. It validates structured output and exact totals, and repairs malformed model JSON once before giving up. Resource URLs come only from the curated catalog, never from model-generated strings. No dynamic web search is claimed; unsupported topics receive self-contained exercises.

Plans, written interests and explicitly completed tasks remain in current-tab memory. No account or cross-visit persistence is implemented. Small budget edits preserve task identity and adjust trailing practice blocks; larger edits regenerate with context. Nothing is marked complete until the user explicitly confirms it.

The text entered by the user is sent to OpenRouter only on submission. Requests have same-origin checks, bounded input/output, and a per-IP rate limiter.

## Verification limitations

Live-provider and programmatic tests are separate from visual QA. Animation appearance and physical mobile keyboard behavior still require visual testing in a real browser.