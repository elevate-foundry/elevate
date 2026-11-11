import { decodeSharedCodec, encodeSharedCodec, SHARED_CODEC, sharedCodecStats, type SharedCodecEntry } from './shared-codec.js';

export type CerebrailleDomain = SharedCodecEntry['category'] | 'agent_state' | 'tool_protocol' | 'mixed';
export type FidelityMode = 'lossless' | 'semantic';

export interface CerebrailleSymbol extends SharedCodecEntry {
  codepoint: string;
  dotPattern: number;
  version: string;
}

export interface CerebrailleEncodeResult {
  original: string;
  encoded: string;
  decoded: string;
  domain: CerebrailleDomain;
  fidelityMode: FidelityMode;
  originalChars: number;
  encodedCells: number;
  compressionRatio: number;
  exactRoundtrip: boolean;
  matchedEntries: Array<{ cell: string; codepoint: string; expansion: string; count: number }>;
  codebookVersion: string;
}

export interface CerebrailleDecodeResult {
  encoded: string;
  decoded: string;
  encodedCells: number;
  codebookVersion: string;
}

export interface CerebrailleCodebook {
  version: string;
  symbols: CerebrailleSymbol[];
  stats: ReturnType<typeof sharedCodecStats>;
}

export interface CerebrailleTrainingDescriptor {
  backend: 'pytorch';
  sequenceShape: 'llama_autoregressive';
  vocabularySize: number;
  objective: string;
  inputs: string[];
  outputs: string[];
  losses: string[];
}

export interface FrontierToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const CODEBOOK_VERSION = 'cerebraille-shared-v0';

function codepoint(cell: string): string {
  const value = cell.codePointAt(0);
  if (value === undefined) return '';
  return `U+${value.toString(16).toUpperCase().padStart(4, '0')}`;
}

function dotPattern(cell: string): number {
  const value = cell.codePointAt(0);
  return value === undefined ? 0 : value - 0x2800;
}

function toSymbol(entry: SharedCodecEntry): CerebrailleSymbol {
  return {
    ...entry,
    codepoint: codepoint(entry.cell),
    dotPattern: dotPattern(entry.cell),
    version: CODEBOOK_VERSION
  };
}

export function getCerebrailleCodebook(domain?: CerebrailleDomain): CerebrailleCodebook {
  const symbols = SHARED_CODEC
    .filter(entry => !domain || domain === 'mixed' || entry.category === domain)
    .map(toSymbol);

  return {
    version: CODEBOOK_VERSION,
    symbols,
    stats: sharedCodecStats()
  };
}

export function lookupSymbol(input: { cell?: string; codepoint?: string }): CerebrailleSymbol | null {
  const normalizedCodepoint = input.codepoint?.toUpperCase();
  const entry = SHARED_CODEC.find(candidate => {
    return candidate.cell === input.cell || codepoint(candidate.cell) === normalizedCodepoint;
  });
  return entry ? toSymbol(entry) : null;
}

export function encodeCerebraille(input: { text: string; domain?: CerebrailleDomain; fidelityMode?: FidelityMode }): CerebrailleEncodeResult {
  const domain = input.domain || 'mixed';
  const fidelityMode = input.fidelityMode || 'lossless';
  const encoded = encodeSharedCodec(input.text);

  return {
    original: input.text,
    encoded: encoded.encoded,
    decoded: encoded.decoded,
    domain,
    fidelityMode,
    originalChars: encoded.original_chars,
    encodedCells: encoded.encoded_cells,
    compressionRatio: encoded.compression_ratio,
    exactRoundtrip: encoded.exact_roundtrip,
    matchedEntries: encoded.matched_entries.map(entry => ({
      ...entry,
      codepoint: codepoint(entry.cell)
    })),
    codebookVersion: CODEBOOK_VERSION
  };
}

export function decodeCerebraille(input: { encoded: string }): CerebrailleDecodeResult {
  const decoded = decodeSharedCodec(input.encoded);
  return {
    encoded: input.encoded,
    decoded,
    encodedCells: [...input.encoded].length,
    codebookVersion: CODEBOOK_VERSION
  };
}

export function trainingDescriptor(): CerebrailleTrainingDescriptor {
  return {
    backend: 'pytorch',
    sequenceShape: 'llama_autoregressive',
    vocabularySize: 256,
    objective: 'minimize encoded sequence length while preserving lossless structure and semantic fidelity',
    inputs: ['source_text', 'domain', 'codebook_version', 'fidelity_mode'],
    outputs: ['braille_sequence', 'decoded_text', 'round_trip_score'],
    losses: ['reconstruction_loss', 'semantic_divergence', 'latency_penalty', 'codebook_allocation_cost']
  };
}

export function frontierToolSchemas(): FrontierToolSchema[] {
  return [
    {
      name: 'lookupSymbol',
      description: 'Look up a Cerebraille codebook entry by braille cell or Unicode codepoint.',
      input_schema: {
        type: 'object',
        properties: {
          cell: { type: 'string' },
          codepoint: { type: 'string' }
        }
      }
    },
    {
      name: 'encode',
      description: 'Encode source text into a Cerebraille braille stream using the shared codebook.',
      input_schema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          domain: { type: 'string', enum: ['latex', 'prose', 'code', 'structured', 'control', 'agent_state', 'tool_protocol', 'mixed'] },
          fidelityMode: { type: 'string', enum: ['lossless', 'semantic'] }
        },
        required: ['text']
      }
    },
    {
      name: 'decode',
      description: 'Decode a Cerebraille braille stream back into text using the shared codebook.',
      input_schema: {
        type: 'object',
        properties: {
          encoded: { type: 'string' }
        },
        required: ['encoded']
      }
    }
  ];
}
