/**
 * LaTeX-specific braille protocol
 *
 * Hypothesis: LaTeX is ~40% structural boilerplate (\section, \begin{}, \frac...)
 * that compresses to single braille cells. With a SHARED seed codebook, the
 * round-trip should be LOSSLESS and RECOMPILABLE — not just semantically close.
 *
 * Strategy:
 *   - Structural commands  → single high-range braille cells (dots 7-8 set)
 *   - Prose text           → letter-by-letter standard braille (lossless 1:1)
 *   - Net: compression on structure, perfect fidelity on content
 */

import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// --- Seed codebook: LaTeX construct → braille cell ---
// Uses U+28C0–U+28FF and U+2840–U+289F (dots 7/8) to avoid colliding with
// the standard a-z letter cells used for prose spelling.
export const LATEX_SEED_CODEBOOK: Array<{ cell: string; meaning: string }> = [
  // Document skeleton
  { cell: '⣍', meaning: '\\documentclass{article}' },
  { cell: '⣏', meaning: '\\usepackage{' },
  { cell: '⣃', meaning: '\\begin{document}' },
  { cell: '⣉', meaning: '\\end{document}' },
  { cell: '⣜', meaning: '\\maketitle' },
  { cell: '⣝', meaning: '\\title{' },
  { cell: '⣞', meaning: '\\author{' },
  { cell: '⣟', meaning: '\\begin{abstract}' },
  { cell: '⢟', meaning: '\\end{abstract}' },
  // Sectioning
  { cell: '⣎', meaning: '\\section{' },
  { cell: '⣄', meaning: '\\subsection{' },
  { cell: '⣅', meaning: '\\subsubsection{' },
  { cell: '⣆', meaning: '\\paragraph{' },
  // Math environments
  { cell: '⣊', meaning: '\\begin{equation}' },
  { cell: '⣋', meaning: '\\end{equation}' },
  { cell: '⢊', meaning: '\\begin{align}' },
  { cell: '⢋', meaning: '\\end{align}' },
  { cell: '⡩', meaning: '$' },                 // inline math toggle
  { cell: '⣖', meaning: '\\frac{' },
  { cell: '⣷', meaning: '\\sum' },
  { cell: '⣯', meaning: '\\int' },
  { cell: '⣙', meaning: '\\sqrt{' },
  { cell: '⣚', meaning: '\\alpha' },
  { cell: '⣛', meaning: '\\beta' },
  { cell: '⡾', meaning: '\\partial' },
  { cell: '⢽', meaning: '\\nabla' },
  { cell: '⢘', meaning: '_{' },                // subscript group
  { cell: '⢙', meaning: '^{' },                // superscript group
  { cell: '⠿', meaning: '=' },                 // math operators (common gap)
  { cell: '⠶', meaning: '+' },
  { cell: '⡢', meaning: '-' },
  { cell: '⡰', meaning: '\\cdot' },
  // Lists
  { cell: '⣈', meaning: '\\begin{itemize}' },
  { cell: '⣇', meaning: '\\end{itemize}' },
  { cell: '⢈', meaning: '\\begin{enumerate}' },
  { cell: '⢇', meaning: '\\end{enumerate}' },
  { cell: '⣀', meaning: '\\item ' },
  // Formatting
  { cell: '⣔', meaning: '\\textbf{' },
  { cell: '⣕', meaning: '\\textit{' },
  { cell: '⣒', meaning: '\\ref{' },
  { cell: '⣓', meaning: '\\label{' },
  { cell: '⣌', meaning: '\\cite{' },
  { cell: '⢔', meaning: '\\emph{' },
  // Braces & special chars
  { cell: '⡻', meaning: '{' },
  { cell: '⡳', meaning: '}' },
  { cell: '⡹', meaning: '\\\\' },              // line break
  { cell: '⡷', meaning: '&' },
  { cell: '⡗', meaning: '\\\n' },              // command-terminating newline
  { cell: '⠀', meaning: ' ' },                 // space separator (blank braille)
];

