import express from 'express';
import cors from 'cors';
import { graphqlHTTP } from 'express-graphql';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createWriteStream, mkdirSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import 'dotenv/config';
import { getAvailableProviders, getAllModels, callAnyModel } from './providers.js';
import { runHandshake, runBenchmark, runCrossModelMatrix, judgeFidelity, printSummary } from './benchmark.js';
import { ENCODER_SYSTEM_PROMPT, DECODER_SYSTEM_PROMPT, makeDecoderUserMessage } from './braille.js';
import { runAlignment } from './alignment.js';
import { runLatexRoundtrip } from './latex-experiment.js';
import { runBenchmarkSuite } from './benchmark-suite.js';
import { encodeSharedCodec, sharedCodecStats } from './shared-codec.js';
import { cerebrailleSchema } from './cerebraille-graphql.js';
import {
  decodeCerebraille,
  encodeCerebraille,
  frontierToolSchemas,
  getCerebrailleCodebook,
  lookupSymbol,
  trainingDescriptor
} from './cerebraille-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));
app.use('/graphql', graphqlHTTP({
  schema: cerebrailleSchema,
  graphiql: true
}));

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

// --- SOC 2 Compliant Audit Logger ---
// Append-only JSONL log. Never overwritten. One event per line.
// Fields follow SOC 2 Type II requirements:
//   - Unique event ID (uuid v4)
//   - ISO 8601 timestamp with timezone
//   - Actor identification (redacted API key fingerprint)
//   - Action performed
//   - Resource accessed
//   - Outcome (success/failure)
//   - Request/response metadata (no secrets)

const LOG_DIR = join(__dirname, '..', 'audit');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

function getLogFileName(): string {
  const d = new Date();
  return `audit-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}.jsonl`;
}

function openLogStream() {
  return createWriteStream(join(LOG_DIR, getLogFileName()), { flags: 'a' });
}

let currentLogDate = new Date().toISOString().slice(0, 10);
let logStream = openLogStream();

function rotateIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== currentLogDate) {
    logStream.end();
    currentLogDate = today;
    logStream = openLogStream();
  }
}

interface AuditEvent {
  event_id: string;
  timestamp: string;
  actor: {
    key_fingerprint: string; // last 8 chars of API key
    ip: string;
    user_agent: string;
  };
  action: string;
  resource: string;
  request: {
    method: string;
    path: string;
    body_summary: Record<string, any>;
  };
  response: {
    status_code: number;
    latency_ms: number;
    body_summary: Record<string, any>;
  };
  outcome: 'success' | 'failure' | 'error';
  error?: string;
  metadata?: Record<string, any>;
}

function redactKey(key?: string): string {
  if (!key) return 'none';
  if (key.length <= 8) return '****';
  return `****${key.slice(-8)}`;
}

function auditLog(event: AuditEvent) {
  rotateIfNeeded();
  const line = JSON.stringify(event) + '\n';
  logStream.write(line);
}

// Middleware: attach audit context to every request
app.use((req: any, _res: any, next: any) => {
  req._audit = {
    event_id: randomUUID(),
    start: Date.now(),
    ip: req.ip || req.socket?.remoteAddress || 'unknown',
    user_agent: req.get('user-agent') || 'unknown'
  };
  next();
});



