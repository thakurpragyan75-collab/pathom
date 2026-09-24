import { draftFits, modelFits, type Chip, type Model } from "./catalog";
import { emptyCache, flushCold, walk, type CacheState } from "./cache";
import { expertStep, type ExpertStep } from "./experts";
import { chooseDraft, decodeProfile, prefillMs, quoteStep, type Source } from "./governor";
import { promptLookup } from "./pld";
import { chain, extractCalls, type Decision } from "./sandbox";
import { detokenize, hashSeed, mulberry32, tokenize } from "./text";
import { TEAM_PROMPT, type Workload } from "./workloads";

export type PolicyId = "governor" | "mtp4" | "mtp1" | "pld" | "off";

export type Emitted = {
  text: string;
  kind: "accept" | "correct" | "bonus" | "plain";
  source: Source;
};

export type StepTrace = {
  index: number;
  source: Source;
  k: number;
  drafts: string[];
  accepted: string[];
  rejected: string | null;
  corrected: string | null;
  bonus: string | null;
  emitted: Emitted[];
  plannedSpeedup: number;
  realizedSpeedup: number;
  baseMs: number;
  stepMs: number;
  note: string;
  acceptanceUsed: number;
  experts: ExpertStep;
  grammar: boolean;
};

export type Simulation = {
  workloadId: string;
  policy: PolicyId;
  fit: { ok: boolean; reason: string };
  draftResident: boolean;
  promptTokens: number;
  hitTokens: number;
  missTokens: number;
  hits: number;
  misses: number;
  prefill: number;
  steps: StepTrace[];
  text: string;
  tokens: number;
  ms: number;
  tokPerS: number;
  ttftMs: number;
  acceptance: number;
  decisions: Decision[];
  droppedCalls: number;
  cache: CacheState;
  bytesMoved: number;
};

const WRONG = ["maybe", "the", "sail", "model", "token", "depth", "shell"];
const PREFILL_DIV = 28;

function proposeMtp(
  target: string[],
  cursor: number,
  k: number,
  p: number,
  rng: () => number,
): string[] {
  const drafts: string[] = [];
  for (let i = 0; i < k && cursor + i < target.length; i++) {
    if (rng() < p) drafts.push(target[cursor + i]!);
    else drafts.push(WRONG[Math.floor(rng() * WRONG.length)]!);
  }
  return drafts;
}

export function seedCache(hotSlots = 14, bytesPerToken = 48_000): CacheState {
  let cache = emptyCache(hotSlots, bytesPerToken);
  const team = tokenize(TEAM_PROMPT);
  cache = walk(cache, team, "harbor").cache;
  cache = walk(cache, [...team, ...tokenize("Night shift. Keep the answers short.")], "night-shift").cache;
  return flushCold(cache);
}

