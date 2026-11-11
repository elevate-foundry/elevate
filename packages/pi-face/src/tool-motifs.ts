export type ToolMotif = "hammer" | "lens" | "pencil" | "network" | "gear";

/** Total deterministic quotient from arbitrary tool names into the visual vocabulary. */
export function motifForTool(toolName = ""): ToolMotif {
  const name = toolName.toLowerCase();
  if (/(^|[_.-])(bash|shell|exec|terminal|command)([_.-]|$)/.test(name) || name === "bash") return "hammer";
  if (/(read|search|grep|find|list|whyline|inspect|fetch)/.test(name)) return "lens";
  if (/(edit|write|patch|replace|format)/.test(name)) return "pencil";
  if (/(parallel|multi|codemode|dispatch|batch)/.test(name)) return "network";
  if (/(jev|judge|judgment|classify|score|evaluate)/.test(name)) return "gear";
  return "gear";
}