// --- Verify API Key ---
app.post('/api/verify', async (req: any, res) => {
  const { apiKey } = req.body;
  const audit = req._audit;
  if (!apiKey) {
    auditLog({
      event_id: audit.event_id,
      timestamp: new Date().toISOString(),
      actor: { key_fingerprint: 'none', ip: audit.ip, user_agent: audit.user_agent },
      action: 'verify_key',
      resource: 'openrouter/models',
      request: { method: 'POST', path: '/api/verify', body_summary: {} },
      response: { status_code: 200, latency_ms: Date.now() - audit.start, body_summary: { ok: false } },
      outcome: 'failure',
      error: 'No key provided'
    });
    return res.json({ ok: false, error: 'No key provided' });
  }
  try {
    const r = await fetch(`${OPENROUTER_BASE}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const ok = r.ok;
    auditLog({
      event_id: audit.event_id,
      timestamp: new Date().toISOString(),
      actor: { key_fingerprint: redactKey(apiKey), ip: audit.ip, user_agent: audit.user_agent },
      action: 'verify_key',
      resource: 'openrouter/models',
      request: { method: 'POST', path: '/api/verify', body_summary: { key_provided: true } },
      response: { status_code: r.status, latency_ms: Date.now() - audit.start, body_summary: { ok } },
      outcome: ok ? 'success' : 'failure',
      error: ok ? undefined : `HTTP ${r.status}`
    });
    if (ok) {
      res.json({ ok: true });
    } else {
      res.json({ ok: false, error: `HTTP ${r.status}` });
    }
  } catch (e: any) {
    auditLog({
      event_id: audit.event_id,
      timestamp: new Date().toISOString(),
      actor: { key_fingerprint: redactKey(apiKey), ip: audit.ip, user_agent: audit.user_agent },
      action: 'verify_key',
      resource: 'openrouter/models',
      request: { method: 'POST', path: '/api/verify', body_summary: { key_provided: true } },
      response: { status_code: 0, latency_ms: Date.now() - audit.start, body_summary: {} },
      outcome: 'error',
      error: e.message
    });
    res.json({ ok: false, error: e.message });
  }
});

// --- Fetch Models ---
app.post('/api/models', async (req: any, res) => {
  const { apiKey } = req.body;
  const audit = req._audit;
  try {
    const r = await fetch(`${OPENROUTER_BASE}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const data = await r.json() as any;
    const models = (data.data || []).map((m: any) => ({
      id: m.id,
      name: m.name,
      type: m.architecture?.modality || 'chat',
      context_length: m.context_length,
      pricing: m.pricing
    }));
    auditLog({
      event_id: audit.event_id,
      timestamp: new Date().toISOString(),
      actor: { key_fingerprint: redactKey(apiKey), ip: audit.ip, user_agent: audit.user_agent },
      action: 'list_models',
      resource: 'openrouter/models',
      request: { method: 'POST', path: '/api/models', body_summary: {} },
      response: { status_code: r.status, latency_ms: Date.now() - audit.start, body_summary: { model_count: models.length } },
      outcome: 'success'
    });
    res.json({ models });
  } catch (e: any) {
    auditLog({
      event_id: audit.event_id,
      timestamp: new Date().toISOString(),
      actor: { key_fingerprint: redactKey(apiKey), ip: audit.ip, user_agent: audit.user_agent },
      action: 'list_models',
      resource: 'openrouter/models',
      request: { method: 'POST', path: '/api/models', body_summary: {} },
      response: { status_code: 0, latency_ms: Date.now() - audit.start, body_summary: {} },
      outcome: 'error',
      error: e.message
    });
    res.json({ models: [], error: e.message });
  }
});

// --- Probe Latency (1 token in, 1 token out) ---
app.post('/api/probe', async (req: any, res) => {
  const { apiKey, model } = req.body;
  const audit = req._audit;
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3900',
        'X-Title': 'ESCMC Probe'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '1' }],
        max_tokens: 1,
        temperature: 0
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!r.ok) {
      const err = await r.text();
      auditLog({
        event_id: audit.event_id,
        timestamp: new Date().toISOString(),
        actor: { key_fingerprint: redactKey(apiKey), ip: audit.ip, user_agent: audit.user_agent },
        action: 'probe_model',
        resource: `openrouter/chat/${model}`,
        request: { method: 'POST', path: '/api/probe', body_summary: { model, max_tokens: 1 } },
        response: { status_code: r.status, latency_ms: Date.now() - start, body_summary: { error: err.slice(0, 200) } },
        outcome: 'failure',
        error: `HTTP ${r.status}`
      });
      return res.json({ error: `HTTP ${r.status}: ${err.slice(0, 200)}` });
    }
    const latency = Date.now() - start;
    auditLog({
      event_id: audit.event_id,
      timestamp: new Date().toISOString(),
      actor: { key_fingerprint: redactKey(apiKey), ip: audit.ip, user_agent: audit.user_agent },
      action: 'probe_model',
      resource: `openrouter/chat/${model}`,
      request: { method: 'POST', path: '/api/probe', body_summary: { model, max_tokens: 1 } },
      response: { status_code: 200, latency_ms: latency, body_summary: { model } },
      outcome: 'success',
      metadata: { latency_ms: latency }
    });
    res.json({ latency, model });
  } catch (e: any) {
    clearTimeout(timeout);
    auditLog({
      event_id: audit.event_id,
      timestamp: new Date().toISOString(),
      actor: { key_fingerprint: redactKey(apiKey), ip: audit.ip, user_agent: audit.user_agent },
      action: 'probe_model',
      resource: `openrouter/chat/${model}`,
      request: { method: 'POST', path: '/api/probe', body_summary: { model, max_tokens: 1 } },
      response: { status_code: 0, latency_ms: Date.now() - start, body_summary: {} },
      outcome: 'error',
      error: e.message
    });
    res.json({ error: e.message });
  }
});

