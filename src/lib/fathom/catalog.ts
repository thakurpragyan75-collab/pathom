/** Published peak bandwidths (Apple spec sheets). SSD figures are assumptions, labeled as such. */

export type Chip = {
  id: string;
  name: string;
  memoryGB: number;
  bandwidthGBs: number;
  ssdGBs: number;
  form: "laptop" | "studio";
  note: string;
};

export type ModelKind = "dense" | "moe";

export type Model = {
  id: string;
  name: string;
  quant: string;
  kind: ModelKind;
  paramsB: number;
  activeB: number;
  bpw: number;
  weightGB: number;
  hasMtp: boolean;
  experts: number;
  topK: number;
  kvMBPerK: number;
};

export const CHIPS: Chip[] = [
  {
    id: "m4-16",
    name: "M4",
    memoryGB: 16,
    bandwidthGBs: 120,
    ssdGBs: 3.5,
    form: "laptop",
    note: "16 GB unified. A 27B 4-bit weight stack does not fit beside the OS.",
  },
  {
    id: "m4-pro-24",
    name: "M4 Pro",
    memoryGB: 24,
    bandwidthGBs: 273,
    ssdGBs: 5,
    form: "laptop",
    note: "24 GB. 27B 4-bit is tight — a resident 0.8B drafter usually does not fit.",
  },
  {
    id: "m4-pro-48",
    name: "M4 Pro",
    memoryGB: 48,
    bandwidthGBs: 273,
    ssdGBs: 5.5,
    form: "laptop",
    note: "48 GB. Target, MTP head, and a small drafter can stay resident together.",
  },
  {
    id: "m4-max-128",
    name: "M4 Max",
    memoryGB: 128,
    bandwidthGBs: 546,
    ssdGBs: 7,
    form: "laptop",
    note: "128 GB, 546 GB/s peak. Still a laptop: sustained load will soak.",
  },
  {
    id: "m3-ultra-192",
    name: "M3 Ultra",
    memoryGB: 192,
    bandwidthGBs: 800,
    ssdGBs: 7,
    form: "studio",
    note: "192 GB, 800 GB/s peak. Studio thermals. MoE experts fit in RAM.",
  },
];

export const MODELS: Model[] = [
  {
    id: "qwen36-27b",
    name: "Qwen3.6 27B",
    quant: "4-bit",
    kind: "dense",
    paramsB: 27,
    activeB: 27,
    bpw: 4.2,
    weightGB: 15.8,
    hasMtp: true,
    experts: 0,
    topK: 0,
    kvMBPerK: 48,
  },
  {
    id: "qwen36-a3b",
    name: "Qwen3.6 35B-A3B",
    quant: "4-bit",
    kind: "moe",
    paramsB: 35,
    activeB: 3.2,
    bpw: 4.2,
    weightGB: 19.4,
    hasMtp: true,
    experts: 64,
    topK: 2,
    kvMBPerK: 28,
  },
  {
    id: "gemma4-e4b",
    name: "Gemma 4 E4B",
    quant: "4-bit",
    kind: "dense",
    paramsB: 4.5,
    activeB: 4.5,
    bpw: 4.5,
    weightGB: 3.1,
    hasMtp: true,
    experts: 0,
    topK: 0,
    kvMBPerK: 16,
  },
];

export const DRAFT = {
  name: "family 0.8B drafter",
  weightGB: 0.55,
  activeB: 0.8,
  bpw: 4.5,
};

export const RESERVE_GB = 6.5;
export const MTP_HEAD_GB = 0.35;

/**
 * Constants shared by the cost model and the ledger.
 * Verify cost is superlinear in K because Metal does not treat extra
 * positions as free the way a CUDA tensor core does (mlx-optiq, May 2026:
 * MTP K=1 won and K=4 fell to about 0.74× on M4 Pro).
 */
export const COST = {
  peakEfficiency: 0.68,
  hostMs: 0.35,
  verifyLinear: 0.15,
  verifyQuad: 0.16,
  mtpLayer: 0.07,
  mtpLaunchMs: 0.05,
  pldMs: 0.04,
  minSpeedup: 1.04,
  heatMinSpeedup: 1.22,
  moeGather: 3.4,
  prefillReuse: 28,
  grammarMissScale: 0.4,
  tempDecay: 0.85,
} as const;

export function chipById(id: string): Chip {
  return CHIPS.find((c) => c.id === id) ?? CHIPS[3]!;
}

export function modelById(id: string): Model {
  return MODELS.find((m) => m.id === id) ?? MODELS[0]!;
}

export function weightBytes(activeB: number, bpw: number): number {
  return activeB * 1e9 * (bpw / 8);
}

export function moeResidentFraction(model: Model, chip: Chip): number {
  if (model.kind !== "moe") return 1;
  const avail = chip.memoryGB - RESERVE_GB - 0.8;
  return Math.max(0.12, Math.min(1, avail / model.weightGB));
}

export function residentWeightGB(model: Model, chip: Chip): number {
  return model.weightGB * moeResidentFraction(model, chip);
}

export function modelFits(model: Model, chip: Chip): { ok: boolean; reason: string } {
  if (model.kind === "moe") {
    const trunk = model.weightGB * 0.12 + RESERVE_GB;
    if (trunk < chip.memoryGB) {
      const pct = Math.round(moeResidentFraction(model, chip) * 100);
      return {
        ok: true,
        reason:
          pct >= 100
            ? "Every expert fits in unified memory. Prefetch stays idle."
            : `About ${pct}% of experts stay resident. The rest page from SSD, which is the miss the drafter can hide.`,
      };
    }
    return {
      ok: false,
      reason: `${model.name} cannot keep even its attention trunk in ${chip.memoryGB} GB.`,
    };
  }
  const need = model.weightGB + RESERVE_GB + 0.6;
  if (need < chip.memoryGB) {
    return {
      ok: true,
      reason: `${model.weightGB.toFixed(1)} GB weights + ${RESERVE_GB} GB reserve fit in ${chip.memoryGB} GB.`,
    };
  }
  return {
    ok: false,
    reason: `${model.name} wants about ${need.toFixed(1)} GB with the OS reserve. ${chip.name} ${chip.memoryGB} GB does not have it.`,
  };
}

export function draftFits(model: Model, chip: Chip): boolean {
  const kv = Math.min(2.5, Math.max(0.4, chip.memoryGB * 0.08));
  const used = residentWeightGB(model, chip) + RESERVE_GB + MTP_HEAD_GB + kv + DRAFT.weightGB;
  return used < chip.memoryGB;
}