export function simulate(args: {
  workload: Workload;
  model: Model;
  chip: Chip;
  cache: CacheState;
  policy?: PolicyId;
  concurrency?: number;
  temperature?: number;
  ngram?: number;
  heat?: boolean;
}): Simulation {
  const policy = args.policy ?? "governor";
  const concurrency = args.concurrency ?? 1;
  const temperature = args.temperature ?? 0;
  const ngram = args.ngram ?? 2;
  const heat = args.heat ?? false;
  const fit = modelFits(args.model, args.chip);
  const draftResident = draftFits(args.model, args.chip);
  const prompt = tokenize(args.workload.prompt);
  const target = tokenize(args.workload.target);
  const walked = walk(args.cache, prompt, args.workload.session);
  let cache = flushCold(walked.cache);

  if (!fit.ok) {
    return {
      workloadId: args.workload.id,
      policy,
      fit,
      draftResident,
      promptTokens: prompt.length,
      hitTokens: walked.hitTokens,
      missTokens: walked.missTokens,
      hits: walked.hits,
      misses: walked.misses,
      prefill: 0,
      steps: [],
      text: "",
      tokens: 0,
      ms: 0,
      tokPerS: 0,
      ttftMs: 0,
      acceptance: 0,
      decisions: [],
      droppedCalls: 0,
      cache,
      bytesMoved: 0,
    };
  }

  const profile = decodeProfile(args.model, args.chip, concurrency, prompt.length);
  const prefill = prefillMs(profile.baseMs, walked.missTokens, walked.hitTokens);
  const rng = mulberry32(hashSeed(`${args.workload.id}|${policy}|${args.model.id}|${temperature}`));
  const priors = { ...args.workload.priors };
  const context = prompt.slice();
  const steps: StepTrace[] = [];
  let cursor = 0;
  let ms = prefill;
  let drafted = 0;
  let accepted = 0;
  let bytesMoved = (walked.missTokens * profile.weightBytes) / PREFILL_DIV;

  while (cursor < target.length && steps.length < 80) {
    const pldDrafts = promptLookup(context, ngram, 8);
    const grammar = args.workload.grammar;
    const planned = chooseDraft({
      model: args.model,
      chip: args.chip,
      concurrency,
      ctxTokens: context.length,
      temperature,
      heat,
      grammar,
      draftResident,
      priors,
      pldAvailable: pldDrafts.length,
    });

    let source: Source = planned.source;
    let k = planned.k;
    if (policy === "off") {
      source = "off";
      k = 0;
    } else if (policy === "mtp4" || policy === "mtp1") {
      source = args.model.hasMtp ? "mtp" : "off";
      k = source === "off" ? 0 : policy === "mtp4" ? 4 : 1;
    } else if (policy === "pld") {
      source = pldDrafts.length ? "pld" : "off";
      k = source === "off" ? 0 : Math.min(8, pldDrafts.length);
    }

    const acceptanceUsed =
      source === "pld" ? priors.pld : source === "mtp" ? priors.mtp : source === "draft" ? priors.draft : 1;
    let drafts: string[] = [];
    if (source === "pld") drafts = pldDrafts.slice(0, k);
    if (source === "mtp" || source === "draft") {
      const p = source === "mtp" ? priors.mtp : priors.draft;
      drafts = proposeMtp(target, cursor, k, temperature === 0 ? p : p * Math.exp(-0.85 * temperature), rng);
    }

    const taken: string[] = [];
    let rejected: string | null = null;
    for (const draft of drafts) {
      const truth = target[cursor + taken.length];
      if (truth !== undefined && draft === truth) taken.push(draft);
      else {
        rejected = draft;
        break;
      }
    }
    let corrected: string | null = null;
    let bonus: string | null = null;
    if (source === "off") {
      corrected = target[cursor] ?? null;
    } else if (taken.length === drafts.length && drafts.length > 0 && cursor + taken.length < target.length) {
      bonus = target[cursor + taken.length] ?? null;
    } else if (rejected !== null) {
      corrected = target[cursor + taken.length] ?? null;
    } else if (taken.length === 0) {
      corrected = target[cursor] ?? null;
    }

    const emittedText: Emitted[] = [];
    const stamp = (text: string, kind: Emitted["kind"]) => emittedText.push({ text, kind, source });
    for (const token of taken) stamp(token, "accept");
    if (bonus) stamp(bonus, "bonus");
    if (corrected) stamp(corrected, rejected ? "correct" : "plain");

    const produced = emittedText.map((item) => item.text);
    const quote = quoteStep({
      source,
      k: drafts.length,
      model: args.model,
      chip: args.chip,
      concurrency,
      ctxTokens: context.length,
      acceptance: acceptanceUsed,
      heat,
      draftResident,
    });
    const baseMs = quote?.baseMs ?? profile.baseMs;
    const experts = expertStep({
      model: args.model,
      chip: args.chip,
      token: produced[0] ?? target[cursor] ?? "",
      drafts,
      speculated: source !== "off",
    });
    const stepMs = (quote?.stepMs ?? baseMs) + experts.penaltyMs;
    const realized = produced.length > 0 ? (produced.length * baseMs) / stepMs : 0;
    ms += stepMs;
    drafted += drafts.length;
    accepted += taken.length;
    bytesMoved += profile.weightBytes / Math.max(1, concurrency) + profile.kvBytes;

    if (source === "pld" && drafts.length) priors.pld = priors.pld * 0.6 + (taken.length / drafts.length) * 0.4;
    if (source === "mtp" && drafts.length) priors.mtp = priors.mtp * 0.6 + (taken.length / drafts.length) * 0.4;
    if (source === "draft" && drafts.length) {
      priors.draft = priors.draft * 0.6 + (taken.length / drafts.length) * 0.4;
    }

    steps.push({
      index: steps.length,
      source,
      k: drafts.length,
      drafts,
      accepted: taken,
      rejected,
      corrected,
      bonus,
      emitted: emittedText,
      plannedSpeedup: quote?.speedup ?? 1,
      realizedSpeedup: realized,
      baseMs,
      stepMs,
      note: policy === "governor" ? planned.note : `Forced ${policy}. The governor is not steering.`,
      acceptanceUsed,
      experts,
      grammar,
    });

    context.push(...produced);
    cursor += produced.length;
    if (produced.length === 0) break;
  }

  const text = detokenize(steps.flatMap((step) => step.emitted.map((item) => item.text)));
  const extracted = args.workload.grammar ? extractCalls(text) : { calls: [], dropped: 0 };
  const decisions = chain(extracted.calls);
  const tokens = steps.reduce((sum, step) => sum + step.emitted.length, 0);
  const genMs = Math.max(0.01, ms - prefill);
  cache = walk(cache, context, args.workload.session).cache;
  const ttftMs = prefill * (1 + 0.4 * (concurrency - 1)) + (steps[0]?.stepMs ?? 0);

  return {
    workloadId: args.workload.id,
    policy,
    fit,
    draftResident,
    promptTokens: prompt.length,
    hitTokens: walked.hitTokens,
    missTokens: walked.missTokens,
    hits: walked.hits,
    misses: walked.misses,
    prefill,
    steps,
    text,
    tokens,
    ms,
    tokPerS: tokens > 0 ? tokens / (genMs / 1000) : 0,
    ttftMs,
    acceptance: drafted > 0 ? accepted / drafted : 0,
    decisions,
    droppedCalls: extracted.dropped,
    cache: flushCold(cache),
    bytesMoved,
  };
}

export type BenchCell = {
  workload: string;
  policy: PolicyId;
  tokPerS: number;
  ttftMs: number;
  acceptance: number;
  ms: number;
  tokens: number;
};

export function benchmark(args: {
  workloads: Workload[];
  model: Model;
  chip: Chip;
  cache: CacheState;
  concurrency: number;
  temperature: number;
  ngram: number;
  heat: boolean;
}): BenchCell[] {
  const policies: PolicyId[] = ["governor", "mtp4", "mtp1", "pld", "off"];
  const cells: BenchCell[] = [];
  for (const workload of args.workloads) {
    for (const policy of policies) {
      const run = simulate({
        workload,
        model: args.model,
        chip: args.chip,
        cache: args.cache,
        policy,
        concurrency: args.concurrency,
        temperature: args.temperature,
        ngram: args.ngram,
        heat: args.heat,
      });
      cells.push({
        workload: workload.label,
        policy,
        tokPerS: run.tokPerS,
        ttftMs: run.ttftMs,
        acceptance: run.acceptance,
        ms: run.ms,
        tokens: run.tokens,
      });
    }
  }
  return cells;
}
