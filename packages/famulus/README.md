# Famulus

> *famulus* (n.) — a scholar's or magician's attendant who carries out their work.

An offline-by-default, consent-bound local agent engine that wraps Ollama. It treats
every downloaded local model as a competitor in a hardware-aware horserace, executes
real system actions through tiered capability domains behind a per-model consent system
and a tool algebra (READ -> WRITE -> EXEC), and can **cold-start itself from a minimal
base** when Ollama isn't even installed yet.

> Full design lives in `~/.windsurf/plans/offline-operator-a700b8.md`.

## What famulus is (in plain words)

Famulus is a program you run on your own computer. It sets up and runs an AI
assistant that lives entirely on that one machine. It does not need the internet
to think, it does not send your information anywhere, and it always asks for your
permission before it does anything that changes your computer.

A simple way to picture it: famulus is like hiring a helper who works only inside
your own house. The helper does not phone anyone, does not let strangers in, and
stops to ask you "is this okay?" before touching anything important. If your
internet is cut off, the helper keeps working, because everything it needs is
already inside the house.

In one line: **famulus is a private assistant that runs on your own computer,
keeps everything there, works without the internet, and asks before it acts.**

That promise means the same thing no matter who you are:

- It runs on your computer, not on someone else's.
- It works without the internet.
- It keeps your information on your machine.
- It tells you what it is about to do, and waits for your "yes."
- It keeps a plain, readable record of what it did.
- It belongs to you, and does not depend on any company to keep running.

## What famulus is NOT

- **Not a cloud service.** Nothing runs on someone else's servers.
- **Not a data collector.** It does not track you or send your information away.
- **Not silent.** It never changes your computer without first asking and telling
  you what it will do.
- **Not locked to a vendor.** It was written with the help of an AI coding tool
  (Cascade / Windsurf), but it does not depend on, contain, or call that tool to
  run. You own it and can run it anywhere by itself.
- **Not a "function runtime" or serverless platform.** It is a local assistant
  launcher, not infrastructure for running other people's code.

## Core principle: DON'T HARDCODE ANYTHING

Hardware specs, OS, GPU/CPU details, model lists, budget thresholds, paths, and tool
catalogs are **discovered at runtime or read from config** -- never baked into code.
The only OS-specific code is a tiny read-only "ignition probe."

## The bootstrap paradox (and how we resolve it)

You cannot bootstrap from *literally nothing* -- every system rests on an irreducible
Trusted Computing Base: powered hardware, firmware, a kernel, and a minimal interpreter.
What we *can* do is push the floor so low it is effectively "nothing" for any realistic
situation, then have the engine self-extend up a ladder where each rung needs only the
rung below it:

```
L0  hardware + firmware            the true floor (given)
L1  /bin/sh + curl                 near-universal on macOS/Linux -- the realistic "nothing"
L2  bootstrap.sh   <- THE SEED     pure POSIX sh: find/install python + curl, verify, hand off
L3  ignition probe (python stdlib) cross-platform host facts, ZERO third-party deps
L4  connectivity + Ollama install  ladder (ethernet/wifi/tether) + chain (cache/verified/one-liner)
L5  full engine + model swarm      pip deps install only AFTER Ollama is up
```

Key consequence: **the launcher is POSIX `sh`, not Python**, because Python is the very
dependency a bare machine may lack. `sh` + `curl` are present out of the box on
essentially every macOS/Linux host.

### True blackout (no network, maybe no Python)

The paradox collapses into a physical artifact: a USB "seed crystal" containing
`bootstrap.sh` + a static Python build + the Ollama installer + one seed model. That
turns "bootstrap from nothing" into "bootstrap from a thumb drive" -- honest and
achievable. Point the launcher at the mounted medium:

```sh
FAMULUS_CACHE=/Volumes/SEED/cache ./bootstrap.sh
```

## Quick start

```sh
# From a powered machine with a shell:
./bootstrap.sh            # L2 -> L3 -> L4 (skips install if Ollama already present)
```

On a host that already has Ollama (like the dev machine), `bootstrap.sh` detects it and
hands straight off to the engine -- no network touched.

### Safety

Bringing up the network and installing software are the *only* actions that touch the
network and mutate system state during cold-start. They are a single, one-time
EXEC + network consent event, fully narrated and written to the audit log. Nothing here
is silent or auto-repeating. Run with `--turbo` to relax prompting for already-granted,
non-destructive steps.

## Auditability (and what "SOC 2" means here)

