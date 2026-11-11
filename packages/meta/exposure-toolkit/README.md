# exposure-toolkit

Bash scripts that automate the workflow in [`../build.md`](../build.md): detect
whether your public GitHub repos have been **crawled, indexed, cloned, cached,
or exposed to AI systems**.

> **Important:** these tools verify **exposure and propagation**, not training
> inclusion. You generally cannot prove OpenAI/Anthropic trained on a repo
> unless they disclose the dataset, a model reproduces a unique canary without
> retrieval, or the repo appears in a known training corpus.

## Dependencies

| Tool | Required for | Install |
|------|--------------|---------|
| `bash` 4+ | everything | preinstalled (macOS: `brew install bash` for 4+) |
| `jq` | JSON parsing (all scripts) | `brew install jq` |
| `curl` | Common Crawl | preinstalled |
| `gh` (GitHub CLI, authenticated) | traffic, forks, live code search | `brew install gh && gh auth login` |
| `openssl` | canary token entropy (optional) | preinstalled |

## Usage

```bash
./exposure.sh help                                   # show all commands

./exposure.sh traffic elevate-foundry/cerebraille    # views/clones/referrers (owner-only)
./exposure.sh forks   elevate-foundry                # all public repos + fork copies
./exposure.sh forks   elevate-foundry/cerebraille    # single repo + its forks
./exposure.sh crawl   'github.com/elevate-foundry/*' # Common Crawl index lookup
./exposure.sh search  'semantic density operator'    # exact-string spread (add --open)
./exposure.sh canary  new --repo elevate-foundry/cerebraille
./exposure.sh canary  check CANARY_ELEVATE_FOUNDRY_2026_06_09_Q7K3
./exposure.sh canary  list
./exposure.sh scan    elevate-foundry/cerebraille    # traffic + forks + crawl in one pass
```

### Environment variables

| Var | Default | Meaning |
|-----|---------|---------|
| `OUT_DIR` | `./exposure-output` | where JSON/text reports are written |
| `CC_INDEX` | latest auto-discovered | space-separated Common Crawl index ids |
| `NO_COLOR` | unset | disable colored output |

## What maps to which `build.md` step

| Command | `build.md` step |
|---------|------------------|
| `traffic` | 1 — GitHub traffic |
| `search`  | 2 & 7 — exact strings + package/dataset contamination |
| `crawl`   | 3 — Common Crawl |
| `canary`  | 5 & 6 — canary tokens + careful model tests |
| `forks`   | 8 — forks/stars/watchers |

Steps 4 (server-log crawler fingerprints) and the model tests in step 6 require
infrastructure/manual judgement; `canary check` prints ready-to-paste prompts
for the model side.

## Output

All commands write timestamped reports to `OUT_DIR`. Minted canaries are logged
to `exposure-output/canaries.jsonl` so you can monitor them over time (e.g. via
cron + `canary check`).

## Evidence strength (from `build.md` §9)

- **Weak:** view/clone spike, README indexed, vague model summary.
- **Medium:** exact strings on third-party mirrors, Common Crawl capture, bots in your docs-site logs.
- **Strong:** unique canary reproduced by a model with browsing off, repo found in a known dataset, vendor dataset disclosure.