// --- Compaction Endpoint (SSE) ---
app.post('/api/compact', async (req: any, res) => {
  const { apiKey, prompt, models } = req.body;
  const audit = req._audit;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (type: string, payload: any) => {
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
  };

  auditLog({
    event_id: audit.event_id,
    timestamp: new Date().toISOString(),
    actor: { key_fingerprint: redactKey(apiKey), ip: audit.ip, user_agent: audit.user_agent },
    action: 'compact_start',
    resource: 'compaction/fanout',
    request: { method: 'POST', path: '/api/compact', body_summary: { model_count: models?.length, prompt_length: prompt?.length } },
    response: { status_code: 200, latency_ms: 0, body_summary: {} },
    outcome: 'success',
    metadata: { models }
  });

  send('log', { message: `Starting fan-out to ${models.length} models` });

  // Fan out to all models concurrently
  const responses: { model: string; content: string; latency: number }[] = [];
  const promises = models.map(async (model: string) => {
    const start = Date.now();
    try {
      const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3900',
          'X-Title': 'ESCMC Compaction'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 256,
          temperature: 0.7
        })
      });
      const data = await r.json() as any;
      const content = data.choices?.[0]?.message?.content || '';
      const latency = Date.now() - start;
      auditLog({
        event_id: randomUUID(),
        timestamp: new Date().toISOString(),
        actor: { key_fingerprint: redactKey(apiKey), ip: audit.ip, user_agent: audit.user_agent },
        action: 'compact_fanout_response',
        resource: `openrouter/chat/${model}`,
        request: { method: 'POST', path: '/api/compact', body_summary: { model, prompt_length: prompt?.length, max_tokens: 256 } },
        response: { status_code: r.status, latency_ms: latency, body_summary: { content_length: content.length } },
        outcome: content ? 'success' : 'failure',
        metadata: { parent_event_id: audit.event_id }
      });
      send('log', { message: `${model}: ${latency}ms, ${content.length} chars` });
      responses.push({ model, content, latency });
    } catch (e: any) {
      auditLog({
        event_id: randomUUID(),
        timestamp: new Date().toISOString(),
        actor: { key_fingerprint: redactKey(apiKey), ip: audit.ip, user_agent: audit.user_agent },
        action: 'compact_fanout_response',
        resource: `openrouter/chat/${model}`,
        request: { method: 'POST', path: '/api/compact', body_summary: { model, prompt_length: prompt?.length } },
        response: { status_code: 0, latency_ms: Date.now() - start, body_summary: {} },
        outcome: 'error',
        error: e.message,
        metadata: { parent_event_id: audit.event_id }
      });
      send('log', { message: `${model}: ERROR - ${e.message}` });
    }
  });

  await Promise.all(promises);
  send('status', { message: `All ${responses.length} models responded. Compacting...` });

  // --- BCE Encoding ---
  const compacted = compactResponses(responses);
  const braille = encodeBCE(compacted);

  auditLog({
    event_id: randomUUID(),
    timestamp: new Date().toISOString(),
    actor: { key_fingerprint: redactKey(apiKey), ip: audit.ip, user_agent: audit.user_agent },
    action: 'compact_complete',
    resource: 'compaction/bce',
    request: { method: 'POST', path: '/api/compact', body_summary: {} },
    response: { status_code: 200, latency_ms: Date.now() - audit.start, body_summary: {
      input_models: responses.length,
      compacted_text_length: compacted.text.length,
      braille_cells: braille.length,
      compression_ratio: compacted.text.length > 0 ? +(compacted.text.length / braille.length).toFixed(3) : 0,
      segment_count: compacted.segments.length,
      avg_agreement: compacted.segments.length > 0
        ? +(compacted.segments.reduce((s, seg) => s + seg.agreement, 0) / compacted.segments.length).toFixed(3)
        : 0
    }},
    outcome: 'success',
    metadata: { parent_event_id: audit.event_id }
  });

  send('braille', { content: braille });
  send('log', { message: `BCE output: ${braille.length} cells (compression ratio: ${(compacted.text.length / braille.length).toFixed(2)}x)` });
  send('status', { message: `Done. ${braille.length} braille cells emitted.` });

  res.write('data: [DONE]\n\n');
  res.end();
});

