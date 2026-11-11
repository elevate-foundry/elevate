# exposure-toolkit

## Purpose
CLI toolkit for gathering evidence of public repo exposure: traffic, forks, Common Crawl captures, exact-string spread, canaries, and combined scans.

## Entry points
- `exposure.sh` — command router
- `scripts/` — subcommands
- `lib/` — shared shell helpers, audit logic, parallelism

## Common commands
```bash
./exposure.sh help
./exposure.sh traffic elevate-foundry/<repo>
./exposure.sh forks elevate-foundry
./exposure.sh crawl 'github.com/elevate-foundry/*'
./exposure.sh scan elevate-foundry/<repo>
```

## Conventions
- Report exposure and propagation only; do not overclaim training inclusion.
- Write timestamped artifacts to `exposure-output/`.
- Keep audit-chain behavior intact when editing event logging.

## Requirements
- `gh` authenticated
- `jq`, `curl`, `openssl`, bash 4+
