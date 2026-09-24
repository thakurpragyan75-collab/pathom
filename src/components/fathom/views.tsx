import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { forceFlush, forkSession, treeRows, withSlots, type CacheState } from "../../lib/fathom/cache";
import { COST } from "../../lib/fathom/catalog";
import { judge, POLICY, type ToolName } from "../../lib/fathom/sandbox";
import { benchmark, type PolicyId, type Simulation } from "../../lib/fathom/simulate";
import { tokenize } from "../../lib/fathom/text";
import { TEAM_PROMPT } from "../../lib/fathom/workloads";
import { Picker } from "./floor";
import { Choice, Eyebrow, Stat, cx, fmt } from "./ui";

export function Radix({
  cache,
  onSlots,
  onFlush,
  onFork,
}: {
  cache: CacheState;
  onSlots: (slots: number) => void;
  onFlush: () => void;
  onFork: () => void;
}) {
  const rows = useMemo(() => treeRows(cache), [cache]);
  const hotBytes = Object.values(cache.blocks)
    .filter((block) => block.tier === "hot")
    .reduce((sum, block) => sum + block.bytes, 0);
  const coldBytes = Object.values(cache.blocks)
    .filter((block) => block.tier === "cold")
    .reduce((sum, block) => sum + block.bytes, 0);
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Hot" value={`${cache.hot.length} blk`} hint={`${fmt(hotBytes / 1e6, 1)} MB KV estimate`} />
        <Stat label="Cold" value={`${fmt(coldBytes / 1e6, 1)} MB`} hint="Same hash if another chat shares the prefix." />
        <Stat label="Write-behind" value={String(cache.coldQueue.length)} hint="Evictions queue. They do not stall the step." />
      </div>
      <p className="max-w-2xl text-sm leading-6 text-bone-dim">
        Blocks are hashed with their parent. Two sessions only share a node when the tokens match. A shared cache
        is a timing side channel if you ever put two users on one machine.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Picker label="Hot slots" value={String(cache.hotSlots)} options={["8", "14", "24"]} onPick={(v) => onSlots(Number(v))} />
        <button type="button" onClick={onFork} className="min-h-11 border border-line px-4 font-mono text-xs tracking-widest uppercase">
          Fork a turn
        </button>
        <button type="button" onClick={onFlush} className="min-h-11 border border-line px-4 font-mono text-xs tracking-widest uppercase">
          Flush cold queue
        </button>
      </div>
      <div className="border border-line">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-bone-dim">Cache is empty.</p>
        ) : (
          <ul>
            {rows.map((row) => (
              <li key={row.hash} className="border-t border-line px-3 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-xs text-brass">
                    {"\u00b7".repeat(row.depth)}
                    {row.hash.slice(0, 4)}
                    <span className="text-bone-dim">
                      {" "}
                      {row.tier}
                      {row.shared ? " shared" : ""}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-bone-dim">{row.hits} hits</span>
                </div>
                <p className="mt-1 truncate font-mono text-xs text-bone">{row.text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function Experts(props: {
  chipName: string;
  modelName: string;
  experts: number;
  resident: number;
  topK: number;
  sim: Simulation | null;
  cursor: number;
  onRunMoe: () => void;
}) {
  const step = props.sim?.steps[Math.max(0, props.cursor - 1)];
  const cells = props.experts > 0 ? Array.from({ length: props.experts }, (_, id) => id) : [];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg">Expert residency</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-bone-dim">
            {props.chipName}. {props.modelName}. A MoE decode is scattered reads. If the drafter names the next
            experts, those pages can move while the target verifies.
          </p>
        </div>
        <button type="button" onClick={props.onRunMoe} className="min-h-11 bg-brass px-4 font-mono text-xs tracking-widest text-ink uppercase">
          Run MoE brief
        </button>
      </div>
      {props.experts === 0 ? (
        <p className="border border-line p-4 text-sm text-bone-dim">This checkpoint is dense. Switch to Qwen3.6 35B-A3B, or run the MoE brief.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Resident" value={`${props.resident}/${props.experts}`} hint="Packed low ids. A stand-in layout." />
            <Stat label="Prefetched" value={String(step?.experts.prefetched.length ?? 0)} hint="Only when the step actually speculated." />
            <Stat label="Miss" value={`${fmt(step?.experts.penaltyMs ?? 0, 1)} ms`} hint="SSD penalty on this step. Assumed drive." />
          </div>
          <div className="grid grid-cols-8 gap-1">
            {cells.map((id) => {
              const used = step?.experts.used.includes(id);
              const prefetched = step?.experts.prefetched.includes(id);
              const missed = step?.experts.missed.includes(id);
              const resident = id < props.resident;
              return (
                <div
                  key={id}
                  title={`expert ${id}`}
                  className={cx(
                    "flex h-11 items-center justify-center border font-mono text-xs tabular-nums",
                    missed && "border-rust text-rust",
                    used && !missed && "border-brass bg-brass text-ink",
                    !used && prefetched && "border-brass text-brass",
                    !used && !prefetched && resident && "border-line text-bone-dim",
                    !used && !prefetched && !resident && "border-line bg-ink-2 text-bone-dim",
                  )}
                >
                  {id}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function Sandbox({
  decisions,
  dropped,
  onRun,
}: {
  decisions: Simulation["decisions"];
  dropped: number;
  onRun: () => void;
}) {
  const [name, setName] = useState<ToolName>("read_file");
  const [path, setPath] = useState("/repo/src/governor.ts");
  const [url, setUrl] = useState("https://example.com/weights");
  const [trial, setTrial] = useState(judge({ name: "read_file", path: "/repo/src/governor.ts" }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="border border-line p-4">
        <Eyebrow>Manifest</Eyebrow>
        <ul className="mt-3 grid gap-2 font-mono text-xs leading-6 text-bone">
          <li>read {POLICY.readRoots.join(", ")}</li>
          <li>write {POLICY.writeRoots.join(", ")}</li>
          <li>net {POLICY.allowNet ? "granted" : "closed"}</li>
          <li>
            cpu {POLICY.maxCpuMs} ms \u00b7 rss {POLICY.maxRssMb} MB
          </li>
          <li>shell never</li>
        </ul>
        <button type="button" onClick={onRun} className="mt-4 min-h-11 bg-brass px-4 font-mono text-xs tracking-widest text-ink uppercase">
          Run the tool tape
        </button>
        <ol className="mt-4 grid gap-3">
          {decisions.length === 0 ? (
            <li className="text-sm text-bone-dim">No judged calls from the tape yet.</li>
          ) : (
            decisions.map((decision) => (
              <li key={decision.audit} className="border border-line p-3">
                <p className={cx("font-mono text-xs", decision.allow ? "text-brass" : "text-rust")}>
                  {decision.allow ? "Allow" : "Deny"} \u00b7 {decision.call.name}
                </p>
                <p className="mt-1 text-sm leading-6">{decision.reason}</p>
                <p className="mt-1 font-mono text-xs text-bone-dim">
                  {decision.prev.slice(0, 8)} \u2192 {decision.audit}
                </p>
              </li>
            ))
          )}
          {dropped > 0 ? <li className="text-sm text-rust">{dropped} span(s) dropped. Nothing ran.</li> : null}
        </ol>
      </section>
      <section className="border border-line p-4">
        <Eyebrow>Try a call</Eyebrow>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["read_file", "write_file", "fetch_url", "shell"] as ToolName[]).map((tool) => (
            <Choice
              key={tool}
              active={name === tool}
              onClick={() => {
                setName(tool);
                setTrial(judge({ name: tool, path, url }));
              }}
            >
              {tool}
            </Choice>
          ))}
        </div>
        <label className="mt-4 block">
          <Eyebrow>Path</Eyebrow>
          <input value={path} onChange={(e) => setPath(e.target.value)} className="mt-2 min-h-11 w-full border border-line bg-ink px-3 font-mono text-sm" />
        </label>
        <label className="mt-3 block">
          <Eyebrow>URL</Eyebrow>
          <input value={url} onChange={(e) => setUrl(e.target.value)} className="mt-2 min-h-11 w-full border border-line bg-ink px-3 font-mono text-sm" />
        </label>
        <button
          type="button"
          onClick={() => setTrial(judge({ name, path, url }))}
          className="mt-4 min-h-11 border border-brass px-4 font-mono text-xs tracking-widest text-brass uppercase"
        >
          Judge
        </button>
        <p className={cx("mt-4 font-mono text-sm", trial.allow ? "text-brass" : "text-rust")}>{trial.allow ? "Allow" : "Deny"}</p>
        <p className="mt-1 text-sm leading-6">{trial.reason}</p>
        <p className="mt-2 font-mono text-xs text-bone-dim">audit {trial.audit}</p>
      </section>
    </div>
  );
}

export function Bench({ rows, onRun }: { rows: ReturnType<typeof benchmark> | null; onRun: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const chart = useMemo(() => {
    if (!rows) return [];
    const names = [...new Set(rows.map((row) => row.workload))];
    return names.map((name) => {
      const point: Record<string, string | number> = { workload: name };
      for (const row of rows) {
        if (row.workload === name) point[row.policy] = Number(row.tokPerS.toFixed(1));
      }
      return point;
    });
  }, [rows]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-sm leading-6 text-bone-dim">
          Same prompts, five policies. Governor is allowed to decline. MTP \u00d74 is the CUDA habit that loses on this
          bandwidth model. Figures are the cost model \u2014 publish a device script before quoting them as speed.
        </p>
        <button type="button" onClick={onRun} className="min-h-11 bg-brass px-4 font-mono text-xs tracking-widest text-ink uppercase">
          Run the bench
        </button>
      </div>
      {rows && mounted ? (
        <div className="h-72 border border-line bg-ink p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
              <XAxis dataKey="workload" stroke="var(--color-bone-dim)" fontSize={12} />
              <YAxis stroke="var(--color-bone-dim)" fontSize={12} />
              <Tooltip
                contentStyle={{
                  background: "var(--color-panel)",
                  border: "1px solid var(--color-line)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="governor" fill="var(--color-brass)" />
              <Bar dataKey="mtp1" fill="var(--color-bone)" />
              <Bar dataKey="mtp4" fill="var(--color-rust)" />
              <Bar dataKey="pld" fill="var(--color-bone-dim)" />
              <Bar dataKey="off" fill="var(--color-line)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      {rows ? (
        <div className="overflow-x-auto border border-line">
          <table className="w-full text-left font-mono text-xs">
            <thead className="text-bone-dim">
              <tr>
                {["Workload", "Governor", "MTP \u00d71", "MTP \u00d74", "Lookup", "Off"].map((head) => (
                  <th key={head} className="border-b border-line px-3 py-3 font-medium">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...new Set(rows.map((row) => row.workload))].map((name) => {
                const cell = (policy: PolicyId) => rows.find((row) => row.workload === name && row.policy === policy);
                return (
                  <tr key={name} className="border-t border-line">
                    <td className="px-3 py-3">{name}</td>
                    {(["governor", "mtp1", "mtp4", "pld", "off"] as PolicyId[]).map((policy) => (
                      <td key={policy} className="px-3 py-3 tabular-nums">
                        {fmt(cell(policy)?.tokPerS ?? 0, 1)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function Ledger() {
  return (
    <article className="grid max-w-3xl gap-6 text-sm leading-6">
      <p>
        Pathom is a control plane, not a kernel. It does not outrun oMLX\u2019s Metal kernels or vllm-metal\u2019s paged
        batch. Those projects already did the matmul. What they still leave on the table is the decision.
      </p>
      <section className="border border-line p-4 font-mono text-xs leading-6">
        <p>t_decode = weights / (bandwidth \u00d7 {COST.peakEfficiency}) + KV + {COST.hostMs} ms</p>
        <p>
          t_verify(K) = t_bw \u00d7 (1 + {COST.verifyLinear}K + {COST.verifyQuad}K(K\u22121)/2) \u00d7 batch contention
        </p>
        <p>speculate when E[tokens] \u00d7 t_decode / t_step \u2265 {COST.minSpeedup}</p>
        <p>under heat soak the bar rises to {COST.heatMinSpeedup} and K caps at 1</p>
      </section>
      <p className="text-bone-dim">
        Deliberately absent: a claim that unified memory \u201cbypasses\u201d a copy that was never there, a tok/s number
        with no script, and a shell that runs model text at hardware speed.
      </p>
    </article>
  );
}

export function forkHarbor(cache: CacheState) {
  return forkSession(cache, tokenize(TEAM_PROMPT), `fork-${cache.clock}`, 2).cache;
}

export function resizeHot(cache: CacheState, slots: number) {
  return withSlots(cache, slots);
}

export function flushHot(cache: CacheState) {
  return forceFlush(cache);
}
