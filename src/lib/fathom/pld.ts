/** Prompt-lookup drafting: copy the span that followed the last matching n-gram in context. */

export function promptLookup(tokens: string[], n: number, k: number): string[] {
  if (n < 1 || k < 1 || tokens.length <= n) return [];
  const startNeedle = tokens.length - n;
  let best = -1;
  for (let i = 0; i < startNeedle; i++) {
    let matched = true;
    for (let j = 0; j < n; j++) {
      if (tokens[i + j] !== tokens[startNeedle + j]) {
        matched = false;
        break;
      }
    }
    if (matched) best = i;
  }
  if (best < 0) return [];
  const from = best + n;
  const drafts: string[] = [];
  for (let i = 0; i < k && from + i < tokens.length; i++) drafts.push(tokens[from + i]!);
  return drafts;
}
