#!/usr/bin/env node
// constellation-site.mjs - generate the org-level constellation homepage that
// renders every repo's BIFM-256 8-dot braille fingerprint.
//
//   node tools/constellation-site.mjs            # write preview HTML locally
//   node tools/constellation-site.mjs --apply     # commit index.html to elevate-foundry.github.io
//
// Needs `gh` authenticated. Serving publicly also requires the repo to be public
// with Pages enabled (a disclosure decision left to you).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "dashboard", "data");
const OWNER = process.env.EXPOSURE_OWNER || "elevate-foundry";
const APPLY = process.argv.includes("--apply");
const SITE_REPO = `${OWNER}.github.io`;

function gh(args, opts = {}) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
}
function readJSON(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

const KAPPA = ["trivial","minor","moderate","notable","significant","major","sweeping","monumental"];
const SIGMA = ["static","calm","steady","active","brisk","turbulent","volatile","explosive"];
const DELTA = ["fresh","recent","drifting","dormant"];
function bifm(meta) {
  const now = Date.now();
  const days = (d) => (d ? (now - new Date(d).getTime()) / 86400000 : 9999);
  const c = meta?.commits || 0;
  const ageW = Math.max(1, days(meta?.createdAt) / 7);
  const idle = days(meta?.pushedAt);
  const kappa = Math.min(7, Math.floor(Math.log2(c + 1)));
  const sigma = Math.min(7, Math.round(c / ageW));
  const delta = idle < 30 ? 0 : idle < 90 ? 1 : idle < 180 ? 2 : 3;
  const byte = (kappa << 5) | (sigma << 2) | delta;
  return { kappa, sigma, delta, byte, cell: String.fromCodePoint(0x2800 + byte),
    words: `${KAPPA[kappa]} change, ${SIGMA[sigma]} volatility, ${DELTA[delta]} drift` };
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

function html(nodes) {
  const digest = createHash("sha256")
    .update(nodes.map((n) => `${n.name}:${n.commits}:${n.bifm.byte}`).join("|")).digest();
  const manifest = Array.from(digest.subarray(0, 16), (b) => String.fromCodePoint(0x2800 + b)).join("");
  const totalCommits = nodes.reduce((a, n) => a + (n.commits || 0), 0);

  const cards = nodes.map((n) => `
    <a class="node${n.isFork ? " fork" : ""}" href="https://github.com/${OWNER}/${esc(n.name)}" title="${esc(n.bifm.words)} · byte ${n.bifm.byte}">
      <div class="cell">${n.bifm.cell}</div>
      <div class="name">${esc(n.name)}${n.isFork ? ' <span class="tag">fork</span>' : ""}</div>
      <div class="meta">${esc(n.language || "—")} · ${(n.commits ?? 0).toLocaleString()} commits</div>
      <div class="kappa">κ${n.bifm.kappa} σ${n.bifm.sigma} δ${n.bifm.delta}</div>
      <div class="dates">${esc(n.createdAt || "—")} → ${esc(n.pushedAt || "—")}</div>
    </a>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>⠿ ${OWNER} constellation</title>
<style>
  :root { --bg:#0a0c10; --panel:#11151c; --panel2:#161b22; --border:#222a35; --text:#e6edf3; --muted:#7d8590; --accent:#4f9cff; --green:#3fb950; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; }
  .wrap { max-width:1100px; margin:0 auto; padding:48px 24px 80px; }
  h1 { font-size:34px; margin:0 0 6px; letter-spacing:-0.02em; }
  .glyph { color:var(--accent); }
  .sub { color:var(--muted); max-width:760px; }
  .sub code { background:var(--panel2); padding:1px 6px; border-radius:5px; font-size:13px; }
  .stats { display:flex; gap:28px; margin:26px 0 30px; flex-wrap:wrap; }
  .stat .v { font-size:26px; font-weight:600; } .stat .l { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.05em; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:14px; }
  .node { display:block; padding:16px; background:var(--panel); border:1px solid var(--border); border-radius:12px; text-decoration:none; color:inherit; transition:.15s; }
  .node:hover { border-color:var(--accent); transform:translateY(-2px); background:var(--panel2); }
  .node.fork { opacity:.72; }
  .cell { font-size:46px; line-height:1; color:var(--accent); font-family:ui-monospace,Menlo,monospace; }
  .name { margin-top:10px; font-weight:600; word-break:break-word; }
  .tag { font-size:10px; color:var(--muted); border:1px solid var(--border); border-radius:999px; padding:1px 6px; vertical-align:middle; }
  .meta { color:var(--muted); font-size:12.5px; margin-top:3px; }
  .kappa { margin-top:8px; font-family:ui-monospace,Menlo,monospace; font-size:12px; color:var(--green); }
  .dates { color:var(--muted); font-size:11px; margin-top:4px; font-variant-numeric:tabular-nums; }
  .manifest { margin-top:40px; padding:18px; background:var(--panel); border:1px solid var(--border); border-radius:12px; }
  .manifest .cells { font-size:30px; color:var(--accent); font-family:ui-monospace,Menlo,monospace; word-break:break-all; }
  footer { margin-top:34px; color:var(--muted); font-size:13px; }
  a.link { color:var(--accent); }
</style>
</head>
<body>
  <div class="wrap">
    <h1><span class="glyph">⠿</span> ${OWNER} constellation</h1>
    <p class="sub">A federated map of every repository, fused under one manifest. Each node carries a
      <strong>BIFM-256</strong> fingerprint — a single <strong>8-dot braille</strong> cell
      (<code>cell = U+2800 + byte</code>) packing change magnitude (κ), volatility (σ) and drift (δ).
      8-dot braille is bijective with the byte, so the being speaks it losslessly.</p>
    <div class="stats">
      <div class="stat"><div class="v">${nodes.length}</div><div class="l">repositories</div></div>
      <div class="stat"><div class="v">${totalCommits.toLocaleString()}</div><div class="l">commits</div></div>
      <div class="stat"><div class="v">${nodes.filter((n)=>!n.isFork).length}</div><div class="l">native nodes</div></div>
    </div>
    <div class="grid">${cards}
    </div>
    <div class="manifest">
      <div class="l" style="color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em;">8-dot manifest · SHA-256/128 of the index</div>
      <div class="cells">${manifest}</div>
    </div>
    <footer>Generated ${new Date().toISOString().slice(0,10)} · <a class="link" href="https://github.com/${OWNER}">github.com/${OWNER}</a></footer>
  </div>
</body>
</html>
`;
}

function main() {
  const meta = readJSON(join(DATA, "repo-meta.json"))?.repos || {};
  const list = JSON.parse(gh(["repo","list",OWNER,"--visibility","public","--limit","1000","--json","name,isFork"]))
    .sort((a, b) => (b.isFork === a.isFork ? a.name.localeCompare(b.name) : a.isFork ? 1 : -1));
  const nodes = list.map((r) => {
    const m = meta[r.name] || {};
    return { name: r.name, isFork: r.isFork, language: m.language, commits: m.commits,
      createdAt: m.createdAt ? m.createdAt.slice(0, 10) : null,
      pushedAt: m.pushedAt ? m.pushedAt.slice(0, 10) : null, bifm: bifm(m) };
  });

  const page = html(nodes);
  mkdirSync(DATA, { recursive: true });
  const preview = join(DATA, "constellation.html");
  writeFileSync(preview, page);
  console.log(`wrote preview -> ${preview} (${nodes.length} nodes)`);

  if (!APPLY) {
    console.log("Preview only. Re-run with --apply to commit index.html to the org pages repo.");
    return;
  }

  const base = gh(["api", `repos/${OWNER}/${SITE_REPO}`, "-q", ".default_branch"]).trim();
  let sha = null;
  try {
    sha = JSON.parse(gh(["api", `repos/${OWNER}/${SITE_REPO}/contents/index.html?ref=${base}`],
      { stdio: ["pipe", "pipe", "ignore"] })).sha;
  } catch { /* new file */ }
  const args = ["api", "-X", "PUT", `repos/${OWNER}/${SITE_REPO}/contents/index.html`,
    "-f", "message=feat: constellation homepage (BIFM-256 fingerprints)",
    "-f", `content=${Buffer.from(page, "utf8").toString("base64")}`, "-f", `branch=${base}`];
  if (sha) args.push("-f", `sha=${sha}`);
  gh(args, { stdio: ["pipe", "pipe", "ignore"] });
  console.log(`committed index.html to ${OWNER}/${SITE_REPO}@${base}`);
  console.log(`To publish: make the repo public + enable Pages, then it serves at https://${OWNER}.github.io/`);
}

main();