// --- Compaction Logic ---
interface ModelResponse {
  model: string;
  content: string;
  latency: number;
}

interface CompactedResult {
  text: string;
  segments: Array<{
    text: string;
    agreement: number; // 0-1
    sources: string[];
  }>;
}

function compactResponses(responses: ModelResponse[]): CompactedResult {
  if (responses.length === 0) return { text: '', segments: [] };
  if (responses.length === 1) {
    return {
      text: responses[0].content,
      segments: [{ text: responses[0].content, agreement: 1, sources: [responses[0].model] }]
    };
  }

  // Sentence-level alignment: split each response into sentences
  const sentenceSets = responses.map(r => ({
    model: r.model,
    sentences: splitSentences(r.content)
  }));

  // Simple consensus: for each sentence position, check agreement
  const maxLen = Math.max(...sentenceSets.map(s => s.sentences.length));
  const segments: CompactedResult['segments'] = [];

  for (let i = 0; i < maxLen; i++) {
    const candidates = sentenceSets
      .filter(s => s.sentences[i])
      .map(s => ({ model: s.model, text: s.sentences[i] }));

    if (candidates.length === 0) continue;

    // Naive agreement: normalized edit distance
    const base = candidates[0].text;
    const agreeing = candidates.filter(c =>
      normalizedSimilarity(base, c.text) > 0.6
    );

    const agreement = agreeing.length / candidates.length;
    // Pick the longest agreeing candidate (most informative)
    const best = agreeing.sort((a, b) => b.text.length - a.text.length)[0] || candidates[0];

    segments.push({
      text: best.text,
      agreement,
      sources: agreeing.map(a => a.model)
    });
  }

  const text = segments.map(s => s.text).join(' ');
  return { text, segments };
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function normalizedSimilarity(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la === lb) return 1;
  // Jaccard similarity on word sets
  const wordsA = new Set(la.split(/\s+/));
  const wordsB = new Set(lb.split(/\s+/));
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 0 : intersection / union;
}

// --- 8-Dot Braille Compaction Encoding ---
// Dot layout: d1(1) d2(2) d3(4) d4(8) d5(16) d6(32) d7(64) d8(128)
// Meta bits: d7 = consensus flag, d8 = divergence flag
// Content: dots 1-6 = 6-bit payload (0-63)

const BRAILLE_BASE = 0x2800;

// Text mode alphabet (6-bit)
const TEXT_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 \x00';
const CHAR_TO_CODE: Record<string, number> = {};
for (let i = 0; i < TEXT_ALPHABET.length; i++) {
  CHAR_TO_CODE[TEXT_ALPHABET[i]] = i;
}

