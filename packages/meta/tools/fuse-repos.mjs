#!/usr/bin/env node
// fuse-repos.mjs - "fuse" the repos: write a federated CONSTELLATION.md into each
// native repo, committed with a BIFM-256 message (an 8-dot-braille change
// fingerprint) that out-does the salutations feat.privacy.fingerprint commit.
//
//   node tools/fuse-repos.mjs            # DRY RUN: write previews, no pushes/PRs
//   node tools/fuse-repos.mjs --apply    # open one PR per native repo
//
// Needs `gh` authenticated with write access. Forks are indexed but NOT committed
// to (INCLUDE_FORKS=1 to override).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "dashboard", "data");
const OWNER = process.env.EXPOSURE_OWNER || "elevate-foundry";
const APPLY = process.argv.includes("--apply");
const INCLUDE_FORKS = process.env.INCLUDE_FORKS === "1";
const BRANCH = "feat/constellation-bifm256";
const BASE_CP = 0x2800;

function gh(args, opts = {}) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
}
function readJSON(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

// ---- braille encoders --------------------------------------------------------
const SIX_DOT = { a:0x2801,b:0x2803,c:0x2809,d:0x2819,e:0x2811,f:0x280B,g:0x281B,h:0x2813,
  i:0x280A,j:0x281A,k:0x2805,l:0x2807,m:0x280D,n:0x281D,o:0x2815,p:0x280F,q:0x281F,r:0x2817,
  s:0x280E,t:0x281E,u:0x2825,v:0x2827,w:0x283A,x:0x282D,y:0x283D,z:0x2835 };
const DOT_SEP = 0x2832; // looks like a dot separator
function sixDot(text) {
  return [...text.toLowerCase()].map((c) =>
    c === "." ? String.fromCodePoint(DOT_SEP)
    : c === " " ? " "
    : SIX_DOT[c] ? String.fromCodePoint(SIX_DOT[c]) : c).join("");
}
// 8-dot: one byte per cell, bijective (cell = U+2800 + byte).
function eightDot(buf) {
  return Array.from(buf, (b) => String.fromCodePoint(BASE_CP + b)).join("");
}

// ---- BIFM-256: pack (kappa,sigma,delta) into one byte -> one 8-dot cell -------
const KAPPA = ["trivial","minor","moderate","notable","significant","major","sweeping","monumental"];
const SIGMA = ["static","calm","steady","active","brisk","turbulent","volatile","explosive"];
const DELTA = ["fresh","recent","drifting","dormant"];

function bifm256(meta) {
  const now = Date.now();
  const days = (d) => (d ? (now - new Date(d).getTime()) / 86400000 : 9999);
  const commits = meta?.commits || 0;
  const ageW = Math.max(1, days(meta?.createdAt) / 7);
  const idle = days(meta?.pushedAt);

  const kappa = Math.min(7, Math.floor(Math.log2(commits + 1)));          // 3 bits
  const sigma = Math.min(7, Math.round(commits / ageW));                  // 3 bits
  const delta = idle < 30 ? 0 : idle < 90 ? 1 : idle < 180 ? 2 : 3;        // 2 bits
  const byte = (kappa << 5) | (sigma << 2) | delta;
  return {
    kappa, sigma, delta, byte,
    cell: String.fromCodePoint(BASE_CP + byte),
    words: `${KAPPA[kappa]} change, ${SIGMA[sigma]} volatility, ${DELTA[delta]} drift`,
  };
}

// ---- artifact + commit message ----------------------------------------------
function constellation(nodes, selfName) {
  const rows = nodes.map((n) =>
    `| [${n.name}](https://github.com/${OWNER}/${n.name})${n.isFork ? " ⑂" : ""} | ${n.language || "—"} | ` +
    `${(n.commits ?? 0).toLocaleString()} | ${n.createdAt || "—"} | ${n.pushedAt || "—"} | ` +
    `\`${n.bifm.cell}\` κ${n.bifm.kappa} σ${n.bifm.sigma} δ${n.bifm.delta} |`);

  // global 8-dot manifest = sha256 over the federated index (16 bytes -> 16 cells)
  const digest = createHash("sha256")
    .update(nodes.map((n) => `${n.name}:${n.commits}:${n.bifm.byte}`).join("|")).digest();
  const manifest = eightDot(digest.subarray(0, 16));

  return [
    "# ⠿ elevate-foundry constellation",
    "",
    `Federated index of **${nodes.length}** repositories, fused under one manifest. ` +
      "Each node carries a **BIFM-256** fingerprint — a single 8-dot braille cell " +
      "(`cell = U+2800 + byte`) packing change magnitude (κ), volatility (σ) and drift (δ).",
    "",
    `> This node: **${selfName}**`,
    "",
    "| Repo | Lang | Commits | Created | Last push | BIFM-256 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "## 8-dot manifest",
    "",
    "Lossless 8-dot braille digest (SHA-256/128) of the constellation index:",
    "",
    "```",
    manifest,
    "```",
    "",
    `_Generated ${new Date().toISOString().slice(0, 10)} · part of [${OWNER}](https://github.com/${OWNER})._`,
    "",
  ].join("\n");
}

function commitMessage(self) {
  const b = self.bifm;
  const header = sixDot("feat.fusion.constellation");
  const digestCell = eightDot(
    createHash("sha256").update(`${self.name}:${self.commits}`).digest().subarray(0, 12),
  );
  return [
    header,
    "",
    "SCL: feature: fusion: constellation",
    `BIFM-256: ${b.cell} (κ=${b.kappa} σ=${b.sigma} δ=${b.delta}) ${b.words}`,
    `NODE-256: ${digestCell}`,
    "",
    "Fused this repository into the elevate-foundry constellation:",
    "- Added CONSTELLATION.md: federated index of every repo",
    "- BIFM-256 fingerprint: change-state packed into one 8-dot braille byte",
    "- 8-dot manifest: lossless SHA-256/128 digest of the index",
    "- Linguistic 6-dot header, data-bearing 8-dot body",
    "",
    "The being speaks 8-dot braille.",
  ].join("\n");
}

function main() {
  const meta = readJSON(join(DATA, "repo-meta.json"))?.repos || {};
  const list = JSON.parse(
    gh(["repo", "list", OWNER, "--visibility", "public", "--limit", "1000", "--json", "name,isFork"]),
  ).sort((a, b) => a.name.localeCompare(b.name));

  const nodes = list.map((r) => {
    const m = meta[r.name] || {};
    return {
      name: r.name, isFork: r.isFork,
      language: m.language, commits: m.commits,
      createdAt: m.createdAt ? m.createdAt.slice(0, 10) : null,
      pushedAt: m.pushedAt ? m.pushedAt.slice(0, 10) : null,
      bifm: bifm256(m),
    };
  });

  const targets = nodes.filter((n) => INCLUDE_FORKS || !n.isFork);
  const previewDir = join(DATA, "fusion-preview");
  mkdirSync(previewDir, { recursive: true });

  console.log(`\n${APPLY ? "APPLY" : "DRY RUN"} — ${targets.length} target repos (forks ${INCLUDE_FORKS ? "included" : "excluded"})\n`);

  const built = targets.map((self) => {
    const md = constellation(nodes, self.name);
    const msg = commitMessage(self);
    mkdirSync(join(previewDir, self.name), { recursive: true });
    writeFileSync(join(previewDir, self.name, "CONSTELLATION.md"), md);
    writeFileSync(join(previewDir, self.name, "COMMIT_MSG.txt"), msg);
    console.log(`  ${self.bifm.cell}  ${self.name.padEnd(30)} κ${self.bifm.kappa} σ${self.bifm.sigma} δ${self.bifm.delta}  byte=${self.bifm.byte}`);
    return { self, md, msg };
  });
  console.log(`\n  previews -> dashboard/data/fusion-preview/<repo>/{CONSTELLATION.md,COMMIT_MSG.txt}`);

  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to open PRs.");
    return;
  }

  const opened = [];
  for (const { self, md, msg } of built) {
    try {
      const base = gh(["api", `repos/${OWNER}/${self.name}`, "-q", ".default_branch"]).trim();
      const baseSha = gh(["api", `repos/${OWNER}/${self.name}/git/ref/heads/${base}`, "-q", ".object.sha"]).trim();
      try {
        gh(["api", "-X", "POST", `repos/${OWNER}/${self.name}/git/refs`,
          "-f", `ref=refs/heads/${BRANCH}`, "-f", `sha=${baseSha}`],
          { stdio: ["pipe", "pipe", "ignore"] });
      } catch { /* branch exists */ }
      // does CONSTELLATION.md already exist on the branch? need its sha to update.
      let sha = null;
      try {
        sha = JSON.parse(gh(["api", `repos/${OWNER}/${self.name}/contents/CONSTELLATION.md?ref=${BRANCH}`],
          { stdio: ["pipe", "pipe", "ignore"] })).sha;
      } catch { /* new file */ }
      const args = ["api", "-X", "PUT", `repos/${OWNER}/${self.name}/contents/CONSTELLATION.md`,
        "-f", `message=${msg}`, "-f", `content=${Buffer.from(md, "utf8").toString("base64")}`,
        "-f", `branch=${BRANCH}`];
      if (sha) args.push("-f", `sha=${sha}`);
      gh(args, { stdio: ["pipe", "pipe", "ignore"] });
      const url = gh(["pr", "create", "--repo", `${OWNER}/${self.name}`, "--head", BRANCH, "--base", base,
        "--title", "feat: fuse into elevate-foundry constellation (BIFM-256)",
        "--body", "Adds CONSTELLATION.md (federated index) with a BIFM-256 8-dot braille commit fingerprint. Generated by tools/fuse-repos.mjs."]).trim();
      opened.push(url);
      console.log(`  ✓ ${self.name} -> ${url}`);
    } catch (e) {
      console.log(`  ✗ ${self.name}: ${String(e.message).split("\n")[0]}`);
    }
  }
  console.log(`\nopened ${opened.length} PR(s).`);
}

main();
