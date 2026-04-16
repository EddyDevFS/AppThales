# App Thales

This project is now structured as a Cloudflare Pages app with:

- `mockup.html`: the main frontend
- `functions/api/*`: Cloudflare Pages Functions API
- `migrations/0001_initial.sql`: D1 schema and default reference data
- `wrangler.toml`: Cloudflare configuration

## What changed

The previous `localStorage` persistence was replaced with:

- Cloudflare Pages Functions for API endpoints
- Cloudflare D1 for persistent storage

The frontend now loads and mutates incidents through `/api/*`.

## Cloudflare setup

1. Create a D1 database:

```bash
npx wrangler d1 create app-thales-db
```

2. Copy the returned `database_id` and `preview_database_id` into [wrangler.toml](./wrangler.toml).

3. Apply the migration locally or remotely:

```bash
npx wrangler d1 migrations apply app-thales-db --local
npx wrangler d1 migrations apply app-thales-db --remote
```

4. In Cloudflare Pages, bind the D1 database to the Pages project with the binding name `DB`.

## Local development

Run the Pages app locally with Functions enabled:

```bash
npx wrangler pages dev .
```

Then open the local URL and use the app through `index.html` or `mockup.html`.

## Deployment notes

- `index.html` redirects to `mockup.html`
- the app expects the D1 binding to be named `DB`
- if the binding is missing, the UI shows an error banner instead of silently failing
