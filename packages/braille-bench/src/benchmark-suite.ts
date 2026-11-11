import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { ENCODER_SYSTEM_PROMPT, makeDecoderUserMessage } from './braille.js';
import { callAnyModel, getAllModels } from './providers.js';
import { runLatexRoundtrip } from './latex-experiment.js';
import { auditError, auditSuccess, makeTraceNumber, modelCallAuditPath, type ModelCallTraceContext, type TraceableModelCall } from './audit.js';
import { encodeSharedCodec } from './shared-codec.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RESULTS_DIR = join(__dirname, '..', 'results');
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

export type SuiteTaskKind = 'prose' | 'structured' | 'code' | 'latex';

export interface SuiteTask {
  id: string;
  kind: SuiteTaskKind;
  prompt: string;
  reference?: string;
}

export interface SuitePair {
  encoderModel: string;
  decoderModel: string;
}

export interface SuiteCaseResult {
  run_id: string;
  suite_id: string;
  timestamp: string;
  trial: number;
  task_id: string;
  task_kind: SuiteTaskKind;
  encoder_model: string;
  decoder_model: string;
  baseline_text: string;
  encoded_braille: string;
  decoded_text: string;
  original_chars: number;
  baseline_chars: number;
  braille_cells: number;
  compression_ratio_vs_baseline: number;
  compression_ratio_vs_prompt: number;
  baseline_tokens_in: number;
  baseline_tokens_out: number;
  encode_tokens_in: number;
  encode_tokens_out: number;
  decode_tokens_in: number;
  decode_tokens_out: number;
  baseline_latency_ms: number;
  encode_latency_ms: number;
  decode_latency_ms: number;
  round_trip_latency_ms: number;
  heuristic_fidelity: number;
  exact_match: boolean;
  compile_success?: boolean;
  structure_valid?: boolean;
  trace_numbers: {
    baseline?: string;
    encode?: string;
    decode?: string;
    latex_roundtrip?: string;
  };
  audit_paths: string[];
  error?: string;
}

export interface SuiteAggregateRow {
  task_kind: string;
  encoder_model: string;
  decoder_model: string;
  n: number;
  success_rate: number;
  avg_compression_vs_baseline: number;
  avg_compression_vs_prompt: number;
  avg_fidelity: number;
  avg_round_trip_latency_ms: number;
  avg_braille_cells: number;
  exact_match_rate: number;
  compile_success_rate?: number;
}

export interface SuiteRunResult {
  suite_id: string;
  started_at: string;
  finished_at: string;
  config: Required<BenchmarkSuiteOptions>;
  cases: SuiteCaseResult[];
  aggregates: SuiteAggregateRow[];
  files: {
    json: string;
    jsonl: string;
    csv: string;
    summaryCsv: string;
    modelCallAudit: string;
  };
}

export interface BenchmarkSuiteOptions {
  pairs?: SuitePair[];
  trials?: number;
  taskIds?: string[];
  includeLatex?: boolean;
  maxPairs?: number;
  maxConcurrency?: number;
  judgeModel?: string | null;
  codecMode?: 'llm' | 'shared';
}

export const SUITE_TASKS: SuiteTask[] = [
  {
    id: 'prose_photosynthesis',
    kind: 'prose',
    prompt: 'Explain photosynthesis in exactly three concise sentences.'
  },
  {
    id: 'prose_thermo',
    kind: 'prose',
    prompt: 'Explain the first and second laws of thermodynamics in plain English.'
  },
  {
    id: 'reasoning_syllogism',
    kind: 'prose',
    prompt: 'If all roses are flowers and some flowers fade quickly, can we conclude that some roses fade quickly? Explain briefly.'
  },
  {
    id: 'structured_planets',
    kind: 'structured',
    prompt: 'Return a compact table of the five largest planets and their approximate diameters in kilometers.'
  },
  {
    id: 'code_palindrome',
    kind: 'code',
    prompt: 'Write a short Python function named is_palindrome that ignores case and spaces.'
  },
  {
    id: 'latex_minimal',
    kind: 'latex',
    prompt: `\\documentclass{article}
\\begin{document}
Hello world.
\\end{document}`,
    reference: `\\documentclass{article}
\\begin{document}
Hello world.
\\end{document}`
  },
  {
    id: 'latex_paper',
    kind: 'latex',
    prompt: `\\documentclass{article}
\\title{Braille as a Compact Protocol}
\\author{Research Team}
\\begin{document}
\\maketitle
\\section{Introduction}
We propose braille encoding for inter-model communication.
\\section{Method}
The compression ratio is $r = \\frac{n}{m}$ where $n$ is input length.
\\begin{equation}
r = \\frac{\\sum a}{m}
\\end{equation}
\\end{document}`,
    reference: `\\documentclass{article}
\\title{Braille as a Compact Protocol}
\\author{Research Team}
\\begin{document}
\\maketitle
\\section{Introduction}
We propose braille encoding for inter-model communication.
\\section{Method}
The compression ratio is $r = \\frac{n}{m}$ where $n$ is input length.
\\begin{equation}
r = \\frac{\\sum a}{m}
\\end{equation}
\\end{document}`
  }
];

