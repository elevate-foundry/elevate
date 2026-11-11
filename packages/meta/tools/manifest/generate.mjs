#!/usr/bin/env node
// generate.mjs - build and sign BIFM-MANIFEST/1.0 documents for all native repos.
//
//   node tools/manifest/generate.mjs            # write manifests to tools/manifest/out/
//   node tools/manifest/generate.mjs --apply    # also commit MANIFEST.json to each repo
//
// Keys: Ed25519 pair in tools/manifest/keys/ (private key gitignored, generated
// on first run). Public key is embedded in every manifest.

import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign as edSign } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const OUT = join(__dirname, "out");
const KEYS = join(__dirname, "keys");
const OWNER = process.env.EXPOSURE_OWNER || "elevate-foundry";
const APPLY = process.argv.includes("--apply");
const BASE_CP = 0x2800;

// ---- keys -------------------------------------------------------------------
function loadOrCreateKeys() {
  mkdirSync(KEYS, { recursive: true });
  const privPath = join(KEYS, "manifest-ed25519.key");
  const pubPath = join(KEYS, "manifest-ed25519.pub");
  if (!existsSync(privPath)) {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    writeFileSync(privPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    writeFileSync(pubPath, publicKey.export({ type: "spki", format: "pem" }));
    const gi = join(KEYS, ".gitignore");
    if (!existsSync(gi)) writeFileSync(gi, "*.key\n");
    console.log("generated new Ed25519 keypair in tools/manifest/keys/");
  }
  return {
    priv: readFileSync(privPath, "utf8"),
    pubB64: readFileSync(pubPath, "utf8")
      .replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""),
  };
}

// ---- BIFM-256 (same packing as tools/fuse-repos.mjs) --------------------------
const KAPPA = ["trivial","minor","moderate","notable","significant","major","sweeping","monumental"];
const SIGMA = ["static","calm","steady","active","brisk","turbulent","volatile","explosive"];
const DELTA = ["fresh","recent","drifting","dormant"];

function bifm256(meta) {
  const now = Date.now();
  const days = (d) => (d ? (now - new Date(d).getTime()) / 86400000 : 9999);
  const commits = meta?.commits || 0;
  const ageW = Math.max(1, days(meta?.createdAt) / 7);
  const idle = days(meta?.pushedAt);
  const kappa = Math.min(7, Math.floor(Math.log2(commits + 1)));
  const sigma = Math.min(7, Math.round(commits / ageW));
  const delta = idle < 30 ? 0 : idle < 90 ? 1 : idle < 180 ? 2 : 3;
  const byte = (kappa << 5) | (sigma << 2) | delta;
  return {
    byte, cell: String.fromCodePoint(BASE_CP + byte),
    kappa, sigma, delta,
    words: `${KAPPA[kappa]} change, ${SIGMA[sigma]} volatility, ${DELTA[delta]} drift`,
  };
}

// ---- canonical JSON (sorted keys, no whitespace) ------------------------------
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

// ---- build -------------------------------------------------------------------
const meta = JSON.parse(readFileSync(join(ROOT, "dashboard", "data", "repo-meta.json"), "utf8"));
const native = Object.entries(meta.repos).filter(([, m]) => !m.isFork);
const peers = native.map(([name]) => name).sort();
const { priv, pubB64 } = loadOrCreateKeys();
mkdirSync(OUT, { recursive: true });

const manifests = [];
for (const [name, m] of native) {
  const doc = {
    spec: "BIFM-MANIFEST/1.0",
    repo: name,
    owner: OWNER,
    generatedAt: new Date().toISOString(),
    topology: {
      org: `https://github.com/${OWNER}`,
      index: "CONSTELLATION.md",
      peers: peers.filter((p) => p !== name),
    },
    state: {
      commits: m.commits ?? 0,
      createdAt: m.createdAt ?? null,
      pushedAt: m.pushedAt ?? null,
      language: m.language ?? null,
      bifm256: bifm256(m),
    },
    terms: {
      license: "see LICENSE",
      aiTraining: "contact-required",
      attribution: "required",
      contact: `https://github.com/${OWNER}`,
    },
    verification: { algorithm: "ed25519", publicKey: pubB64 },
  };
  const payload = canonical(doc);
  doc.verification.digest = createHash("sha256").update(payload).digest("hex");
  doc.verification.signature = edSign(null, Buffer.from(payload), priv).toString("base64");
  writeFileSync(join(OUT, `${name}.MANIFEST.json`), JSON.stringify(doc, null, 2) + "\n");
  manifests.push({ name, cell: doc.state.bifm256.cell, digest: doc.verification.digest.slice(0, 12) });
}

console.log(`wrote ${manifests.length} signed manifests to tools/manifest/out/`);
for (const m of manifests) console.log(`  ${m.cell}  ${m.name}  sha256:${m.digest}…`);

// ---- apply: commit MANIFEST.json to each repo via Contents API ----------------
if (APPLY) {
  for (const { name } of manifests) {
    const content = readFileSync(join(OUT, `${name}.MANIFEST.json`));
    const b64 = content.toString("base64");
    let sha = null;
    try {
      sha = JSON.parse(execFileSync("gh", ["api", `repos/${OWNER}/${name}/contents/MANIFEST.json`], { encoding: "utf8" })).sha;
    } catch {}
    const args = ["api", "-X", "PUT", `repos/${OWNER}/${name}/contents/MANIFEST.json`,
      "-f", "message=feat: add signed BIFM-MANIFEST/1.0", "-f", `content=${b64}`];
    if (sha) args.push("-f", `sha=${sha}`);
    try {
      execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
      console.log(`pushed MANIFEST.json -> ${name}`);
    } catch (err) {
      console.error(`FAILED ${name}: ${err.message.split("\n")[0]}`);
    }
  }
}
