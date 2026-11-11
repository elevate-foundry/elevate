import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const AUDIT_DIR = join(ROOT, 'audit');
const DATA_DIR = join(ROOT, 'data');
const NDJSON_PATH = join(DATA_DIR, 'model-calls.ndjson');
const SQL_PATH = join(DATA_DIR, 'load-audit.sql');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

function collectJsonl(): string[] {
  if (!existsSync(AUDIT_DIR)) return [];
  const files = readdirSync(AUDIT_DIR).filter(f => f.startsWith('model-calls-') && f.endsWith('.jsonl'));
  const lines: string[] = [];
  for (const file of files) {
    const full = join(AUDIT_DIR, file);
    for (const line of readFileSync(full, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      JSON.parse(line);
      lines.push(line);
    }
  }
  return lines;
}

const lines = collectJsonl();
writeFileSync(NDJSON_PATH, lines.join('\n') + (lines.length ? '\n' : ''));
writeFileSync(SQL_PATH, `
CREATE OR REPLACE TABLE api_model_calls AS
SELECT * FROM read_json_auto('${NDJSON_PATH.replace(/'/g, "''")}', format='newline_delimited');

CREATE OR REPLACE VIEW api_model_call_summary AS
SELECT
  provider,
  model,
  role,
  COUNT(*) AS calls,
  SUM(CASE WHEN error IS NULL THEN 1 ELSE 0 END) AS successes,
  SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS errors,
  AVG(latency_ms) AS avg_latency_ms,
  SUM(COALESCE(input_tokens, 0)) AS input_tokens,
  SUM(COALESCE(output_tokens, 0)) AS output_tokens
FROM api_model_calls
GROUP BY provider, model, role
ORDER BY calls DESC;

CREATE OR REPLACE VIEW api_model_call_recent AS
SELECT timestamp, trace_number, provider, model, role, task_id, latency_ms, error
FROM api_model_calls
ORDER BY timestamp DESC
LIMIT 50;
`);

console.log(JSON.stringify({
  rows: lines.length,
  ndjson: NDJSON_PATH,
  sql: SQL_PATH,
  command: `duckdb data/audit.duckdb < data/load-audit.sql`
}, null, 2));
