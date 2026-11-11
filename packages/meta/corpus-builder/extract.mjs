#!/usr/bin/env node
// extract.mjs - turn the cloned repos into an LLM training corpus.
//
// Walks corpus-builder/repos/<repo>/, keeps real source/text files (allowlist of
// extensions), drops binaries / vendored deps / lockfiles / build output / data
// blobs, deduplicates by content hash, and writes:
//   out/corpus.jsonl   one record per file: {repo, path, lang, text, sha256, bytes}
//   out/stats.json     totals, per-language + per-repo breakdown, token estimate
//
// No external dependencies. Token estimate is bytes/4 (a standard rough heuristic);
// pass an exact tokenizer later if needed.

import { createHash } from "node:crypto";
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  existsSync,
} from "node:fs";
import { join, extname, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPOS_DIR = process.env.REPOS_DIR || join(__dirname, "repos");
const OUT_DIR = process.env.OUT_DIR || join(__dirname, "out");
const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES || 512 * 1024); // 512 KB/file

// Extensions we treat as training-worthy text.
const ALLOW_EXT = new Set([
  ".py", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".rs", ".go", ".java",
  ".c", ".h", ".cc", ".cpp", ".hpp", ".rb", ".php", ".swift", ".kt", ".scala",
  ".sh", ".bash", ".zsh", ".sql", ".css", ".scss", ".html", ".vue", ".svelte",
  ".md", ".mdx", ".rst", ".txt", ".toml", ".yaml", ".yml", ".cfg", ".ini",
  ".dockerfile", ".tf", ".proto", ".graphql", ".lua", ".r", ".jl", ".ipynb",
]);

// Directory names that never contain org-authored source.
const DENY_DIR = new Set([
  ".git", "node_modules", "dist", "build", "out", ".next", ".nuxt", "target",
  "vendor", "venv", ".venv", "env", "__pycache__", ".mypy_cache", ".pytest_cache",
  "coverage", ".cache", ".turbo", ".idea", ".vscode", "site-packages",
  "third_party", "thirdparty", "deps", ".terraform", "bin", "obj",
]);

// Filenames to skip (lockfiles / minified / generated).
const DENY_FILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|go\.sum)$|\.min\.(js|css)$|\.map$/;

const LANG = {
  ".py": "Python", ".ipynb": "Jupyter", ".js": "JavaScript", ".mjs": "JavaScript",
  ".cjs": "JavaScript", ".jsx": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript",
  ".rs": "Rust", ".go": "Go", ".java": "Java", ".c": "C", ".h": "C", ".cc": "C++",
  ".cpp": "C++", ".hpp": "C++", ".rb": "Ruby", ".php": "PHP", ".sh": "Shell",
  ".bash": "Shell", ".zsh": "Shell", ".sql": "SQL", ".css": "CSS", ".scss": "CSS",
  ".html": "HTML", ".md": "Markdown", ".mdx": "Markdown", ".rst": "reST",
  ".txt": "Text", ".toml": "TOML", ".yaml": "YAML", ".yml": "YAML",
};

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true; // NUL byte => binary
  return false;
}

function walk(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (DENY_DIR.has(e.name)) continue;
      walk(full, acc);
    } else if (e.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

function run() {
  if (!existsSync(REPOS_DIR)) {
    console.error(`extract: no repos dir at ${REPOS_DIR} — run ./clone.sh first`);
    process.exit(1);
  }
  const repos = readdirSync(REPOS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  mkdirSync(OUT_DIR, { recursive: true });
  const corpusPath = join(OUT_DIR, "corpus.jsonl");
  const out = [];
  const seen = new Set();

  const stats = {
    generatedAt: new Date().toISOString(),
    repos: repos.length,
    files: 0,
    skippedBinary: 0,
    skippedLarge: 0,
    skippedDenied: 0,
    duplicates: 0,
    totalBytes: 0,
    byLang: {},
    byRepo: {},
  };

  for (const repo of repos) {
    const root = join(REPOS_DIR, repo);
    const files = walk(root, []);
    let repoBytes = 0;
    let repoFiles = 0;
    for (const f of files) {
      const rel = relative(root, f);
      const ext = extname(f).toLowerCase();
      if (DENY_FILE.test(rel)) { stats.skippedDenied++; continue; }
      const isDockerfile = /(^|\/)Dockerfile/i.test(rel);
      if (!ALLOW_EXT.has(ext) && !isDockerfile) { stats.skippedDenied++; continue; }

      let size;
      try { size = statSync(f).size; } catch { continue; }
      if (size > MAX_FILE_BYTES) { stats.skippedLarge++; continue; }

      let buf;
      try { buf = readFileSync(f); } catch { continue; }
      if (looksBinary(buf)) { stats.skippedBinary++; continue; }

      const text = buf.toString("utf8");
      const sha256 = createHash("sha256").update(buf).digest("hex");
      if (seen.has(sha256)) { stats.duplicates++; continue; }
      seen.add(sha256);

      const lang = LANG[ext] || (isDockerfile ? "Dockerfile" : ext.replace(".", "") || "other");
      out.push(JSON.stringify({ repo, path: rel, lang, bytes: size, sha256, text }));

      stats.files++; repoFiles++;
      stats.totalBytes += size; repoBytes += size;
      stats.byLang[lang] = (stats.byLang[lang] || 0) + size;
    }
    stats.byRepo[repo] = { files: repoFiles, bytes: repoBytes };
  }

  writeFileSync(corpusPath, out.join("\n") + (out.length ? "\n" : ""));
  stats.estTokens = Math.round(stats.totalBytes / 4);
  stats.estTokensHuman =
    stats.estTokens >= 1e6 ? (stats.estTokens / 1e6).toFixed(2) + "M" : String(stats.estTokens);
  writeFileSync(join(OUT_DIR, "stats.json"), JSON.stringify(stats, null, 2));

  const topLang = Object.entries(stats.byLang).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`extract: ${stats.files} files from ${stats.repos} repos`);
  console.log(`  bytes=${(stats.totalBytes / 1e6).toFixed(2)}MB  est_tokens≈${stats.estTokensHuman}`);
  console.log(`  skipped: binary=${stats.skippedBinary} large=${stats.skippedLarge} denied=${stats.skippedDenied} dupes=${stats.duplicates}`);
  console.log("  top languages (by bytes):");
  for (const [l, b] of topLang) console.log(`    ${l.padEnd(12)} ${(b / 1e6).toFixed(2)}MB`);
  console.log(`  -> ${corpusPath}`);
  console.log(`  -> ${join(OUT_DIR, "stats.json")}`);
}

run();
