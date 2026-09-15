# Wedding Day Planner

A private, responsive one-day wedding timeline planner built with HTML, CSS, and vanilla JavaScript. It uses a linked/ripple scheduling model, fixed-time anchors, drag-and-drop reordering, duration resizing, conflict detection, autosave, and named versions.

## Requirements

- Node.js 20+ for local development and Vercel Functions
- No npm runtime or frontend dependencies
- Upstash Redis REST credentials for production persistence

## Local development

1. Copy `.env.example` values into your shell or `.env` loader of choice.
2. At minimum set:
   - `APP_PASSWORD`
   - `SESSION_SECRET` (32+ characters)
3. Run `npm run dev`.
4. Open `http://127.0.0.1:4173`.

When Upstash variables are absent locally, data is stored in `.data/store.json`. On Vercel, cloud storage is required.

## Production environment variables

- `APP_PASSWORD` — shared planner password
- `SESSION_SECRET` — random value of at least 32 characters
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — direct Upstash credentials, **or**
- `KV_REST_API_URL` + `KV_REST_API_TOKEN` — credentials injected by the Vercel Upstash integration

## Deployment

The repository is Vercel-ready. Import it as a project, configure the password/session variables and connect an Upstash Redis store, and deploy. Production and preview deployments can share or use separate Upstash databases depending on the desired isolation.

## Commands

- `npm test` — unit tests for scheduling, authentication, and persistence
- `npm run check` — JavaScript syntax checks
- `npm run dev` — zero-dependency local server
