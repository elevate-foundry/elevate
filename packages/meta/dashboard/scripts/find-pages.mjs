#!/usr/bin/env node
// find-pages.mjs - locate GitHub Pages across an owner's repos.
//
// Combines two views:
//   1. AUTHORITATIVE  - the GitHub Pages API (repos/:o/:r/pages) + gh-pages branch.
//   2. CODE SIGNALS   - indexes the local clones (corpus-builder/repos) for the
//      files that imply a site is *expected*: index.html (root or docs/), CNAME,
//      _config.yml (Jekyll), and Pages deploy workflows.
//
// Writes data/pages.json and prints a table. Needs `gh` authenticated.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const OWNER = process.env.EXPOSURE_OWNER || "elevate-foundry";
const REPOS_DIR =
  process.env.REPOS_DIR || join(__dirname, "..", "..", "corpus-builder", "repos");

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// gh api that returns null on 404 instead of throwing.
function ghJSON(path) {
  try {
    return JSON.parse(gh(["api", path, "-H", "Accept: application/vnd.github+json"]));
  } catch {
    return null;
  }
}

function ghStatus(path) {
  try {
    gh(["api", path, "--silent"]);
    return true;
  } catch {
    return false;
  }
}

function expectedUrl(name, cname) {
  if (cname) return `https://${cname}/`;
  if (name.toLowerCase() === `${OWNER.toLowerCase()}.github.io`) return `https://${OWNER}.github.io/`;
  return `https://${OWNER}.github.io/${name}/`;
}

// Index a local clone for Pages-implying files.
function codeSignals(name) {
  const root = join(REPOS_DIR, name);
  if (!existsSync(root)) return { cloned: false, signals: [] };
  const signals = [];
  const has = (p) => existsSync(join(root, p));
  if (has("index.html")) signals.push("index.html");
  if (has("docs/index.html")) signals.push("docs/index.html");
  else if (has("docs") && safeIsDir(join(root, "docs"))) signals.push("docs/");
  if (has("CNAME")) signals.push(`CNAME=${readFileSync(join(root, "CNAME"), "utf8").trim()}`);
  if (has("_config.yml")) signals.push("_config.yml(jekyll)");
  // Pages deploy workflow
  const wf = join(root, ".github", "workflows");
  if (existsSync(wf)) {
    for (const f of readdirSync(wf)) {
      if (!/\.ya?ml$/.test(f)) continue;
      const txt = safeRead(join(wf, f));
      if (txt && /(actions\/deploy-pages|peaceiris\/actions-gh-pages|gh-pages|pages:\s)/i.test(txt)) {
        signals.push(`workflow:${f}`);
      }
    }
  }
  return { cloned: true, signals };
}

function safeRead(p) {
  try { return readFileSync(p, "utf8"); } catch { return null; }
}
function safeIsDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function main() {
  const repos = JSON.parse(
    gh(["repo", "list", OWNER, "--visibility", "public", "--limit", "1000", "--json", "name,isFork"]),
  ).sort((a, b) => a.name.localeCompare(b.name));

  const rows = [];
  let i = 0;
  for (const r of repos) {
    const pages = ghJSON(`repos/${OWNER}/${r.name}/pages`); // null if not enabled
    const ghPagesBranch = ghStatus(`repos/${OWNER}/${r.name}/branches/gh-pages`);
    const code = codeSignals(r.name);
    const cname = pages?.cname || null;
    const enabled = !!pages;
    rows.push({
      name: r.name,
      isFork: r.isFork,
      pagesEnabled: enabled,
      status: pages?.status || null,
      liveUrl: pages?.html_url || null,
      sourceBranch: pages?.source?.branch || (ghPagesBranch ? "gh-pages" : null),
      sourcePath: pages?.source?.path || null,
      buildType: pages?.build_type || null,
      ghPagesBranch,
      cname,
      expectedUrl: expectedUrl(r.name, cname),
      codeSignals: code.signals,
      cloned: code.cloned,
      // "expected" = code/branch implies a site even if Pages API is off
      expected: enabled || ghPagesBranch || code.signals.length > 0,
    });
    process.stdout.write(`\r  scanned ${++i}/${repos.length} (${r.name})${" ".repeat(24)}`);
  }
  process.stdout.write("\n");

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(
    join(DATA_DIR, "pages.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), owner: OWNER, pages: rows }, null, 2),
  );

  const live = rows.filter((r) => r.pagesEnabled);
  const expectedOnly = rows.filter((r) => !r.pagesEnabled && r.expected);

  const cell = (s, w) => String(s ?? "—").padEnd(w);
  console.log(`\nGitHub Pages — LIVE (Pages API enabled): ${live.length}`);
  console.log("  " + cell("repo", 30) + cell("status", 10) + cell("source", 16) + "url");
  console.log("  " + "-".repeat(86));
  for (const r of live) {
    console.log(
      "  " + cell(r.name, 30) + cell(r.status, 10) +
      cell(`${r.sourceBranch || "?"}${r.sourcePath ? ":" + r.sourcePath : ""}`, 16) +
      (r.liveUrl || r.expectedUrl),
    );
  }

  console.log(`\nEXPECTED but Pages API not enabled: ${expectedOnly.length}`);
  console.log("  " + cell("repo", 30) + cell("expected url", 42) + "signals");
  console.log("  " + "-".repeat(96));
  for (const r of expectedOnly) {
    console.log(
      "  " + cell(r.name, 30) + cell(r.expectedUrl, 42) +
      [r.ghPagesBranch ? "gh-pages-branch" : null, ...r.codeSignals].filter(Boolean).join(", "),
    );
  }

  console.log(`\nwrote ${rows.length} repos -> data/pages.json`);
}

main();
