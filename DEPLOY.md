# UNSCROLL — run it locally, then push it to GitHub

UNSCROLL is a Cloudflare-Worker-shaped app: `server/index.js` exports a `fetch(request, env)`
handler and `web/` holds the frontend that gets embedded into it at build time. You can run the
whole thing on your own machine with Node — **Cloudflare is not required.**

## DeepSeek: there is nothing to install

`deepseek/deepseek-v4.1-flash` is not a package, a binary, or a local model. It runs on
OpenRouter's servers and this project calls it over HTTPS:

- Model id: `deepseek/deepseek-v4.1-flash`
- Endpoint: `POST https://openrouter.ai/api/v1/chat/completions`
- Auth: `Authorization: Bearer $OPENROUTER_API_KEY`
- Reference: https://openrouter.ai/deepseek/deepseek-v4.1-flash/llms.txt

The only "installation" is an API key. Create one at https://openrouter.ai/settings/keys and put
it in `.env`. Never commit that file — it is already in `.gitignore`.

## Requirements

- Node.js 18 or newer (Node 22+ recommended). No npm dependencies to install; `npm install` is a
  no-op that just creates a lockfile entry.

## 1. Configure

```bash
copy .env.example .env      # Windows PowerShell
cp .env.example .env        # macOS / Linux
```

Then edit `.env` and paste your key:

```
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=deepseek/deepseek-v4.1-flash
PORT=8787
RATE_LIMIT_PER_MINUTE=3
```

`OPENROUTER_MODEL` is optional and defaults to `deepseek/deepseek-v4.1-flash`. Any
`provider/model` slug works, so you can point the app at a cheaper or newer model without a code
change.

## 2. Run the checks

```bash
npm install
npm test
npm run build
```

`npm test` runs entirely offline: it stubs the OpenRouter call and asserts the request shape
(endpoint, headers, model id, `response_format`, retries, fallbacks) plus the plan validator.
`npm run build` writes the Worker bundle to `dist/server/index.js` with `web/` embedded.

## 3. Run it locally

```bash
npm run dev
```

Then open http://localhost:8787. The dev server builds the bundle, loads `.env`, and serves the
real Worker handler, so what you see locally is exactly what a Worker would serve. Environment
variables in your shell override `.env`.

Pick another port with `PORT=8788 npm run dev`. If you raise `RATE_LIMIT_PER_MINUTE` while
testing, keep in mind it is a per-IP, in-memory guard, not a billing cap.

## 4. Push it to GitHub

```bash
git init
git add .
git commit -m "UNSCROLL: local dev server and DeepSeek V4.1 Flash via OpenRouter"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

`dist/server/`, `.env`, `.wrangler/` and `node_modules/` are ignored, so no key or generated
bundle is ever pushed. If the repository is private and you use a personal access token, Git
Credential Manager will prompt for it on the first push.

## Optional: live provider run

```bash
node tests/live.mjs
```

Reads `OPENROUTER_API_KEY` from the environment and calls the real model. `REMAINING=1` runs the
short residual matrix and `FULL_TEST=1` runs the full topic/time matrix; both space requests out
because they spend real credits. Never put a key in source.

## Optional: Cloudflare Workers

Only if you later want it hosted. `wrangler.toml` points at `dist/server/index.js`.

```bash
npm install -g wrangler
wrangler login
wrangler secret put OPENROUTER_API_KEY
npm run build
wrangler deploy
```

Rebuild before every deploy if you touched `web/` or `server/`. The request runs server-side in
either case, so the key never reaches the browser.