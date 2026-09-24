import { moeResidentFraction, type Chip, type Model } from "./catalog";

export function residencyCount(model: Model, chip: Chip): number {
  if (model.experts <= 0) return 0;
  return Math.max(1, Math.round(moeResidentFraction(model, chip) * model.experts));
}

export function routeExperts(token: string, count: number, k: number): number[] {
  if (count <= 0 || k <= 0) return [];
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) hash = Math.imul(hash ^ token.charCodeAt(i), 16777619);
  const picked: number[] = [];
  let guard = 0;
  while (picked.length < k && guard < k + 6) {
    hash = Math.imul(hash ^ (guard + 17), 16777619);
    const id = (hash >>> 0) % count;
    if (!picked.includes(id)) picked.push(id);
    guard += 1;
  }
  return picked;
}

export function expertBytes(model: Model): number {
  if (model.experts <= 0) return 0;
  return (model.weightGB * 0.92 * 1e9) / model.experts;
}

export type ExpertStep = {
  used: number[];
  prefetched: number[];
  missed: number[];
  penaltyMs: number;
  resident: number;
};

export function expertStep(args: {
  model: Model;
  chip: Chip;
  token: string;
  drafts: string[];
  speculated: boolean;
}): ExpertStep {
  const resident = residencyCount(args.model, args.chip);
  if (args.model.experts <= 0) {
    return { used: [], prefetched: [], missed: [], penaltyMs: 0, resident: 0 };
  }
  const used = routeExperts(args.token, args.model.experts, args.model.topK);
  const predicted = new Set<number>();
  if (args.speculated) {
    for (const draft of args.drafts) {
      for (const id of routeExperts(draft, args.model.experts, args.model.topK)) {
        if (predicted.size < 4) predicted.add(id);
      }
    }
  }
  const prefetched = [...predicted].filter((id) => id >= resident);
  const missed = used.filter((id) => id >= resident && !predicted.has(id));
  const bytes = expertBytes(args.model);
  const penaltyMs = missed.length * (bytes / (args.chip.ssdGBs * 1e9)) * 1000;
  return { used, prefetched, missed, penaltyMs, resident };
}