**SOC 2 is an attestation about an *organization's* controls, issued by an auditor --
it is not something a program can "be."** No code change makes software "SOC 2
compliant" on its own. What famulus does is implement the technical audit-trail
controls a SOC 2 examination expects, so an operator's broader program has them out of
the box.

The audit log (`famulus/safety/audit.py`) provides:

- **Append-only, structured JSONL.** One event per line capturing *who* (`actor`: OS
  user + uid), *what* (`event` + structured `data`), *when* (UTC `ts`), and *where*
  (`host`, `pid`), plus a schema version and a monotonic `seq`.
- **Tamper-evident chaining.** Each record is linked to the previous by digest, so
  edits, insertions, and mid-stream truncation fail `verify()`.
- **Optional keyed integrity (recommended for shared hosts).** Set
  `FAMULUS_AUDIT_HMAC_KEY` and the chain uses HMAC-SHA256. Because the key need not
  live beside the log, a local rewrite cannot forge a valid chain. Without a key it
  degrades to a plain SHA-256 chain (edit/insert-evident, but forgeable by anyone who
  can rewrite the file).
- **Trailing-truncation guard.** A backward chain can't notice that the *last* records
  were dropped; `verify_tip(expected_last_hash)` catches that against an external
  high-water mark.
- **Owner-only permissions** (`0600` file / `0700` dir) and **durable writes**
  (`flush` + `fsync`).
- **No secret values.** Consent prompts record only whether a value was supplied, never
  the value itself.

Consent is audited too: every approval request and its outcome (allow / deny /
turbo-auto-allow / non-interactive fail-closed) is written *before* the action proceeds.

Still the operator's responsibility for an actual SOC 2: log retention and offsite
shipping, monitoring/alerting, access reviews, and change management. Also note the
**full tool-call audit** (every READ/WRITE/EXEC through the tool algebra) lands with
Phase 0 -- today's coverage is the bootstrap actions and the consent gate.

## Development & testing

The Phase -1 core is **standard-library only**, so the fastest confidence check needs
no dependencies at all -- ideal right after a fresh `git clone` on a new machine:

```sh
python3 -m famulus.selfcheck
```

It imports the core, runs the ignition probe, verifies the audit chain (and tamper
detection), and checks seed selection -- exiting non-zero (and printing the first
failure) if anything is wrong on this host.

For the full suite (uses `pytest`):

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"     # installs pytest
python -m pytest -q
```

Notes:

- Run pytest as `python -m pytest` (not bare `pytest`) so the repo root is on the
  import path even without an editable install.
- **CI** runs the selfcheck and the full suite on **macOS, Linux, and Windows** across
  **Python 3.9-3.13** (`.github/workflows/ci.yml`) -- that matrix is what backs the
  "works when you pull it down anywhere" claim. 100% certainty is impossible, but the
  green matrix plus the stdlib-only contract test makes the failure surface small and
  explicit.

### Verify on real devices (one command)

`scripts/verify.sh` clones nothing on its own; the one-liner below clones-or-updates the
repo and runs it (selfcheck + best-effort suite). The **same POSIX command** works on
macOS, Linux, Windows (Git Bash/WSL), and Android (Termux):

```sh
u=https://github.com/elevate-foundry/famulus.git; if [ -d famulus/.git ]; then git -C famulus pull --ff-only; else git clone "$u" famulus; fi && sh famulus/scripts/verify.sh
```

Native Windows PowerShell (if you are not in Git Bash/WSL):

```powershell
$u="https://github.com/elevate-foundry/famulus.git"; if(Test-Path famulus\.git){git -C famulus pull --ff-only}else{git clone $u famulus}; powershell -ExecutionPolicy Bypass -File famulus\scripts\verify.ps1
```

Per-device prerequisites (each needs **Python 3.9+** and **git**):

| Device | Shell to use | One-time setup |
| --- | --- | --- |
| macOS laptop | Terminal | none |
| Linux (Dell XPS) | bash/zsh | none |
| Surface Pro 8 (Windows) | Git Bash or WSL (POSIX line), or PowerShell | install Git + Python |
| Galaxy S25+ (Android) | Termux | install Termux (F-Droid), then `pkg install -y python git` |

There is no command that is *byte-identical* across all four shells, but the line above is
as close as it gets: standardize the shell (Git Bash/WSL on Windows, Termux on Android)
and it is literally the same command everywhere.

## Status

Phase -1 (cold-start bootstrap) is under construction. See the plan for the full phase
roadmap.
