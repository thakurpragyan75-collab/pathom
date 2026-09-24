export function tokenize(text: string): string[] {
  const out: string[] = [];
  const re = /[A-Za-z0-9_]+|[^\sA-Za-z0-9_]|\n+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) out.push(match[0]);
  return out;
}

export function detokenize(tokens: string[]): string {
  let text = "";
  for (const token of tokens) {
    if (!text || token.startsWith("\n")) {
      text += token;
      continue;
    }
    const prev = text[text.length - 1] ?? "";
    const word = /^[A-Za-z0-9_]+$/.test(token);
    const prevWord = /[A-Za-z0-9_]$/.test(text);
    const sentence = word && /[.!?]/.test(prev) && /^[A-Z]/.test(token);
    const comma = prev === "," || prev === ";";
    const brace = token === "{" && prev === ")";
    const afterParen = word && prev === ")";
    if ((word && prevWord) || sentence || comma || brace || afterParen) text += ` ${token}`;
    else text += token;
  }
  return text;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}