// --- Test corpus: progressively complex LaTeX documents ---
export const LATEX_CORPUS: Array<{ id: string; src: string }> = [
  {
    id: 'minimal',
    src: `\\documentclass{article}
\\begin{document}
Hello world.
\\end{document}`
  },
  {
    id: 'sectioned',
    src: `\\documentclass{article}
\\begin{document}
\\section{Introduction}
This is the first section.
\\section{Methods}
We describe the approach here.
\\end{document}`
  },
  {
    id: 'with-math',
    src: `\\documentclass{article}
\\begin{document}
\\section{Theory}
Let $x$ be a variable. The ratio is $r = \\frac{a}{b}$.
\\begin{equation}
E = mc^{2}
\\end{equation}
\\end{document}`
  },
  {
    id: 'full-paper',
    src: `\\documentclass{article}
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
  },
];

// --- Structural validation (cheap, no compiler needed) ---
export function validateLatexStructure(src: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Brace balance
  let depth = 0;
  for (const ch of src) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth < 0) { errors.push('Unbalanced closing brace'); break; }
  }
  if (depth > 0) errors.push(`${depth} unclosed brace(s)`);

  // begin/end matching
  const begins = [...src.matchAll(/\\begin\{(\w+)\}/g)].map(m => m[1]);
  const ends = [...src.matchAll(/\\end\{(\w+)\}/g)].map(m => m[1]);
  for (const env of begins) {
    if (!ends.includes(env)) errors.push(`\\begin{${env}} without matching \\end`);
  }

  // Math delimiter balance ($ count even)
  const dollarCount = (src.match(/(?<!\\)\$/g) || []).length;
  if (dollarCount % 2 !== 0) errors.push('Unbalanced $ math delimiters');

  // Must have document environment
  if (!src.includes('\\begin{document}')) errors.push('Missing \\begin{document}');
  if (!src.includes('\\end{document}')) errors.push('Missing \\end{document}');

  return { valid: errors.length === 0, errors };
}

// --- Real compilation check via pdflatex ---
export async function compileLatex(src: string): Promise<{ compiles: boolean; log: string }> {
  const PDFLATEX = '/Library/TeX/texbin/pdflatex';
  if (!existsSync(PDFLATEX)) {
    return { compiles: false, log: 'pdflatex not found' };
  }

  const dir = mkdtempSync(join(tmpdir(), 'brl-latex-'));
  const texPath = join(dir, 'doc.tex');
  writeFileSync(texPath, src);

  try {
    await execFileAsync(
      PDFLATEX,
      ['-interaction=nonstopmode', '-halt-on-error', '-output-directory', dir, texPath],
      { timeout: 20000 }
    );
    const pdfExists = existsSync(join(dir, 'doc.pdf'));
    return { compiles: pdfExists, log: pdfExists ? 'OK' : 'No PDF produced' };
  } catch (e: any) {
    // pdflatex exits non-zero on error; extract the error line from stdout
    const out = (e.stdout || '') + (e.stderr || '');
    const errLine = out.split('\n').find((l: string) => l.startsWith('!')) || 'Compilation failed';
    return { compiles: false, log: errLine.slice(0, 200) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- Lossless-oriented fidelity: how much of the original is recoverable ---
export function scoreLatexFidelity(original: string, decoded: string): number {
  // Normalize whitespace for comparison
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const o = norm(original);
  const d = norm(decoded);
  if (o === d) return 1.0;

  // Token-level overlap on LaTeX commands + words
  const tokenize = (s: string) => s.match(/\\[a-zA-Z]+|\{|\}|\$|[a-zA-Z0-9]+/g) || [];
  const oTokens = tokenize(o);
  const dTokens = tokenize(d);
  if (oTokens.length === 0) return 0;

  // Longest-common-subsequence ratio (order matters for LaTeX)
  const lcs = lcsLength(oTokens, dTokens);
  return lcs / oTokens.length;
}

function lcsLength(a: string[], b: string[]): number {
  const m = a.length, n = b.length;
  const dp: number[] = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    let prev = 0;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}