function defaultPairs(maxPairs?: number): SuitePair[] {
  const models = getAllModels().map(m => m.model);
  const available = (needle: string) => models.find(m => m.includes(needle));
  const haiku = available('haiku');
  const sonnet = available('sonnet');
  const opus = available('opus-4-5');
  const gemini25 = available('gemini-2.5');
  const gemini20 = available('gemini-2.0');
  const mistral = available('mistral');

  const candidates: SuitePair[] = [
    haiku && gemini25 ? { encoderModel: haiku, decoderModel: gemini25 } : null,
    haiku && haiku ? { encoderModel: haiku, decoderModel: haiku } : null,
    sonnet && gemini25 ? { encoderModel: sonnet, decoderModel: gemini25 } : null,
    gemini25 && haiku ? { encoderModel: gemini25, decoderModel: haiku } : null,
    gemini20 && gemini25 ? { encoderModel: gemini20, decoderModel: gemini25 } : null,
    opus && haiku ? { encoderModel: opus, decoderModel: haiku } : null,
    mistral && gemini25 ? { encoderModel: mistral, decoderModel: gemini25 } : null
  ].filter(Boolean) as SuitePair[];

  const uniq = new Map(candidates.map(p => [`${p.encoderModel}->${p.decoderModel}`, p]));
  const pairs = [...uniq.values()];
  return typeof maxPairs === 'number' ? pairs.slice(0, maxPairs) : pairs;
}

function countBrailleCells(s: string): number {
  return [...s].filter(c => {
    const cp = c.codePointAt(0)!;
    return cp >= 0x2800 && cp <= 0x28FF;
  }).length;
}

