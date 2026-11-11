import { LATEX_CORPUS, validateLatexStructure, compileLatex } from '../src/latex.js';

for (const doc of LATEX_CORPUS) {
  const struct = validateLatexStructure(doc.src);
  const compile = await compileLatex(doc.src);
  console.log(`[${doc.id}] structure=${struct.valid ? 'OK' : struct.errors.join('; ')} compiles=${compile.compiles ? 'YES' : 'NO (' + compile.log + ')'}`);
}
