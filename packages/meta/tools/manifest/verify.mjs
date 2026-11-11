#!/usr/bin/env node
// verify.mjs - verify a BIFM-MANIFEST/1.0 document (integrity + signature).
//   node tools/manifest/verify.mjs <path-to-MANIFEST.json> [...more]
// Exits non-zero if any manifest fails.

import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { readFileSync } from "node:fs";

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

let failed = 0;
for (const path of process.argv.slice(2)) {
  const doc = JSON.parse(readFileSync(path, "utf8"));
  const { digest, signature, publicKey, ...verifRest } = doc.verification;
  const payloadDoc = { ...doc, verification: { ...verifRest, publicKey } };
  const payload = canonical(payloadDoc);

  const wantDigest = createHash("sha256").update(payload).digest("hex");
  const key = createPublicKey({
    key: Buffer.from(publicKey, "base64"), format: "der", type: "spki",
  });
  const sigOk = edVerify(null, Buffer.from(payload), key, Buffer.from(signature, "base64"));
  const digestOk = wantDigest === digest;

  const cell = doc.state?.bifm256?.cell ?? "?";
  if (digestOk && sigOk) {
    console.log(`OK   ${cell}  ${doc.repo}  (digest + ed25519 signature verified)`);
  } else {
    failed++;
    console.error(`FAIL ${cell}  ${doc.repo}  digest=${digestOk} signature=${sigOk}`);
  }
}
process.exit(failed ? 1 : 0);