function encodeBCE(compacted: CompactedResult): string {
  let output = '';

  // Control: STREAM_START
  output += brailleCell(0, true, true);
  // Control: MODE_TEXT
  output += brailleCell(2, true, true);
  // Control: SOURCE_COUNT
  output += brailleCell(5, true, true);
  output += brailleCell(compacted.segments.length > 0 ? compacted.segments[0].sources.length : 0, false, false);

  for (const segment of compacted.segments) {
    const isConsensus = segment.agreement >= 0.8;
    const isDivergent = segment.agreement < 0.5;

    for (const char of segment.text) {
      const code = CHAR_TO_CODE[char] ?? CHAR_TO_CODE[char.toLowerCase()] ?? 62; // default to space
      output += brailleCell(code, isConsensus, isDivergent);
    }
  }

  // Control: STREAM_END
  output += brailleCell(1, true, true);
  return output;
}

function brailleCell(payload6bit: number, dot7: boolean, dot8: boolean): string {
  const value = (payload6bit & 0x3F) | (dot7 ? 64 : 0) | (dot8 ? 128 : 0);
  return String.fromCodePoint(BRAILLE_BASE + value);
}

// --- Experiment API Endpoints ---

app.get('/api/providers', (_req, res) => {
  const providers = getAvailableProviders().map(([id, p]) => ({
    id, name: p.name, models: p.models
  }));
  res.json({ providers, models: getAllModels() });
});

app.get('/api/cerebraille/codebook', (req: any, res) => {
  res.json(getCerebrailleCodebook(req.query.domain));
});

app.get('/api/cerebraille/symbol', (req: any, res) => {
  const symbol = lookupSymbol({ cell: req.query.cell, codepoint: req.query.codepoint });
  if (!symbol) return res.status(404).json({ error: 'symbol not found' });
  res.json(symbol);
});

app.post('/api/cerebraille/encode', (req: any, res) => {
  const { text, domain, fidelityMode } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }
  res.json(encodeCerebraille({ text, domain, fidelityMode }));
});

app.post('/api/cerebraille/decode', (req: any, res) => {
  const { encoded } = req.body || {};
  if (typeof encoded !== 'string') {
    return res.status(400).json({ error: 'encoded is required' });
  }
  res.json(decodeCerebraille({ encoded }));
});

app.get('/api/cerebraille/frontier-tools', (_req, res) => {
  res.json({ tools: frontierToolSchemas() });
});

app.get('/api/cerebraille/training-descriptor', (_req, res) => {
  res.json(trainingDescriptor());
});

// Local shared-codec live demonstration (no external API calls)
app.post('/api/demo/shared-codec', (req: any, res) => {
  const { text } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }
  const started = Date.now();
  const result = encodeSharedCodec(text);
  res.json({
    original: text,
    encoded: result.encoded,
    decoded: result.decoded,
    original_length: result.original_chars,
    encoded_cells: result.encoded_cells,
    compression_ratio: result.compression_ratio,
    exact_roundtrip: result.exact_roundtrip,
    matched_entries: result.matched_entries,
    codec: sharedCodecStats(),
    latency_ms: Date.now() - started
  });
});

// Run handshake phase (models negotiate codebooks)
app.post('/api/experiment/handshake', async (_req: any, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  const send = (data: any) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  send({ type: 'status', message: 'Starting handshake phase...' });
  try {
    const results = await runHandshake();
    send({ type: 'results', data: results });
    send({ type: 'status', message: `Handshake complete. ${results.length} codebooks generated.` });
  } catch (e: any) {
    send({ type: 'error', message: e.message });
  }
  res.write('data: [DONE]\n\n');
  res.end();
});

// Run encode/decode benchmark
app.post('/api/experiment/benchmark', async (req: any, res) => {
  const { encoderModel, decoderModel } = req.body;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  const send = (data: any) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  send({ type: 'status', message: `Benchmark: ${encoderModel} → braille → ${decoderModel}` });
  try {
    const results = await runBenchmark({ encoderModel, decoderModel });
    // Judge fidelity
    send({ type: 'status', message: 'Judging fidelity...' });
    const judged = await judgeFidelity(results);
    printSummary(judged);
    send({ type: 'results', data: judged });
    send({ type: 'status', message: 'Benchmark complete.' });
  } catch (e: any) {
    send({ type: 'error', message: e.message });
  }
  res.write('data: [DONE]\n\n');
  res.end();
});