function extractBraille(s: string): string {
  return [...s].filter(c => {
    const cp = c.codePointAt(0)!;
    return cp >= 0x2800 && cp <= 0x28FF;
  }).join('');
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function jaccardWords(a: string, b: string): number {
  const aw = new Set(normalizeText(a).split(' ').filter(Boolean));
  const bw = new Set(normalizeText(b).split(' ').filter(Boolean));
  if (!aw.size && !bw.size) return 1;
  const intersection = [...aw].filter(w => bw.has(w)).length;
  const union = new Set([...aw, ...bw]).size;
  return union ? intersection / union : 0;
}

function exactNormalizedMatch(a: string, b: string): boolean {
  return normalizeText(a) === normalizeText(b);
}

async function tracedCall(context: ModelCallTraceContext, call: TraceableModelCall) {
  const traceNumber = makeTraceNumber(context, context.phase);
  try {
    const response = await callAnyModel(call.model, {
      messages: call.messages as any,
      max_tokens: call.max_tokens ?? 1024,
      temperature: call.temperature ?? 0.1
    });
    const audit = auditSuccess(context, call, response, traceNumber);
    return { response, trace_number: audit.trace_number, audit_path: audit.audit_path };
  } catch (e) {
    const audit = auditError(context, call, e, traceNumber);
    throw Object.assign(e instanceof Error ? e : new Error(String(e)), {
      trace_number: audit.trace_number,
      audit_path: audit.audit_path
    });
  }
}

async function runCase(suiteId: string, task: SuiteTask, pair: SuitePair, trial: number): Promise<SuiteCaseResult> {
  const started = new Date().toISOString();
  const runId = randomUUID();
  const base: Omit<SuiteCaseResult, 'baseline_text' | 'encoded_braille' | 'decoded_text'> = {
    run_id: runId,
    suite_id: suiteId,
    timestamp: started,
    trial,
    task_id: task.id,
    task_kind: task.kind,
    encoder_model: pair.encoderModel,
    decoder_model: pair.decoderModel,
    original_chars: task.prompt.length,
    baseline_chars: 0,
    braille_cells: 0,
    compression_ratio_vs_baseline: 0,
    compression_ratio_vs_prompt: 0,
    baseline_tokens_in: 0,
    baseline_tokens_out: 0,
    encode_tokens_in: 0,
    encode_tokens_out: 0,
    decode_tokens_in: 0,
    decode_tokens_out: 0,
    baseline_latency_ms: 0,
    encode_latency_ms: 0,
    decode_latency_ms: 0,
    round_trip_latency_ms: 0,
    heuristic_fidelity: 0,
    exact_match: false,
    trace_numbers: {},
    audit_paths: []
  };

  try {
    if (task.kind === 'latex') {
      const latexTraceNumber = makeTraceNumber({
        suite_id: suiteId,
        run_id: runId,
        task_id: task.id,
        task_kind: task.kind,
        trial,
        phase: 'other',
        encoder_model: pair.encoderModel,
        decoder_model: pair.decoderModel
      }, 'latex_roundtrip');
      const latexResults = await runLatexRoundtrip({
        encoderModel: pair.encoderModel,
        decoderModel: pair.decoderModel,
        docIds: [task.id.replace('latex_', '')]
      });
      const lr = latexResults[0];
      if (!lr) throw new Error(`No LaTeX corpus result for ${task.id}`);
      return {
        ...base,
        baseline_text: task.reference || task.prompt,
        encoded_braille: lr.encoded_braille,
        decoded_text: lr.decoded,
        baseline_chars: lr.original_chars,
        braille_cells: lr.braille_cells,
        compression_ratio_vs_baseline: lr.compression_ratio,
        compression_ratio_vs_prompt: lr.compression_ratio,
        encode_latency_ms: lr.encode_latency_ms,
        decode_latency_ms: lr.decode_latency_ms,
        round_trip_latency_ms: lr.encode_latency_ms + lr.decode_latency_ms,
        heuristic_fidelity: lr.fidelity,
        exact_match: lr.original.trim() === lr.decoded.trim(),
        compile_success: lr.decoded_compiles,
        structure_valid: lr.structure_valid,
        trace_numbers: { latex_roundtrip: latexTraceNumber },
        audit_paths: [modelCallAuditPath()]
      };
    }

    const commonContext = {
      suite_id: suiteId,
      run_id: runId,
      task_id: task.id,
      task_kind: task.kind,
      trial,
      encoder_model: pair.encoderModel,
      decoder_model: pair.decoderModel
    };

    const baselineCall = await tracedCall({
      ...commonContext,
      phase: 'baseline'
    }, {
      model: pair.encoderModel,
      messages: [{ role: 'user', content: task.prompt }],
      max_tokens: 512,
      temperature: 0.3
    });
    const baseline = baselineCall.response;

    const encodeCall = await tracedCall({
      ...commonContext,
      phase: 'encode'
    }, {
      model: pair.encoderModel,
      messages: [
        { role: 'system', content: ENCODER_SYSTEM_PROMPT },
        { role: 'user', content: `Encode the following into braille:\n\n${baseline.content}` }
      ],
      max_tokens: 1024,
      temperature: 0.1
    });
    const encodeRes = encodeCall.response;

    const braillePayload = extractBraille(encodeRes.content);
    const decodeCall = await tracedCall({
      ...commonContext,
      phase: 'decode'
    }, {
      model: pair.decoderModel,
      messages: [{ role: 'user', content: makeDecoderUserMessage(braillePayload) }],
      max_tokens: 1024,
      temperature: 0.1
    });
    const decodeRes = decodeCall.response;

    const cells = countBrailleCells(braillePayload);
    const fidelity = jaccardWords(baseline.content, decodeRes.content);

    return {
      ...base,
      baseline_text: baseline.content,
      encoded_braille: braillePayload,
      decoded_text: decodeRes.content,
      baseline_chars: baseline.content.length,
      braille_cells: cells,
      compression_ratio_vs_baseline: cells > 0 ? baseline.content.length / cells : 0,
      compression_ratio_vs_prompt: cells > 0 ? task.prompt.length / cells : 0,
      baseline_tokens_in: baseline.input_tokens || 0,
      baseline_tokens_out: baseline.output_tokens || 0,
      encode_tokens_in: encodeRes.input_tokens || 0,
      encode_tokens_out: encodeRes.output_tokens || 0,
      decode_tokens_in: decodeRes.input_tokens || 0,
      decode_tokens_out: decodeRes.output_tokens || 0,
      baseline_latency_ms: baseline.latency_ms,
      encode_latency_ms: encodeRes.latency_ms,
      decode_latency_ms: decodeRes.latency_ms,
      round_trip_latency_ms: encodeRes.latency_ms + decodeRes.latency_ms,
      heuristic_fidelity: fidelity,
      exact_match: exactNormalizedMatch(baseline.content, decodeRes.content),
      trace_numbers: {
        baseline: baselineCall.trace_number,
        encode: encodeCall.trace_number,
        decode: decodeCall.trace_number
      },
      audit_paths: [...new Set([baselineCall.audit_path, encodeCall.audit_path, decodeCall.audit_path])]
    };
  } catch (e: any) {
    return {
      ...base,
      baseline_text: '',
      encoded_braille: '',
      decoded_text: '',
      trace_numbers: {},
      audit_paths: e.audit_path ? [e.audit_path] : [],
      error: e.message || String(e)
    };
  }
}

async function runSharedCodecCase(suiteId: string, task: SuiteTask, pair: SuitePair, trial: number): Promise<SuiteCaseResult> {
  const runId = randomUUID();
  const started = new Date().toISOString();
  const baselineText = task.reference || task.prompt;
  const codec = encodeSharedCodec(baselineText);

  return {
    run_id: runId,
    suite_id: suiteId,
    timestamp: started,
    trial,
    task_id: task.id,
    task_kind: task.kind,
    encoder_model: pair.encoderModel,
    decoder_model: pair.decoderModel,
    baseline_text: baselineText,
    encoded_braille: codec.encoded,
    decoded_text: codec.decoded,
    original_chars: baselineText.length,
    baseline_chars: baselineText.length,
    braille_cells: codec.encoded_cells,
    compression_ratio_vs_baseline: codec.compression_ratio,
    compression_ratio_vs_prompt: task.prompt.length / codec.encoded_cells,
    baseline_tokens_in: 0,
    baseline_tokens_out: 0,
    encode_tokens_in: 0,
    encode_tokens_out: 0,
    decode_tokens_in: 0,
    decode_tokens_out: 0,
    baseline_latency_ms: 0,
    encode_latency_ms: 0,
    decode_latency_ms: 0,
    round_trip_latency_ms: 0,
    heuristic_fidelity: codec.exact_roundtrip ? 1 : jaccardWords(baselineText, codec.decoded),
    exact_match: codec.exact_roundtrip,
    compile_success: task.kind === 'latex' ? undefined : undefined,
    structure_valid: task.kind === 'latex' ? undefined : undefined,
    trace_numbers: {
      baseline: `BCE-${suiteId}-${runId.slice(0, 8)}-T${String(trial).padStart(2, '0')}-${task.id}-shared-baseline`,
      encode: `BCE-${suiteId}-${runId.slice(0, 8)}-T${String(trial).padStart(2, '0')}-${task.id}-shared-encode`,
      decode: `BCE-${suiteId}-${runId.slice(0, 8)}-T${String(trial).padStart(2, '0')}-${task.id}-shared-decode`
    },
    audit_paths: []
  };
}

function aggregate(cases: SuiteCaseResult[]): SuiteAggregateRow[] {
  const groups = new Map<string, SuiteCaseResult[]>();
  for (const r of cases) {
    const key = `${r.task_kind}||${r.encoder_model}||${r.decoder_model}`;
    groups.set(key, [...(groups.get(key) || []), r]);
  }

  return [...groups.entries()].map(([key, rows]) => {
    const [task_kind, encoder_model, decoder_model] = key.split('||');
    const ok = rows.filter(r => !r.error);
    const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    const latexRows = ok.filter(r => r.task_kind === 'latex');
    const out: SuiteAggregateRow = {
      task_kind,
      encoder_model,
      decoder_model,
      n: rows.length,
      success_rate: ok.length / rows.length,
      avg_compression_vs_baseline: avg(ok.map(r => r.compression_ratio_vs_baseline)),
      avg_compression_vs_prompt: avg(ok.map(r => r.compression_ratio_vs_prompt)),
      avg_fidelity: avg(ok.map(r => r.heuristic_fidelity)),
      avg_round_trip_latency_ms: avg(ok.map(r => r.round_trip_latency_ms)),
      avg_braille_cells: avg(ok.map(r => r.braille_cells)),
      exact_match_rate: ok.length ? ok.filter(r => r.exact_match).length / ok.length : 0
    };
    if (latexRows.length) {
      out.compile_success_rate = latexRows.filter(r => r.compile_success).length / latexRows.length;
    }
    return out;
  }).sort((a, b) => b.avg_fidelity - a.avg_fidelity);
}

function csvEscape(v: any): string {
  const s = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function casesToCsv(rows: SuiteCaseResult[]): string {
  const headers = [
    'suite_id', 'trial', 'task_id', 'task_kind', 'encoder_model', 'decoder_model', 'error',
    'baseline_chars', 'braille_cells', 'compression_ratio_vs_baseline', 'compression_ratio_vs_prompt',
    'heuristic_fidelity', 'exact_match', 'compile_success', 'structure_valid',
    'trace_numbers', 'audit_paths',
    'baseline_tokens_in', 'baseline_tokens_out', 'encode_tokens_in', 'encode_tokens_out', 'decode_tokens_in', 'decode_tokens_out',
    'baseline_latency_ms', 'encode_latency_ms', 'decode_latency_ms', 'round_trip_latency_ms'
  ];
  return [headers.join(','), ...rows.map(r => headers.map(h => csvEscape((r as any)[h])).join(','))].join('\n') + '\n';
}

function aggregatesToCsv(rows: SuiteAggregateRow[]): string {
  const headers = [
    'task_kind', 'encoder_model', 'decoder_model', 'n', 'success_rate', 'avg_compression_vs_baseline',
    'avg_compression_vs_prompt', 'avg_fidelity', 'avg_round_trip_latency_ms', 'avg_braille_cells',
    'exact_match_rate', 'compile_success_rate'
  ];
  return [headers.join(','), ...rows.map(r => headers.map(h => csvEscape((r as any)[h])).join(','))].join('\n') + '\n';
}

export async function runBenchmarkSuite(opts: BenchmarkSuiteOptions = {}): Promise<SuiteRunResult> {
  const suiteId = randomUUID().slice(0, 8);
  const config: Required<BenchmarkSuiteOptions> = {
    pairs: opts.pairs || defaultPairs(opts.maxPairs),
    trials: opts.trials ?? 3,
    taskIds: opts.taskIds || SUITE_TASKS.map(t => t.id),
    includeLatex: opts.includeLatex ?? true,
    maxPairs: opts.maxPairs ?? 0,
    maxConcurrency: opts.maxConcurrency ?? 1,
    judgeModel: opts.judgeModel ?? null,
    codecMode: opts.codecMode ?? 'llm'
  };

  const tasks = SUITE_TASKS.filter(t => config.taskIds.includes(t.id) && (config.includeLatex || t.kind !== 'latex'));
  const cases: SuiteCaseResult[] = [];
  const started = new Date().toISOString();

  console.log(`\n⠿ BENCHMARK SUITE ${suiteId}`);
  console.log(`  pairs=${config.pairs.length}, tasks=${tasks.length}, trials=${config.trials}`);

  for (const pair of config.pairs) {
    for (const task of tasks) {
      for (let trial = 1; trial <= config.trials; trial++) {
        console.log(`  [${trial}/${config.trials}] ${task.id}: ${pair.encoderModel} → ${pair.decoderModel}`);
        const r = config.codecMode === 'shared'
          ? await runSharedCodecCase(suiteId, task, pair, trial)
          : await runCase(suiteId, task, pair, trial);
        cases.push(r);
        if (r.error) {
          console.log(`    ✗ ${r.error}`);
        } else {
          console.log(`    ✓ comp=${r.compression_ratio_vs_baseline.toFixed(2)}x fid=${(r.heuristic_fidelity * 100).toFixed(0)}% cells=${r.braille_cells}`);
        }
      }
    }
  }

  const aggregates = aggregate(cases);
  const finished = new Date().toISOString();
  const stem = `suite-${suiteId}`;
  const files = {
    json: join(RESULTS_DIR, `${stem}.json`),
    jsonl: join(RESULTS_DIR, `${stem}.jsonl`),
    csv: join(RESULTS_DIR, `${stem}.csv`),
    summaryCsv: join(RESULTS_DIR, `${stem}-summary.csv`),
    modelCallAudit: modelCallAuditPath()
  };

  const result: SuiteRunResult = { suite_id: suiteId, started_at: started, finished_at: finished, config, cases, aggregates, files };
  writeFileSync(files.json, JSON.stringify(result, null, 2));
  writeFileSync(files.jsonl, cases.map(r => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(files.csv, casesToCsv(cases));
  writeFileSync(files.summaryCsv, aggregatesToCsv(aggregates));

  console.log(`\n  Saved:`);
  console.log(`    ${files.json}`);
  console.log(`    ${files.csv}`);
  console.log(`    ${files.summaryCsv}\n`);

  return result;
}
