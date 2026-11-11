# dashboard

## Purpose
Static Next.js dashboard for the latest exposure snapshot.

## Data flow
`../exposure-toolkit/exposure-output` -> `scripts/ingest.mjs` -> `data/snapshot.json` -> app UI

## Common commands
```bash
npm install
npm run ingest
npm run dev
npm run build
```

## Conventions
- `data/snapshot.json` is committed source-of-truth for deploys.
- Do not assume Vercel has toolkit output available during build.
- Update ingest logic when toolkit output schema changes.

## Gotchas
- `.next/` and `node_modules/` are generated.
- Build does not refresh snapshot automatically.
