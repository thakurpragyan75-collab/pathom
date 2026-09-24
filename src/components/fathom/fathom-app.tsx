import { useEffect, useState } from "react";
import { BookOpen, Gauge, Grid3x3, Shield, Waypoints } from "lucide-react";
import {
  CHIPS,
  MODELS,
  chipById,
  draftFits,
  modelById,
  modelFits,
} from "../../lib/fathom/catalog";
import { residencyCount } from "../../lib/fathom/experts";
import { benchmark, seedCache, simulate, type PolicyId, type Simulation } from "../../lib/fathom/simulate";
import type { CacheState } from "../../lib/fathom/cache";
import { WORKLOADS, workloadById, type WorkloadId } from "../../lib/fathom/workloads";
import { Floor } from "./floor";
import { Bench, Experts, Ledger, Radix, Sandbox, flushHot, forkHarbor, resizeHot } from "./views";
import { cx } from "./ui";

type View = "floor" | "radix" | "experts" | "sandbox" | "bench" | "ledger";

const VIEWS: { id: View; label: string; icon: typeof Gauge }[] = [
  { id: "floor", label: "Floor", icon: Gauge },
  { id: "radix", label: "Radix", icon: Waypoints },
  { id: "experts", label: "Experts", icon: Grid3x3 },
  { id: "sandbox", label: "Sandbox", icon: Shield },
  { id: "bench", label: "Bench", icon: Gauge },
  { id: "ledger", label: "Ledger", icon: BookOpen },
];

export function FathomApp() {
  const [view, setView] = useState<View>("floor");
  const [chipId, setChipId] = useState("m4-max-128");
  const [modelId, setModelId] = useState("qwen36-27b");
  const [concurrency, setConcurrency] = useState(1);
  const [temperature, setTemperature] = useState(0);
  const [ngram, setNgram] = useState(2);
  const [heat, setHeat] = useState(false);
  const [policy, setPolicy] = useState<PolicyId>("governor");
  const [workloadId, setWorkloadId] = useState<WorkloadId>("echo");
  const [cache, setCache] = useState<CacheState>(() => seedCache());
  const [sim, setSim] = useState<Simulation | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [benchRows, setBenchRows] = useState<ReturnType<typeof benchmark> | null>(null);

  const chip = chipById(chipId);
  const model = modelById(modelId);
  const fit = modelFits(model, chip);
  const residentDraft = draftFits(model, chip);

  useEffect(() => {
    if (!playing || !sim) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCursor(sim.steps.length);
      setPlaying(false);
      return;
    }
    const timer = window.setInterval(() => {
      setCursor((current) => {
        if (current >= sim.steps.length) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 380);
    return () => window.clearInterval(timer);
  }, [playing, sim]);

  function run(nextWorkload = workloadId, nextPolicy = policy, nextView: View = "floor") {
    const result = simulate({
      workload: workloadById(nextWorkload),
      model,
      chip,
      cache,
      policy: nextPolicy,
      concurrency,
      temperature,
      ngram,
      heat,
    });
    setWorkloadId(nextWorkload);
    setPolicy(nextPolicy);
    setSim(result);
    if (result.fit.ok) setCache(result.cache);
    setCursor(result.steps.length ? 1 : 0);
    setPlaying(result.steps.length > 1);
    setView(nextView);
  }

  return (
    <main className="min-h-screen bg-ink text-bone">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3">
              <svg viewBox="0 0 48 16" className="h-4 w-12 text-brass" aria-hidden>
                <path d="M1 8.5h46M24 1.5v10" stroke="currentColor" strokeWidth="1.6" fill="none" />
              </svg>
              <h1 className="font-mono text-lg tracking-widest">PATHOM</h1>
            </div>
            <p className="mt-2 text-lg leading-7">Speculate only when the bandwidth pays.</p>
            <p className="mt-1 text-sm leading-6 text-bone-dim">
              oMLX has Lightning MTP. vllm-metal pages KV and drafts n-grams. Pathom is the step that
              refuses when the draft would make the Mac slower.
            </p>
          </div>
          <div className="grid gap-3">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {CHIPS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setChipId(item.id)}
                  className={cx(
                    "min-h-11 shrink-0 border px-3 font-mono text-xs",
                    item.id === chipId ? "border-brass bg-brass text-ink" : "border-line text-bone",
                  )}
                >
                  {item.name} \u00b7 {item.memoryGB} GB \u00b7 {item.bandwidthGBs} GB/s
                </button>
              ))}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {MODELS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setModelId(item.id)}
                  className={cx(
                    "min-h-11 shrink-0 border px-3 font-mono text-xs",
                    item.id === modelId ? "border-brass bg-brass text-ink" : "border-line text-bone",
                  )}
                >
                  {item.name} \u00b7 {item.quant}
                </button>
              ))}
            </div>
            <p className="text-xs leading-5 text-bone-dim">
              {fit.reason} {residentDraft ? "0.8B drafter fits." : "0.8B drafter does not fit."} SSD rates are assumed.
            </p>
          </div>
        </div>
      </header>

      <nav className="border-b border-line" aria-label="Sections">
        <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-3 sm:px-6">
          {VIEWS.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setView(item.id)}
                className={cx(
                  "inline-flex min-h-11 shrink-0 items-center gap-2 border px-3 font-mono text-xs tracking-widest uppercase",
                  active ? "border-brass text-brass" : "border-line text-bone-dim",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {view === "floor" ? (
          <Floor
            workloadId={workloadId}
            policy={policy}
            concurrency={concurrency}
            temperature={temperature}
            ngram={ngram}
            heat={heat}
            fitOk={fit.ok}
            sim={sim}
            cursor={cursor}
            onWorkload={setWorkloadId}
            onPolicy={setPolicy}
            onConcurrency={setConcurrency}
            onTemperature={setTemperature}
            onNgram={setNgram}
            onHeat={setHeat}
            onRun={() => run()}
            onStep={() => {
              setPlaying(false);
              setCursor((current) => Math.min(sim?.steps.length ?? 0, current + 1));
            }}
            onPickStep={(index) => {
              setPlaying(false);
              setCursor(index);
            }}
          />
        ) : null}
        {view === "radix" ? (
          <Radix
            cache={cache}
            onSlots={(slots) => setCache(resizeHot(cache, slots))}
            onFlush={() => setCache(flushHot(cache))}
            onFork={() => setCache(forkHarbor(cache))}
          />
        ) : null}
        {view === "experts" ? (
          <Experts
            chipName={`${chip.name} ${chip.memoryGB} GB`}
            modelName={model.name}
            experts={model.experts}
            resident={residencyCount(model, chip)}
            topK={model.topK}
            sim={sim}
            cursor={cursor}
            onRunMoe={() => {
              setModelId("qwen36-a3b");
              run("brief", policy, "experts");
            }}
          />
        ) : null}
        {view === "sandbox" ? (
          <Sandbox
            decisions={sim?.workloadId === "tool" ? sim.decisions : []}
            dropped={sim?.workloadId === "tool" ? sim.droppedCalls : 0}
            onRun={() => run("tool", "governor", "sandbox")}
          />
        ) : null}
        {view === "bench" ? (
          <Bench
            rows={benchRows}
            onRun={() =>
              setBenchRows(
                benchmark({
                  workloads: WORKLOADS,
                  model,
                  chip,
                  cache: seedCache(cache.hotSlots, cache.bytesPerToken),
                  concurrency,
                  temperature,
                  ngram,
                  heat,
                }),
              )
            }
          />
        ) : null}
        {view === "ledger" ? <Ledger /> : null}
      </div>
    </main>
  );
}
