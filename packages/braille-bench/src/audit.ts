// NOTE: The canonical shared audit implementation lives at libs/audit/typescript/.
// This local copy is kept for backward compatibility and benchmark-specific trace
// numbers. New code should use `import { AuditLog } from '@elevate/audit'` instead.

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createHash, randomUUID } from 'crypto';
import type { ModelResponse } from './providers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const AUDIT_DIR = join(__dirname, '..', 'audit');
const RAW_DIR = join(__dirname, '..', 'results', 'raw');
if (!existsSync(AUDIT_DIR)) mkdirSync(AUDIT_DIR, { recursive: true });
if (!existsSync(RAW_DIR)) mkdirSync(RAW_DIR, { recursive: true });

export interface ModelCallTraceContext {
  suite_id?: string;
  run_id?: string;
  task_id?: string;
  task_kind?: string;
  trial?: number;
  phase: 'baseline' | 'encode' | 'decode' | 'judge' | 'latex_encode' | 'latex_decode' | 'other';
  encoder_model?: string;
  decoder_model?: string;
}

export interface TraceableModelCall {
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
}

export interface ModelCallAuditEvent {
  run_id: string;
  trace_id: string;
  trace_number: string;
  timestamp: string;
  provider: string;
  model: string;
  role: string;
  phase: string;
  task_id?: string;
  task_kind?: string;
  trial?: number;
  input_hash: string;
  input_redacted: string;
  output_hash: string | null;
  output_redacted: string | null;
  raw_input_path: string;
  raw_output_path: string | null;
  input_tokens?: number;
  output_tokens?: number;
  latency_ms?: number;
  cost_estimate: number | null;
  error: string | null;
}

export function makeTraceNumber(parts: ModelCallTraceContext, phase: string): string {
  const suite = parts.suite_id || 'nosuite';
  const run = parts.run_id || randomUUID().slice(0, 8);
  const trial = parts.trial ? `T${String(parts.trial).padStart(2, '0')}` : 'T00';
  const task = parts.task_id || 'notask';
  const seq = randomUUID().slice(0, 8).toUpperCase();
  return `BCE-${suite}-${run.slice(0, 8)}-${trial}-${task}-${phase}-${seq}`;
}

export function modelCallAuditPath(date = new Date()): string {
  const day = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  return join(AUDIT_DIR, `model-calls-${day}.jsonl`);
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function redactContent(s: string): string {
  const compact = s.replace(/\s+/g, ' ').trim();
  return compact.length > 500 ? `${compact.slice(0, 500)}…[truncated:${compact.length}]` : compact;
}

function inferProvider(model: string): string {
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gemini-')) return 'google';
  if (model.startsWith('gpt-')) return 'openai';
  if (model.includes('/')) return 'openrouter';
  return 'unknown';
}

function roleFromPhase(phase: string): string {
  if (phase.includes('encode')) return 'encoder';
  if (phase.includes('decode')) return 'decoder';
  if (phase === 'judge') return 'judge';
  return phase;
}

function rawPath(traceNumber: string, side: 'input' | 'output'): string {
  return join(RAW_DIR, `${traceNumber}-${side}.json`);
}

function serializeInput(call: TraceableModelCall): string {
  return JSON.stringify({
    model: call.model,
    messages: call.messages,
    max_tokens: call.max_tokens,
    temperature: call.temperature
  }, null, 2);
}

function serializeOutput(response: ModelResponse): string {
  return JSON.stringify(response, null, 2);
}

export function appendModelCallAudit(event: ModelCallAuditEvent): string {
  const path = modelCallAuditPath();
  appendFileSync(path, JSON.stringify(event) + '\n');
  return path;
}

export function auditSuccess(
  context: ModelCallTraceContext,
  call: TraceableModelCall,
  response: ModelResponse,
  traceNumber = makeTraceNumber(context, context.phase)
): { trace_number: string; audit_path: string } {
  const input = serializeInput(call);
  const output = serializeOutput(response);
  const inputPath = rawPath(traceNumber, 'input');
  const outputPath = rawPath(traceNumber, 'output');
  writeFileSync(inputPath, input);
  writeFileSync(outputPath, output);
  const event: ModelCallAuditEvent = {
    run_id: context.suite_id ? `suite-${context.suite_id}` : 'unspecified',
    trace_id: randomUUID(),
    trace_number: traceNumber,
    timestamp: new Date().toISOString(),
    provider: inferProvider(call.model),
    model: call.model,
    role: roleFromPhase(context.phase),
    phase: context.phase,
    task_id: context.task_id,
    task_kind: context.task_kind,
    trial: context.trial,
    input_hash: sha256(input),
    input_redacted: redactContent(input),
    output_hash: sha256(output),
    output_redacted: redactContent(response.content),
    raw_input_path: inputPath,
    raw_output_path: outputPath,
    input_tokens: response.input_tokens,
    output_tokens: response.output_tokens,
    latency_ms: response.latency_ms,
    cost_estimate: null,
    error: null
  };
  return { trace_number: traceNumber, audit_path: appendModelCallAudit(event) };
}

export function auditError(
  context: ModelCallTraceContext,
  call: TraceableModelCall,
  error: unknown,
  traceNumber = makeTraceNumber(context, context.phase)
): { trace_number: string; audit_path: string } {
  const input = serializeInput(call);
  const inputPath = rawPath(traceNumber, 'input');
  writeFileSync(inputPath, input);
  const event: ModelCallAuditEvent = {
    run_id: context.suite_id ? `suite-${context.suite_id}` : 'unspecified',
    trace_id: randomUUID(),
    trace_number: traceNumber,
    timestamp: new Date().toISOString(),
    provider: inferProvider(call.model),
    model: call.model,
    role: roleFromPhase(context.phase),
    phase: context.phase,
    task_id: context.task_id,
    task_kind: context.task_kind,
    trial: context.trial,
    input_hash: sha256(input),
    input_redacted: redactContent(input),
    output_hash: null,
    output_redacted: null,
    raw_input_path: inputPath,
    raw_output_path: null,
    cost_estimate: null,
    error: error instanceof Error ? error.message : String(error)
  };
  return { trace_number: traceNumber, audit_path: appendModelCallAudit(event) };
}
