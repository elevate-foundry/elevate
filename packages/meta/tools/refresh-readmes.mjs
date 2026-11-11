#!/usr/bin/env node
// refresh-readmes.mjs - add/update a consistent, auto-generated section in each
// native repo's README and open one PR per repo.
//
// The section lives between idempotent markers so re-running updates in place
// rather than duplicating. Content is derived from data we already have
// (dashboard/data/repo-meta.json, pages.json) plus the repo description.
//
//   node tools/refresh-readmes.mjs            # DRY RUN: preview only, no pushes/PRs
//   node tools/refresh-readmes.mjs --apply    # actually branch/commit/push/PR
//   INCLUDE_FORKS=1 ... --apply               # also touch fork repos (off by default)
//
// Needs `gh` authenticated with write access to the repos.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "dashboard", "data");
const OWNER = process.env.EXPOSURE_OWNER || "elevate-foundry";
const APPLY = process.argv.includes("--apply");
const INCLUDE_FORKS = process.env.INCLUDE_FORKS === "1";
const BRANCH = "chore/refresh-readme";
const BEGIN = "<!-- ELEVATE:BEGIN (auto-generated section; edits here are overwritten) -->";
const END = "<!-- ELEVATE:END -->";

function gh(args, opts = {}) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
}
function readJSON(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

function buildSection(repo, meta, pages, description) {
  const rows = [
    ["Description", description || "_(no description set)_"],
    ["Language", meta?.language || "—"],
    ["Commits", meta?.commits != null ? meta.commits.toLocaleString() : "—"],
    ["Created", meta?.createdAt ? meta.createdAt.slice(0, 10) : "—"],
    ["Last push", meta?.pushedAt ? meta.pushedAt.slice(0, 10) : "—"],
  ];
  if (pages?.pagesEnabled && pages.liveUrl) rows.push(["Site", pages.liveUrl]);
  const table = rows.map(([k, v]) => `| **${k}** | ${v} |`).join("\n");
  return [
    BEGIN,
    "## About",
    "",
    "| | |",
    "| --- | --- |",
    table,
    "",
    `Part of [**${OWNER}**](https://github.com/${OWNER}) · ` +
      `[repository](https://github.com/${OWNER}/${repo})`,
    END,
  ].join("\n");
}

// Insert/replace the managed block; returns {content, action}.
function inject(existing, section, repo) {
  if (existing == null) {
    return { content: `# ${repo}\n\n${section}\n`, action: "create" };
  }
  const re = new RegExp(`${escapeRe(BEGIN)}[\\s\\S]*?${escapeRe(END)}`);
  if (re.test(existing)) {
    return { content: existing.replace(re, section), action: "update" };
  }
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  return { content: `${existing}${sep}${section}\n`, action: "append" };
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getReadme(repo) {
  try {
    const j = JSON.parse(gh(["api", `repos/${OWNER}/${repo}/readme`], { stdio: ["pipe", "pipe", "ignore"] }));
    return { path: j.path, content: Buffer.from(j.content, "base64").toString("utf8"), sha: j.sha };
  } catch {
    return null; // no README
  }
}

function main() {
  const meta = readJSON(join(DATA, "repo-meta.json"))?.repos || {};
  const pagesArr = readJSON(join(DATA, "pages.json"))?.pages || [];
  const pagesByRepo = Object.fromEntries(pagesArr.map((p) => [p.name, p]));

  const repos = JSON.parse(
    gh(["repo", "list", OWNER, "--visibility", "public", "--limit", "1000", "--json", "name,isFork,description"]),
  ).sort((a, b) => a.name.localeCompare(b.name));

  const previewDir = join(__dirname, "..", "dashboard", "data", "readme-preview");
  mkdirSync(previewDir, { recursive: true });

  const plan = [];
  for (const r of repos) {
    if (r.isFork && !INCLUDE_FORKS) continue;
    const section = buildSection(r.name, meta[r.name], pagesByRepo[r.name], r.description);
    const readme = getReadme(r.name);
    const { content, action } = inject(readme?.content ?? null, section, r.name);
    const changed = !readme || readme.content !== content;
    writeFileSync(join(previewDir, `${r.name}.md`), content);
    plan.push({
      repo: r.name, action, changed,
      path: readme?.path || "README.md", content, sha: readme?.sha || null,
    });
  }

  console.log(`\n${APPLY ? "APPLY" : "DRY RUN"} — ${plan.length} native repos (forks ${INCLUDE_FORKS ? "included" : "excluded"})\n`);
  for (const p of plan) {
    console.log(`  ${p.changed ? (p.action === "create" ? "＋create" : p.action === "update" ? "↻update" : "≫append") : "·nochange"}  ${p.repo}`);
  }
  console.log(`\n  previews written to dashboard/data/readme-preview/*.md`);

  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to open PRs.");
    return;
  }

  // Commit + PR entirely via the GitHub API (no clone -> no large downloads).
  const TITLE = "docs: refresh standardized README section";
  const BODY =
    "Auto-generated consistent About section (description, language, commits, dates, site link). " +
    "Idempotent between the ELEVATE markers.";
  const opened = [];
  for (const p of plan.filter((x) => x.changed)) {
    try {
      const base = gh(["api", `repos/${OWNER}/${p.repo}`, "-q", ".default_branch"]).trim();
      const baseSha = gh(["api", `repos/${OWNER}/${p.repo}/git/ref/heads/${base}`, "-q", ".object.sha"]).trim();
      // create the branch (ignore if it already exists)
      try {
        gh(["api", "-X", "POST", `repos/${OWNER}/${p.repo}/git/refs`,
          "-f", `ref=refs/heads/${BRANCH}`, "-f", `sha=${baseSha}`],
          { stdio: ["pipe", "pipe", "ignore"] });
      } catch { /* ref exists */ }
      // PUT the README on the branch
      const b64 = Buffer.from(p.content, "utf8").toString("base64");
      const args = ["api", "-X", "PUT", `repos/${OWNER}/${p.repo}/contents/${p.path}`,
        "-f", `message=${TITLE}`, "-f", `content=${b64}`, "-f", `branch=${BRANCH}`];
      if (p.sha) args.push("-f", `sha=${p.sha}`);
      gh(args, { stdio: ["pipe", "pipe", "ignore"] });
      // open the PR
      const url = gh(["pr", "create", "--repo", `${OWNER}/${p.repo}`,
        "--head", BRANCH, "--base", base, "--title", TITLE, "--body", BODY]).trim();
      opened.push(`${p.repo}: ${url}`);
      console.log(`  ✓ ${p.repo} -> ${url}`);
    } catch (e) {
      console.log(`  ✗ ${p.repo}: ${String(e.message).split("\n")[0]}`);
    }
  }
  console.log(`\nopened ${opened.length} PR(s).`);
}

main();
