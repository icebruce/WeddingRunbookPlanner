# Wedding Runbook Planner

A private, shared, one-day wedding planner: build the timeline on a phone or a
laptop, and run the day from it. HTML, CSS and vanilla JavaScript — no
framework, no bundler, no build step, and no runtime dependencies.

The specifications in `docs/` are the source of truth:

| Document | Decides |
|---|---|
| `docs/FUNCTIONAL_SPEC.md` | Behaviour |
| `docs/TECHNICAL_SPEC.md` | Architecture and implementation |
| `docs/DESIGN_GUIDE.md` | Look and feel |
| `docs/IMPLEMENTATION_PLAN.md` | Stage order and gates |
| `docs/mockups/` | Approved visual reference |

## Layout

```
api/          Vercel Functions
lib/server/   Server-only code (never served over HTTP)
public/       The only directory served to browsers
scripts/      Local dev server
tests/unit/   node --test
tests/e2e/    Playwright
```

`vercel.json` sets `outputDirectory: "public"`, so server code, seed data,
tests and package metadata are not downloadable from the site.

## Requirements

- Node.js 20+ (22 in CI)
- Upstash Redis REST credentials for production persistence
- `@playwright/test` is the only dependency, and it is dev-only

## Running it locally

1. Set the environment variables (see `.env.example`); at minimum:
   - `APP_PASSWORD`
   - `SESSION_SECRET` (32+ characters)
2. `npm install`
3. `npm run dev`
4. Open `http://127.0.0.1:4173`

With no Upstash variables set, data is stored in `.data/store.json`
(`LOCAL_DATA_FILE` overrides the path). On Vercel, cloud storage is required
and the app fails closed rather than falling back to a file.

## Testing

| Command | What it runs |
|---|---|
| `npm test` | Unit tests (`tests/unit/*.test.mjs`, `node --test`) |
| `npm run test:e2e` | Playwright end-to-end tests (`tests/e2e/*.spec.mjs`) |
| `npm run check` | Syntax check of the main modules |

The e2e harness starts one dev server per worker on its own port, backed by its
own data file, so tests never share state and never touch a real database. Each
test seeds the store directly through the `server` fixture.

Projects: `desktop-chrome` (1280 px), `iphone-13`, `pixel-7`, `ipad`.

> **Engine note.** `iphone-13` and `ipad` are WebKit projects. When WebKit is
> not installed — some sandboxes cannot download it — the config falls back to
> Chromium with the same iOS device descriptor and prints a warning, so a green
> local run is never mistaken for WebKit coverage. CI installs WebKit and runs
> those projects on the real engine.

Playwright is pinned to an exact version because the browser build revision has
to match the installed browsers.

## Production environment variables

| Variable | Purpose |
|---|---|
| `APP_PASSWORD` | Shared planner password |
| `SESSION_SECRET` | Random value, 32+ characters |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Upstash credentials |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Alternative names injected by the Vercel Upstash integration |

Changing `APP_PASSWORD` signs every device out.

## Deployment

Vercel builds a preview for every push and deploys `main` to production.
Preview and production use separate Upstash databases. Rolling back means
redeploying the previous production deployment; the stored format only ever
gains fields, so older deployments keep reading it.
