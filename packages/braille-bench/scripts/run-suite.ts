import { runBenchmarkSuite } from '../src/benchmark-suite.js';

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const [k, v = 'true'] = arg.replace(/^--/, '').split('=');
  args.set(k, v);
}

const trials = Number(args.get('trials') || 1);
const maxPairs = args.has('max-pairs') ? Number(args.get('max-pairs')) : undefined;
const includeLatex = args.get('include-latex') !== 'false';
const taskIds = args.get('tasks')?.split(',').filter(Boolean);
const codecMode = (args.get('codec') || 'llm') as 'llm' | 'shared';
const pairs = args.get('pairs')?.split(',').filter(Boolean).map(pair => {
  const [encoderModel, decoderModel] = pair.split('::');
  if (!encoderModel || !decoderModel) {
    throw new Error(`Invalid --pairs entry: ${pair}. Use encoder::decoder`);
  }
  return { encoderModel, decoderModel };
});

const result = await runBenchmarkSuite({ pairs, trials, maxPairs, includeLatex, taskIds, codecMode });
console.log(JSON.stringify({
  suite_id: result.suite_id,
  cases: result.cases.length,
  aggregates: result.aggregates.length,
  files: result.files
}, null, 2));
