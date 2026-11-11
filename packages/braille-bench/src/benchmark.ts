import { callAnyModel, getAllModels, type ModelResponse } from './providers.js';
import { ENCODER_SYSTEM_PROMPT, DECODER_SYSTEM_PROMPT, HANDSHAKE_PROMPT, makeDecoderUserMessage } from './braille.js';
import { randomUUID } from 'crypto';
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RESULTS_DIR = join(__dirname, '..', 'results');
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

// --- Test Prompts (diverse tasks) ---
const TEST_PROMPTS = [
  { id: 'factual_1', category: 'factual', prompt: 'Explain how photosynthesis works in 3 sentences.' },
  { id: 'factual_2', category: 'factual', prompt: 'What are the three laws of thermodynamics?' },
  { id: 'reasoning_1', category: 'reasoning', prompt: 'If all roses are flowers and some flowers fade quickly, can we conclude that some roses fade quickly? Explain.' },
  { id: 'code_1', category: 'code', prompt: 'Write a Python function that checks if a string is a palindrome.' },
  { id: 'creative_1', category: 'creative', prompt: 'Write a haiku about machine learning.' },
  { id: 'structured_1', category: 'structured', prompt: 'List the 5 largest planets in our solar system with their approximate diameters in km.' },
  { id: 'summary_1', category: 'summary', prompt: 'Summarize the concept of natural selection in exactly 2 sentences.' },
  { id: 'instruction_1', category: 'instruction', prompt: 'Give step-by-step instructions to make a peanut butter sandwich.' },
];

interface BenchmarkResult {
  run_id: string;
  timestamp: string;
  test_id: string;
  category: string;
  encoder_model: string;
  decoder_model: string;
  // Baseline: encoder answers directly
  baseline: {
    response: string;
    tokens_in: number;
    tokens_out: number;
    latency_ms: number;
  };
  // Treatment: encoder → braille → decoder
  treatment: {
    encoded_braille: string;
    braille_cells: number;
    decoded_response: string;
    encode_tokens_in: number;
    encode_tokens_out: number;
    encode_latency_ms: number;
    decode_tokens_in: number;
    decode_tokens_out: number;
    decode_latency_ms: number;
    total_latency_ms: number;
  };
  // Metrics
  metrics: {
    compression_ratio: number; // baseline tokens / braille cells
    token_savings_pct: number;
    round_trip_latency_ms: number;
    // Semantic fidelity measured by a judge
    fidelity?: number; // 0-1, filled in by judge pass
  };
}

interface HandshakeResult {
  run_id: string;
  timestamp: string;
  model: string;
  codebook_raw: string;
  latency_ms: number;
  tokens_out: number;
}

// --- Phase 1: Handshake (models negotiate codebooks) ---
export async function runHandshake(): Promise<HandshakeResult[]> {
  const models = getAllModels();
  console.log(`\n⠿ HANDSHAKE PHASE: ${models.length} models negotiating braille codebooks...\n`);

  const results: HandshakeResult[] = [];
  const promises = models.map(async ({ model }) => {
    try {
      const res = await callAnyModel(model, {
        messages: [
          { role: 'system', content: HANDSHAKE_PROMPT },
          { role: 'user', content: 'Propose your braille codebook. Assign meanings to at least 50 braille cells (U+2800–U+28FF). Be systematic and prioritize maximum compression of typical LLM output.' }
        ],
        max_tokens: 2048,
        temperature: 0.3
      });
      const result: HandshakeResult = {
        run_id: randomUUID(),
        timestamp: new Date().toISOString(),
        model,
        codebook_raw: res.content,
        latency_ms: res.latency_ms,
        tokens_out: res.output_tokens || 0
      };
      results.push(result);
      console.log(`  ✓ ${model}: ${res.content.length} chars, ${res.latency_ms}ms`);
    } catch (e: any) {
      console.log(`  ✗ ${model}: ${e.message}`);
    }
  });

  await Promise.all(promises);
  saveResults('handshake', results);
  return results;
}

