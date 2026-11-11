#!/usr/bin/env node
// fetch-meta.mjs - pull per-repo commit counts + dates from GitHub and write a
// committed data/repo-meta.json that ingest.mjs merges into the snapshot.
//
// Run locally (needs `gh` authenticated):  node scripts/fetch-meta.mjs
// Output is committed so the Vercel build doesn't need network/gh access.

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const OWNER = process.env.EXPOSURE_OWNER || "elevate-foundry";

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// commit count via the commits API: with per_page=1 the Link rel="last" page
// number equals the total number of commits on the default branch.
function commitCount(repo) {
  let out;
  try {
    out = gh(["api", "-i", `repos/${OWNER}/${repo}/commits?per_page=1`]);
  } catch {
    return 0; // empty repo / error
  }
  const link = (out.split("\n").find((l) => /^link:/i.test(l)) || "").trim();
  const m = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
  if (m) return Number(m[1]);
  // no pagination => 0 or 1 commits; count the returned array
  try {
    const body = out.slice(out.indexOf("\n\n") + 2);
    const arr = JSON.parse(body.trim() || "[]");
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

function main() {
  const list = JSON.parse(
    gh([
      "repo", "list", OWNER,
      "--visibility", "public", "--limit", "1000",
      "--json", "name,createdAt,pushedAt,updatedAt,isFork,primaryLanguage,stargazerCount,forkCount,diskUsage",
    ]),
  );

  const meta = {};
  let done = 0;
  for (const r of list.sort((a, b) => a.name.localeCompare(b.name))) {
    const commits = commitCount(r.name);
    meta[r.name] = {
      commits,
      createdAt: r.createdAt || null,
      pushedAt: r.pushedAt || null,
      updatedAt: r.updatedAt || null,
      isFork: !!r.isFork,
      language: r.primaryLanguage?.name || null,
      diskKB: r.diskUsage ?? null,
    };
    done++;
    process.stdout.write(`\r  fetched ${done}/${list.length}  (${r.name})${" ".repeat(20)}`);
  }
  process.stdout.write("\n");

  mkdirSync(DATA_DIR, { recursive: true });
  const payload = { generatedAt: new Date().toISOString(), owner: OWNER, repos: meta };
  writeFileSync(join(DATA_DIR, "repo-meta.json"), JSON.stringify(payload, null, 2));

  const total = Object.values(meta).reduce((a, m) => a + m.commits, 0);
  const native = Object.values(meta)
    .filter((m) => !m.isFork)
    .reduce((a, m) => a + m.commits, 0);
  console.log(`fetch-meta: ${Object.keys(meta).length} repos, ${total} commits total (${native} native) -> data/repo-meta.json`);
}

main();
