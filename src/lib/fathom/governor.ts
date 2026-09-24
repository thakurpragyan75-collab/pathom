import { COST, DRAFT, type Chip, type Model, weightBytes } from "./catalog";

export type Source = "off" | "pld" | "mtp" | "draft";

export type CostBreakdown = {
  source: Source;
  k: number;
  baseMs: number;
  weightMs: number;
  kvMs: number;
  draftMs: number;
  verifyMs: number;
  stepMs: number;
  expectedTokens: number;
  speedup: number;
  acceptance: number;
};

export function bandwidthPartMs(bytes: number, chip: Chip): number {
  const effective = chip.bandwidthGBs * 1e9 * COST.peakEfficiency;
  return (bytes / effective) * 1000;
}

export function decodeProfile(model: Model, chip: Chip, concurrency: number, ctxTokens: number) {
  const conc = Math.max(1, concurrency);
  let weights = weightBytes(model.activeB, model.bpw);
  if (model.kind === "moe") weights *= COST.moeGather;
  const kvBytes = (model.kvMBPerK * 1_000_000 * ctxTokens) / 1000;
  const weightMs = bandwidthPartMs(weights, chip);
  const kvMs = bandwidthPartMs(kvBytes, chip);
  const queue = 1 + 0.012 * (conc - 1);
  const baseMs = (weightMs + kvMs) * queue + COST.hostMs;
  return { weightMs, kvMs, baseMs, weightBytes: weights, kvBytes };
}

function verifyMultiplier(k: number, heat: boolean): number {
  if (k <= 0) return 1;
  const quad = COST.verifyQuad * (heat ? 1.35 : 1);
  return 1 + COST.verifyLinear * k + (quad * k * (k - 1)) / 2;
}

export function expectedTokens(p: number, k: number): number {
  if (k <= 0) return 1;
  const accept = Math.min(0.98, Math.max(0.01, p));
  return (1 - accept ** (k + 1)) / (1 - accept);
}

export function cooledAcceptance(prior: number, temperature: number, grammar: boolean): number {
  let p = prior * Math.exp(-COST.tempDecay * temperature);
  if (grammar) p = 1 - (1 - p) * COST.grammarMissScale;
  return Math.min(0.97, Math.max(0.02, p));
}

export function quoteStep(args: {
  source: Source;
  k: number;
  model: Model;
  chip: Chip;
  concurrency: number;
  ctxTokens: number;
  acceptance: number;
  heat: boolean;
  draftResident: boolean;
}): CostBreakdown | null {
  if (args.source === "draft" && !args.draftResident) return null;
  if (args.source === "mtp" && !args.model.hasMtp) return null;
  const profile = decodeProfile(args.model, args.chip, args.concurrency, args.ctxTokens);
  const k = args.source === "off" ? 0 : args.k;
  const bwOnly = profile.weightMs + profile.kvMs;
  let draftMs = 0;
  if (args.source === "mtp") draftMs = k * (bwOnly * COST.mtpLayer + COST.mtpLaunchMs);
  if (args.source === "draft") {
    const draftBytes = weightBytes(DRAFT.activeB, DRAFT.bpw);
    draftMs = k * (bandwidthPartMs(draftBytes, args.chip) + COST.mtpLaunchMs);
  }
  if (args.source === "pld") draftMs = COST.pldMs * Math.max(1, k);
  let verifyMs =
    args.source === "off" ? profile.baseMs : bwOnly * verifyMultiplier(k, args.heat) + COST.hostMs;
  if (args.source !== "off") {
    const contention = 1 + 0.045 * (Math.max(1, args.concurrency) - 1);
    draftMs *= contention;
    verifyMs *= contention;
  }
  const stepMs = args.source === "off" ? profile.baseMs : draftMs + verifyMs;
  const expected = expectedTokens(args.acceptance, k);
  const speedup = (expected * profile.baseMs) / stepMs;
  return {
    source: args.source,
    k,
    baseMs: profile.baseMs,
    weightMs: profile.weightMs,
    kvMs: profile.kvMs,
    draftMs,
    verifyMs,
    stepMs,
    expectedTokens: expected,
    speedup,
    acceptance: args.acceptance,
  };
}

export type Choice = CostBreakdown & { note: string };

export function chooseDraft(args: {
  model: Model;
  chip: Chip;
  concurrency: number;
  ctxTokens: number;
  temperature: number;
  heat: boolean;
  grammar: boolean;
  draftResident: boolean;
  priors: Record<Exclude<Source, "off">, number>;
  pldAvailable: number;
}): Choice {
  const floor = args.heat ? COST.heatMinSpeedup : COST.minSpeedup;
  const maxK = args.heat ? 1 : 8;
  const candidates: CostBreakdown[] = [];
  const base = quoteStep({
    source: "off",
    k: 0,
    model: args.model,
    chip: args.chip,
    concurrency: args.concurrency,
    ctxTokens: args.ctxTokens,
    acceptance: 1,
    heat: args.heat,
    draftResident: args.draftResident,
  });
  if (base) candidates.push(base);

  const consider = (source: Exclude<Source, "off">, k: number, available: boolean) => {
    if (!available || k < 1 || k > maxK) return;
    const acceptance = cooledAcceptance(args.priors[source], args.temperature, args.grammar);
    const quote = quoteStep({
      source,
      k,
      model: args.model,
      chip: args.chip,
      concurrency: args.concurrency,
      ctxTokens: args.ctxTokens,
      acceptance,
      heat: args.heat,
      draftResident: args.draftResident,
    });
    if (quote) candidates.push(quote);
  };

  for (const k of [1, 2, 4, 6, 8]) consider("pld", Math.min(k, args.pldAvailable), args.pldAvailable > 0);
  for (const k of [1, 2, 3]) consider("mtp", k, args.model.hasMtp);
  for (const k of [1, 2, 4]) consider("draft", k, args.draftResident);

  let best = candidates[0]!;
  for (const candidate of candidates) {
    const viable = candidate.source === "off" || candidate.speedup >= floor;
    const bestViable = best.source === "off" || best.speedup >= floor;
    if (viable && !bestViable) best = candidate;
    else if (viable && bestViable && candidate.speedup > best.speedup + 0.01) best = candidate;
  }

  let note = "Baseline decode. Speculation does not clear the bar.";
  if (best.source !== "off") {
    note = `${best.source.toUpperCase()} ×${best.k} planned ${best.speedup.toFixed(2)}× on acceptance ${best.acceptance.toFixed(2)}.`;
  } else if (args.heat) {
    note = "Heat soak raised the bar. Only a clearer win would speculate.";
  } else if (args.temperature > 0.4) {
    note = "Temperature flattened the target. Rejection sampling would waste the verify.";
  }
  return { ...best, note };
}

export function prefillMs(baseMs: number, missTokens: number, hitTokens: number): number {
  const compute = (missTokens * Math.max(0.05, baseMs - COST.hostMs)) / COST.prefillReuse;
  const hits = hitTokens * 0.004;
  return compute + hits;
}