// --- Phase 2: Encode/Decode Benchmark ---
export async function runBenchmark(opts?: { encoderModel?: string; decoderModel?: string }): Promise<BenchmarkResult[]> {
  const models = getAllModels();
  // Default: use first two available models as encoder/decoder pair
  const encoderModel = opts?.encoderModel || models[0]?.model || 'gpt-4o-mini';
  const decoderModel = opts?.decoderModel || models[1]?.model || 'claude-3-5-haiku-20241022';

  console.log(`\n⠿ BENCHMARK: encoder=${encoderModel}, decoder=${decoderModel}`);
  console.log(`  Running ${TEST_PROMPTS.length} test prompts...\n`);

  const results: BenchmarkResult[] = [];

  for (const test of TEST_PROMPTS) {
    console.log(`  [${test.id}] ${test.prompt.slice(0, 50)}...`);

    // --- BASELINE: encoder answers directly ---
    const baseline = await callAnyModel(encoderModel, {
      messages: [{ role: 'user', content: test.prompt }],
      max_tokens: 512,
      temperature: 0.7
    });
    console.log(`    baseline: ${baseline.output_tokens} tokens, ${baseline.latency_ms}ms`);

    // --- TREATMENT: encoder compresses to braille ---
    const encodeRes = await callAnyModel(encoderModel, {
      messages: [
        { role: 'system', content: ENCODER_SYSTEM_PROMPT },
        { role: 'user', content: `Encode the following into braille:\n\n${baseline.content}` }
      ],
      max_tokens: 1024,
      temperature: 0.2
    });
    console.log(`    encode: ${encodeRes.content.length} braille cells, ${encodeRes.latency_ms}ms`);

    // --- TREATMENT: decoder reconstructs from braille ---
    const decodeRes = await callAnyModel(decoderModel, {
      messages: [
        { role: 'user', content: makeDecoderUserMessage(encodeRes.content) }
      ],
      max_tokens: 1024,
      temperature: 0.3
    });
    console.log(`    decode: ${decodeRes.output_tokens} tokens, ${decodeRes.latency_ms}ms`);

    // --- Compute metrics ---
    const brailleCells = [...encodeRes.content].filter(c => {
      const cp = c.codePointAt(0)!;
      return cp >= 0x2800 && cp <= 0x28FF;
    }).length;

    const baselineTokens = (baseline.input_tokens || 0) + (baseline.output_tokens || 0);
    const treatmentTokens = (encodeRes.input_tokens || 0) + (encodeRes.output_tokens || 0) +
                           (decodeRes.input_tokens || 0) + (decodeRes.output_tokens || 0);

    const result: BenchmarkResult = {
      run_id: randomUUID(),
      timestamp: new Date().toISOString(),
      test_id: test.id,
      category: test.category,
      encoder_model: encoderModel,
      decoder_model: decoderModel,
      baseline: {
        response: baseline.content,
        tokens_in: baseline.input_tokens || 0,
        tokens_out: baseline.output_tokens || 0,
        latency_ms: baseline.latency_ms
      },
      treatment: {
        encoded_braille: encodeRes.content,
        braille_cells: brailleCells,
        decoded_response: decodeRes.content,
        encode_tokens_in: encodeRes.input_tokens || 0,
        encode_tokens_out: encodeRes.output_tokens || 0,
        encode_latency_ms: encodeRes.latency_ms,
        decode_tokens_in: decodeRes.input_tokens || 0,
        decode_tokens_out: decodeRes.output_tokens || 0,
        decode_latency_ms: decodeRes.latency_ms,
        total_latency_ms: encodeRes.latency_ms + decodeRes.latency_ms
      },
      metrics: {
        compression_ratio: brailleCells > 0 ? baseline.content.length / brailleCells : 0,
        token_savings_pct: treatmentTokens > 0 ? ((baselineTokens - treatmentTokens) / baselineTokens) * 100 : 0,
        round_trip_latency_ms: encodeRes.latency_ms + decodeRes.latency_ms
      }
    };

    results.push(result);
    console.log(`    → compression: ${result.metrics.compression_ratio.toFixed(2)}x, braille cells: ${brailleCells}\n`);
  }

  saveResults('benchmark', results);
  return results;
}

