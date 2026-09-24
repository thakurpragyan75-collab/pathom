import { WORKLOADS, workloadById, type WorkloadId } from "../../lib/fathom/workloads";
import type { PolicyId, Simulation } from "../../lib/fathom/simulate";
import { Choice, Eyebrow, Stat, cx, fmt } from "./ui";

const POLICIES: { id: PolicyId; label: string }[] = [
  { id: "governor", label: "Governor" },
  { id: "pld", label: "Lookup" },
  { id: "mtp1", label: "MTP \u00d71" },
  { id: "mtp4", label: "MTP \u00d74" },
  { id: "off", label: "Off" },
];

export function Floor(props: {
  workloadId: WorkloadId;
  policy: PolicyId;
  concurrency: number;
  temperature: number;
  ngram: number;
  heat: boolean;
  fitOk: boolean;
  sim: Simulation | null;
  cursor: number;
  onWorkload: (id: WorkloadId) => void;
  onPolicy: (id: PolicyId) => void;
  onConcurrency: (n: number) => void;
  onTemperature: (n: number) => void;
  onNgram: (n: number) => void;
  onHeat: (v: boolean) => void;
  onRun: () => void;
  onStep: () => void;
  onPickStep: (index: number) => void;
}) {
  const workload = workloadById(props.workloadId);
  const shown = props.sim?.steps.slice(0, props.cursor) ?? [];
  const tokens = shown.reduce((sum, step) => sum + step.emitted.length, 0);
  const genMs = shown.reduce((sum, step) => sum + step.stepMs, 0);
  const tokPerS = tokens > 0 ? tokens / (genMs / 1000) : 0;
  const drafted = shown.reduce((sum, step) => sum + step.drafts.length, 0);
  const accepted = shown.reduce((sum, step) => sum + step.accepted.length, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-4">
      <div className="grid gap-4 lg:col-span-3">
        <div className="flex flex-wrap gap-2">
          {WORKLOADS.map((item) => (
            <Choice key={item.id} active={item.id === props.workloadId} onClick={() => props.onWorkload(item.id)}>
              {item.label}
            </Choice>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!props.fitOk}
            onClick={props.onRun}
            className="min-h-11 bg-brass px-5 font-mono text-xs tracking-widest text-ink uppercase disabled:opacity-40"
          >
            Run
          </button>
          <button
            type="button"
            onClick={props.onStep}
            disabled={!props.sim}
            className="min-h-11 border border-line px-4 font-mono text-xs tracking-widest text-bone uppercase disabled:opacity-40"
          >
            One step
          </button>
          <button
            type="button"
            onClick={() => props.onHeat(!props.heat)}
            className={cx(
              "min-h-11 border px-4 font-mono text-xs tracking-widest uppercase",
              props.heat ? "border-rust text-rust" : "border-line text-bone-dim",
            )}
          >
            {props.heat ? "Heat soak on" : "Heat soak"}
          </button>
        </div>
        <p className="text-sm leading-6 text-bone-dim">{workload.kicker}</p>
        <pre className="overflow-x-auto whitespace-pre-wrap border border-line bg-panel p-4 font-mono text-xs leading-6 text-bone-dim">
          {workload.prompt}
        </pre>
        <div className="flex flex-wrap gap-2">
          {POLICIES.map((item) => (
            <Choice key={item.id} active={item.id === props.policy} onClick={() => props.onPolicy(item.id)}>
              {item.label}
            </Choice>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Picker label="Batch" value={String(props.concurrency)} options={["1", "2", "4", "8", "16"]} onPick={(v) => props.onConcurrency(Number(v))} />
          <Picker label="Temp" value={props.temperature.toFixed(1)} options={["0.0", "0.3", "0.7", "1.0"]} onPick={(v) => props.onTemperature(Number(v))} />
          <Picker label="n-gram" value={String(props.ngram)} options={["2", "3", "4"]} onPick={(v) => props.onNgram(Number(v))} />
        </div>
        {!props.fitOk ? <p className="text-sm text-rust">This checkpoint does not fit. The run stays refused.</p> : null}
        <div className="min-h-32 border border-line bg-ink-2 p-4">
          <Eyebrow>Emitted</Eyebrow>
          <div className="mt-3 flex flex-wrap gap-1">
            {shown.length === 0 ? (
              <p className="text-sm text-bone-dim">Nothing emitted yet. Echo is the clearest first run.</p>
            ) : (
              shown.flatMap((step) => {
                const nodes = [];
                if (step.rejected) {
                  nodes.push(
                    <span key={`${step.index}-rej`} className="border border-rust px-1.5 py-0.5 font-mono text-sm text-rust line-through">
                      {step.rejected}
                    </span>,
                  );
                }
                for (const [index, token] of step.emitted.entries()) {
                  if (token.text.startsWith("\n")) {
                    nodes.push(<span key={`${step.index}-${index}-br`} className="h-2 basis-full" />);
                    continue;
                  }
                  nodes.push(
                    <span
                      key={`${step.index}-${index}`}
                      className={cx(
                        "border px-1.5 py-0.5 font-mono text-sm",
                        token.kind === "accept" && "border-brass text-brass",
                        token.kind === "bonus" && "border-brass bg-brass text-ink",
                        token.kind === "correct" && "border-rust text-bone",
                        token.kind === "plain" && "border-line text-bone",
                      )}
                    >
                      {token.text}
                    </span>,
                  );
                }
                return nodes;
              })
            )}
          </div>
        </div>
      </div>
      <aside className="grid content-start gap-3">
        <Stat label="Tok / s" value={tokens ? fmt(tokPerS, 1) : "\u2014"} hint="Cost model, not a device measurement." />
        <Stat
          label="TTFT"
          value={props.sim ? `${fmt(props.sim.ttftMs, 0)} ms` : "\u2014"}
          hint={props.sim ? `${props.sim.hitTokens} cached / ${props.sim.missTokens} prefilled` : "Prefix hits skip prefill."}
        />
        <Stat label="Accepted" value={drafted ? fmt(accepted / drafted, 2) : "\u2014"} hint={shown.at(-1)?.note ?? "The governor writes the reason on each step."} />
        <div className="border border-line bg-panel p-3">
          <Eyebrow>Steps</Eyebrow>
          <ol className="mt-2 grid max-h-80 gap-1 overflow-auto">
            {(props.sim?.steps ?? []).map((step) => (
              <li key={step.index}>
                <button
                  type="button"
                  onClick={() => props.onPickStep(step.index + 1)}
                  className={cx(
                    "flex min-h-11 w-full items-center justify-between gap-3 border px-2 font-mono text-xs",
                    step.index < props.cursor ? "border-line text-bone" : "border-transparent text-bone-dim",
                  )}
                >
                  <span>
                    {String(step.index + 1).padStart(2, "0")} {step.source}
                    {step.k ? ` \u00d7${step.k}` : ""}
                  </span>
                  <span className="tabular-nums">{fmt(step.realizedSpeedup, 2)}\u00d7</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}

export function Picker({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: string;
  options: string[];
  onPick: (value: string) => void;
}) {
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-2 flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-label={`${label} ${option}`}
            onClick={() => onPick(option)}
            className={cx(
              "min-h-11 min-w-11 border px-2 font-mono text-xs tabular-nums",
              option === value ? "border-brass text-brass" : "border-line text-bone-dim",
            )}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
