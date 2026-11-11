# exposure-dashboard

A Next.js dashboard that visualizes the output of [`../exposure-toolkit`](../exposure-toolkit):
per-repo fork copies, GitHub traffic, Common Crawl captures, and the **SOC 2
audit trail** (with client-side hash-chain verification).

> Like the toolkit, this dashboard reports **exposure and propagation**, not
> training inclusion.

## How data flows

The dashboard renders a static `data/snapshot.json`. That file is produced by
`scripts/ingest.mjs`, which reads the toolkit's `exposure-output/`:

- latest `sweep_*/summary.tsv` → per-repo forks/views/clones/crawl
- latest `repos_<owner>_*.json` → stars / urls
- `forks_*_*.json` → individual fork copies
- `audit/audit.jsonl` → SOC 2 audit events (the chain is re-verified in Node,
  mirroring `lib/audit.sh`: `sha256(prev_hash + canonicalJSON(body))`)

```
exposure-toolkit/exposure-output  ──ingest──►  dashboard/data/snapshot.json  ──►  Next.js
```

## Local development

```bash
npm install
npm run ingest     # refresh data/snapshot.json from ../exposure-toolkit/exposure-output
npm run dev        # http://localhost:3000
```

Refresh data after a new sweep:

```bash
( cd ../exposure-toolkit && JOBS=8 ./exposure.sh sweep elevate-foundry scan )
npm run ingest
```

Environment overrides for `ingest`:

| Var | Default | Meaning |
|-----|---------|---------|
| `EXPOSURE_OUT_DIR` | `../exposure-toolkit/exposure-output` | toolkit output dir |
| `EXPOSURE_OWNER` | `elevate-foundry` | GitHub owner |

## Deploy to Vercel

The build does **not** run `ingest` (the toolkit output isn't present in the
Vercel build environment), so the committed `data/snapshot.json` is the source
of truth. Refresh it locally and commit before deploying.

1. Commit `data/snapshot.json` (and the rest of `dashboard/`).
2. In Vercel: **New Project** → import the repo.
3. Set **Root Directory** to `dashboard`.
4. Framework preset: **Next.js** (auto-detected). Deploy.

Or via CLI:

```bash
npm i -g vercel
vercel        # from the dashboard/ directory; first run links the project
vercel --prod
```

To keep the dashboard fresh you can re-run the sweep + `npm run ingest` on a
schedule (e.g. cron or a CI job) and push the updated `snapshot.json`.