// --- Phase 3: Cross-model matrix (all pairs) ---
export async function runCrossModelMatrix(): Promise<BenchmarkResult[]> {
  const models = getAllModels();
  console.log(`\n⠿ CROSS-MODEL MATRIX: ${models.length} models × ${models.length} models`);
  console.log(`  ${models.length * models.length} encoder/decoder pairs\n`);

  const allResults: BenchmarkResult[] = [];
  // Use a subset of prompts for the matrix (otherwise too expensive)
  const subsetPrompts = TEST_PROMPTS.slice(0, 3);

  for (const encoder of models) {
    for (const decoder of models) {
      console.log(`\n  --- ${encoder.model} → ${decoder.model} ---`);
      const results = await runBenchmark({
        encoderModel: encoder.model,
        decoderModel: decoder.model
      });
      allResults.push(...results);
    }
  }

  saveResults('matrix', allResults);
  return allResults;
}

// --- Phase 4: Fidelity Judge ---
export async function judgeFidelity(results: BenchmarkResult[], judgeModel = 'gpt-4o-mini'): Promise<BenchmarkResult[]> {
  console.log(`\n⠿ FIDELITY JUDGE: ${judgeModel} scoring ${results.length} results...\n`);

  for (const result of results) {
    const judgeRes = await callAnyModel(judgeModel, {
      messages: [{
        role: 'user',
        content: `Score the semantic similarity between these two texts on a scale of 0.0 to 1.0.
Output ONLY a number (e.g., 0.85). No other text.

ORIGINAL:
${result.baseline.response}

RECONSTRUCTED:
${result.treatment.decoded_response}`
      }],
      max_tokens: 10,
      temperature: 0
    });

    const score = parseFloat(judgeRes.content.trim());
    result.metrics.fidelity = isNaN(score) ? 0 : Math.min(1, Math.max(0, score));
    console.log(`  [${result.test_id}] fidelity: ${result.metrics.fidelity}`);
  }

  saveResults('judged', results);
  return results;
}

// --- Utility ---
function saveResults(phase: string, data: any) {
  const filename = `${phase}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
  const filepath = join(RESULTS_DIR, filename);
  const lines = Array.isArray(data) ? data.map(d => JSON.stringify(d)).join('\n') + '\n' : JSON.stringify(data) + '\n';
  appendFileSync(filepath, lines);
  console.log(`  📁 Saved: results/${filename}`);
}

export function printSummary(results: BenchmarkResult[]) {
  console.log('\n' + '='.repeat(60));
  console.log('BENCHMARK SUMMARY');
  console.log('='.repeat(60));

  const avgCompression = results.reduce((s, r) => s + r.metrics.compression_ratio, 0) / results.length;
  const avgFidelity = results.filter(r => r.metrics.fidelity !== undefined).reduce((s, r) => s + r.metrics.fidelity!, 0) /
    results.filter(r => r.metrics.fidelity !== undefined).length;
  const avgLatency = results.reduce((s, r) => s + r.metrics.round_trip_latency_ms, 0) / results.length;
  const totalBrailleCells = results.reduce((s, r) => s + r.treatment.braille_cells, 0);
  const totalBaselineChars = results.reduce((s, r) => s + r.baseline.response.length, 0);

  console.log(`\n  Tests run:          ${results.length}`);
  console.log(`  Avg compression:    ${avgCompression.toFixed(2)}x (chars/braille-cell)`);
  console.log(`  Avg fidelity:       ${isNaN(avgFidelity) ? 'not judged' : avgFidelity.toFixed(3)}`);
  console.log(`  Avg round-trip:     ${avgLatency.toFixed(0)}ms`);
  console.log(`  Total braille out:  ${totalBrailleCells} cells`);
  console.log(`  Total baseline:     ${totalBaselineChars} chars`);
  console.log(`  Overall density:    ${(totalBaselineChars / totalBrailleCells).toFixed(2)} chars/cell`);
  console.log('\n' + '='.repeat(60));
}
