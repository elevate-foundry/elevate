#!/usr/bin/env node
// ingest.mjs - transform the exposure-toolkit output into a single snapshot.json
// that the dashboard imports at build time.
//
// Reads (relative to the repo root, ../exposure-toolkit/exposure-output by default):
//   - the latest sweep_*/summary.tsv          -> per-repo forks/views/clones/crawl
//   - the latest repos_<owner>_*.json         -> stars, urls, updatedAt
//   - forks_*_*.json                          -> individual fork copies
//   - audit/audit.jsonl                       -> SOC 2 audit trail (hash-chain verified)
//
// Writes: dashboard/data/snapshot.json

import { createHash } from "node:crypto";
import {
  readdirSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR =
  process.env.EXPOSURE_OUT_DIR ||
  join(ROOT, "..", "exposure-toolkit", "exposure-output");
const DATA_DIR = join(ROOT, "data");
const OWNER = process.env.EXPOSURE_OWNER || "elevate-foundry";

function safeRead(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function listDir(path) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

// Pick the most recent file/dir matching a predicate (names are timestamped, so
// lexicographic sort == chronological).
function latest(entries, test) {
  return entries.filter(test).sort().reverse()[0];
}

// ---- sweep summary -----------------------------------------------------------
function loadSweep() {
  const dirs = listDir(OUT_DIR).filter((d) => {
    try {
      return statSync(join(OUT_DIR, d)).isDirectory() && d.startsWith("sweep_");
    } catch {
      return false;
    }
  });
  // Only consider sweeps that actually produced a populated summary.tsv
  // (killed/aborted runs leave empty dirs behind). Prefer a full "scan" sweep.
  const hasData = (d) => {
    const tsv = safeRead(join(OUT_DIR, d, "summary.tsv"));
    return tsv && tsv.trim().split("\n").length > 1;
  };
  const valid = dirs.filter(hasData);
  const dir =
    latest(valid, (d) => d.startsWith("sweep_scan_")) ||
    latest(valid, () => true);
  if (!dir) return { dir: null, repos: [] };

  const tsv = safeRead(join(OUT_DIR, dir, "summary.tsv"));
  if (!tsv) return { dir, repos: [] };

  const rows = tsv.trim().split("\n").slice(1); // drop header
  const repos = rows
    .map((line) => {
      const [name, forks, views, clones, crawl] = line.split("\t");
      return { name, forks, views, clones, crawl };
    })
    .filter((r) => r.name);
  return { dir, repos };
}

// ---- repo metadata (stars / urls) -------------------------------------------
function loadRepoMeta() {
  const files = listDir(OUT_DIR);
  const f = latest(files, (n) => n.startsWith(`repos_${OWNER}_`) && n.endsWith(".json"));
  if (!f) return {};
  try {
    const arr = JSON.parse(safeRead(join(OUT_DIR, f)) || "[]");
    const map = {};
    for (const r of arr) {
      map[r.name] = {
        stars: r.stargazerCount ?? null,
        forkCount: r.forkCount ?? null,
        updatedAt: r.updatedAt ?? null,
        url: r.url ?? `https://github.com/${OWNER}/${r.name}`,
      };
    }
    return map;
  } catch {
    return {};
  }
}

// ---- BIFM-256: pack a repo's change-state into one 8-dot braille cell --------
// cell = U+2800 + byte, byte = (kappa<<5)|(sigma<<2)|delta. Mirrors tools/fuse-repos.mjs.
const BIFM_KAPPA = ["trivial", "minor", "moderate", "notable", "significant", "major", "sweeping", "monumental"];
const BIFM_SIGMA = ["static", "calm", "steady", "active", "brisk", "turbulent", "volatile", "explosive"];
const BIFM_DELTA = ["fresh", "recent", "drifting", "dormant"];
function bifm256(commits, createdAt, pushedAt) {
  const now = Date.now();
  const days = (d) => (d ? (now - new Date(d).getTime()) / 86400000 : 9999);
  const c = commits || 0;
  const ageW = Math.max(1, days(createdAt) / 7);
  const idle = days(pushedAt);
  const kappa = Math.min(7, Math.floor(Math.log2(c + 1)));
  const sigma = Math.min(7, Math.round(c / ageW));
  const delta = idle < 30 ? 0 : idle < 90 ? 1 : idle < 180 ? 2 : 3;
  const byte = (kappa << 5) | (sigma << 2) | delta;
  return {
    kappa, sigma, delta, byte,
    cell: String.fromCodePoint(0x2800 + byte),
    words: `${BIFM_KAPPA[kappa]} change, ${BIFM_SIGMA[sigma]} volatility, ${BIFM_DELTA[delta]} drift`,
  };
}

// ---- extra repo metadata (commits + dates, from data/repo-meta.json) ---------
// Produced by scripts/fetch-meta.mjs (committed so the Vercel build needs no gh).
function loadExtraMeta() {
  const raw = safeRead(join(DATA_DIR, "repo-meta.json"));
  if (!raw) return {};
  try {
    return JSON.parse(raw).repos || {};
  } catch {
    return {};
  }
}

// ---- fork details ------------------------------------------------------------
function loadForkDetails() {
  const files = listDir(OUT_DIR).filter(
    (n) => n.startsWith("forks_") && n.endsWith(".json"),
  );
  // Keep only the latest file per repo.
  const byRepo = {};
  for (const f of files.sort()) {
    const m = f.match(/^forks_(.+)_\d{8}_\d{6}\.json$/);
    if (!m) continue;
    byRepo[m[1]] = f; // later (sorted) wins = most recent
  }
  const out = [];
  for (const [key, f] of Object.entries(byRepo)) {
    try {
      const j = JSON.parse(safeRead(join(OUT_DIR, f)) || "{}");
      if (!Array.isArray(j.forks) || j.forks.length === 0) continue;
      const repoName = (j.repo && j.repo.name) || key.replace(`${OWNER}_`, "");
      out.push({
        repo: repoName,
        forks: j.forks.map((fk) => ({
          full_name: fk.full_name,
          html_url: fk.html_url,
          created_at: (fk.created_at || "").slice(0, 10),
          owner: fk.owner && fk.owner.login,
        })),
      });
    } catch {
      /* ignore malformed */
    }
  }
  return out.sort((a, b) => b.forks.length - a.forks.length);
}

// ---- audit trail + hash-chain verification ----------------------------------
// Mirrors lib/audit.sh: hash = sha256(prev_hash + canonicalJSON(body without integrity)).
function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") {
    const ks = Object.keys(v).sort();
    return "{" + ks.map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

function loadAudit() {
  const path = join(OUT_DIR, "audit", "audit.jsonl");
  const raw = safeRead(path);
  if (!raw) return { present: false, integrityOk: null, recordCount: 0, events: [], runId: null };

  const lines = raw.trim().split("\n").filter(Boolean);
  let prev = "GENESIS";
  let bad = 0;
  const events = [];
  for (const line of lines) {
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      bad++;
      continue;
    }
    const { integrity, ...body } = rec;
    const calc = createHash("sha256")
      .update((integrity?.prev_hash ?? "") + canon(body))
      .digest("hex");
    const ok = integrity?.prev_hash === prev && calc === integrity?.hash;
    if (!ok) bad++;
    prev = integrity?.hash ?? prev;
    events.push({
      ts: rec.ts,
      seq: rec.seq,
      event: rec.event,
      target: rec.target,
      outcome: rec.outcome,
      actor: rec.actor,
      detail: rec.detail,
      hash: integrity?.hash?.slice(0, 12),
      verified: ok,
    });
  }
  return {
    present: true,
    integrityOk: bad === 0,
    recordCount: lines.length,
    badCount: bad,
    runId: events.find((e) => e.event === "sweep.start")?.detail || null,
    events,
  };
}

// ---- assemble ----------------------------------------------------------------
function build() {
  const { dir, repos } = loadSweep();
  const meta = loadRepoMeta();
  const extra = loadExtraMeta();
  const forkDetails = loadForkDetails();
  const audit = loadAudit();

  const day = (s) => (s ? String(s).slice(0, 10) : null);
  const merged = repos.map((r) => {
    const x = extra[r.name] || {};
    return {
      ...r,
      ...(meta[r.name] || {}),
      commits: typeof x.commits === "number" ? x.commits : null,
      isFork: x.isFork ?? null,
      language: x.language ?? null,
      createdAt: day(x.createdAt),
      pushedAt: day(x.pushedAt || (meta[r.name] || {}).updatedAt),
      bifm: bifm256(x.commits, x.createdAt, x.pushedAt || (meta[r.name] || {}).updatedAt),
      forksNum: /^\d+$/.test(r.forks) ? Number(r.forks) : 0,
      crawlNum: /^\d+$/.test(r.crawl) ? Number(r.crawl) : null,
      crawlError: r.crawl === "ERR",
    };
  });

  const totals = {
    publicRepos: merged.length,
    reposWithForks: merged.filter((r) => r.forksNum > 0).length,
    totalForks: merged.reduce((a, r) => a + r.forksNum, 0),
    crawlCaptures: merged.reduce((a, r) => a + (r.crawlNum || 0), 0),
    crawlErrors: merged.filter((r) => r.crawlError).length,
    totalStars: merged.reduce((a, r) => a + (r.stars || 0), 0),
    totalCommits: merged.reduce((a, r) => a + (r.commits || 0), 0),
    nativeCommits: merged
      .filter((r) => r.isFork === false)
      .reduce((a, r) => a + (r.commits || 0), 0),
    lastActivity:
      merged.map((r) => r.pushedAt).filter(Boolean).sort().reverse()[0] || null,
  };

  const snapshot = {
    generatedAt: new Date().toISOString(),
    owner: OWNER,
    sweepDir: dir,
    totals,
    repos: merged.sort((a, b) => b.forksNum - a.forksNum || a.name.localeCompare(b.name)),
    forkDetails,
    audit,
  };

  // Safety: never clobber a good committed snapshot with an empty one. This
  // matters on hosts (e.g. Vercel) where the exposure-toolkit output isn't
  // present at build time — there the committed snapshot.json is the source.
  const target = join(DATA_DIR, "snapshot.json");
  if (merged.length === 0 && existsSync(target)) {
    console.log(
      "ingest: no toolkit output found — keeping existing snapshot.json (not overwriting)",
    );
    return;
  }

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(target, JSON.stringify(snapshot, null, 2));
  console.log(
    `ingest: ${merged.length} repos, ${totals.totalForks} forks, ${totals.totalCommits} commits, audit=${
      audit.present ? (audit.integrityOk ? "OK" : "TAMPERED") : "absent"
    } -> data/snapshot.json`,
  );
}

build();