// Run full cross-model matrix
app.post('/api/experiment/matrix', async (_req: any, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  const send = (data: any) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  send({ type: 'status', message: 'Starting cross-model matrix...' });
  try {
    const results = await runCrossModelMatrix();
    send({ type: 'status', message: 'Judging fidelity...' });
    const judged = await judgeFidelity(results);
    printSummary(judged);
    send({ type: 'results', data: judged });
  } catch (e: any) {
    send({ type: 'error', message: e.message });
  }
  res.write('data: [DONE]\n\n');
  res.end();
});

// Single encode/decode test (live demo)
app.post('/api/experiment/live', async (req: any, res) => {
  const { text, encoderModel, decoderModel } = req.body;
  try {
    // Encode
    const encodeRes = await callAnyModel(encoderModel, {
      messages: [
        { role: 'system', content: ENCODER_SYSTEM_PROMPT },
        { role: 'user', content: `Encode the following into braille:\n\n${text}` }
      ],
      max_tokens: 1024,
      temperature: 0.2
    });
    // Decode (use user-message-only to avoid safety filter refusals)
    const decodeRes = await callAnyModel(decoderModel, {
      messages: [
        { role: 'user', content: makeDecoderUserMessage(encodeRes.content) }
      ],
      max_tokens: 1024,
      temperature: 0.3
    });

    const brailleCells = [...encodeRes.content].filter(c => {
      const cp = c.codePointAt(0)!;
      return cp >= 0x2800 && cp <= 0x28FF;
    }).length;

    res.json({
      original: text,
      encoded: encodeRes.content,
      decoded: decodeRes.content,
      braille_cells: brailleCells,
      original_length: text.length,
      compression_ratio: brailleCells > 0 ? (text.length / brailleCells).toFixed(2) : '0',
      encode_latency_ms: encodeRes.latency_ms,
      decode_latency_ms: decodeRes.latency_ms,
      encode_tokens: encodeRes.output_tokens,
      decode_tokens: decodeRes.output_tokens
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Run iterative codebook alignment (joint embedding convergence)
app.post('/api/experiment/align', async (req: any, res) => {
  const { encoderModel, decoderModel, maxRounds } = req.body;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  const send = (data: any) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  send({ type: 'status', message: `Starting alignment: ${encoderModel} ↔ ${decoderModel}` });
  try {
    const session = await runAlignment({ encoderModel, decoderModel, maxRounds: maxRounds || 6 });
    send({ type: 'results', data: session });
    send({ type: 'status', message: `Alignment complete. Fidelity: ${(session.final_fidelity * 100).toFixed(1)}%` });
  } catch (e: any) {
    send({ type: 'error', message: e.message });
  }
  res.write('data: [DONE]\n\n');
  res.end();
});

// Run LaTeX round-trip experiment (encode → braille → decode → compile)
app.post('/api/experiment/latex', async (req: any, res) => {
  const { encoderModel, decoderModel, docIds } = req.body;
  try {
    const results = await runLatexRoundtrip({ encoderModel, decoderModel, docIds });
    res.json({ results });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Run full benchmark suite (repeat trials + model pairs + CSV/JSON exports)
app.post('/api/experiment/suite', async (req: any, res) => {
  const { pairs, trials, taskIds, includeLatex, maxPairs, maxConcurrency, judgeModel } = req.body || {};
  try {
    const result = await runBenchmarkSuite({ pairs, trials, taskIds, includeLatex, maxPairs, maxConcurrency, judgeModel });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Start ---
const PORT = 3900;
app.listen(PORT, () => {
  const models = getAllModels();
  console.log(`\n⠿ ESCMC Benchmark Server — http://localhost:${PORT}`);
  console.log(`  ${getAvailableProviders().length} providers, ${models.length} models ready`);
  console.log(`  Models: ${models.map(m => m.model).join(', ')}\n`);
});
