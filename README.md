# PATHOM

```
speculate only when the bandwidth pays
──────────────────────────────────────
a control plane for Apple Silicon decode
not another mlx-lm wrapper
```

[![selfcheck](https://img.shields.io/badge/selfcheck-governor%20invariants-e2a23a?style=flat-square)](#30-second-start)
[![license](https://img.shields.io/badge/license-MIT-14120e?style=flat-square)](LICENSE)
[![status](https://img.shields.io/badge/kernels-upstream-6e5424?style=flat-square)](#what-this-is-not)

**Repo:** [thakurpragyan75-collab/pathom](https://github.com/thakurpragyan75-collab/pathom)

Pathom is a speculation *governor*. It does not replace [mlx-lm](https://github.com/ml-explore/mlx-lm), [oMLX](https://github.com/jundot/omlx), or [vllm-metal](https://vllm.ai/blog/2026-09-22-vllm-metal-v0-28-0). Those already generate. Pathom decides, **token by token**, whether a draft is about to make the Mac slower — and refuses.

```
                         content-addressed KV
                    ┌─────────────────────────┐
   prompt ─────────►│  radix / Merkle blocks   │── shared prefixes
                    │  parent hash + tokens    │── COW forks
                    │  hot LRU · cold queue    │── write-behind
                    └────────────┬─────────────┘
                                 │
                    ┌───────────┴────────────┐
                    │         GOVERNOR         │
                    │                          │
                    │  E[tokens] · t_decode    │
                    │  ────────────────────    │
                    │   t_draft + t_verify     │  ≥  1.04
                    │                          │
                    │  PLD · MTP · draft · OFF │
                    │  batch contention inside │
                    │  heat soak raises the bar│
                    └───────────┬─────────────┘
                                 │
              ┌─────────────────┼─────────────────┐
              ▼                  ▼                  ▼
        tool FSM           MoE prefetch        audit chain
     registered only      draft names SSD      hash-linked
     no freeform shell    pages while verify   genesis → …
```

This repository ships the **control plane** and a live instrument panel. The tok/s figures in the panel are a **cost model**, not a bench of your Mac. Read [`benchmarks/methodology.md`](benchmarks/methodology.md) before quoting them.

---

## The problem nobody owned

Apple Silicon decode is memory-bandwidth bound. On CUDA, verifying K extra tokens is almost free because tensor cores have spare throughput. On Metal the compute-to-bandwidth ratio is roughly an order of magnitude worse.

That single fact wrecks the CUDA default of “always draft deeper”:

| Source | What it measured | What it means for a Mac |
| --- | --- | --- |
| [mlx-optiq, May 2026](https://mlx-optiq.com/blog/mtp-on-apple-silicon) | MTP **K=1 wins**. K=4 fell to ~0.74× on M4 Pro | Deep verify is not a free lunch |
| [vllm-metal 0.28, 22 Sep 2026](https://vllm.ai/blog/2026-09-22-vllm-metal-v0-28-0) | Gemma 4 MTP +20% output tok/s at c=1; **TTFT +20% at c=16** | Speculation fights the batch |
| [mlx-serve](https://ddalcu.github.io/mlx-serve/speculative-decoding/) | PLD ~2.1× on echo, MTP ~2× on code, **1.0× on prose** (gated) | Workload class matters |
| [oMLX 0.5 Lightning MTP](https://github.com/jundot/omlx) | Qwen3.6-35B-A3B 89.6 → 140.4 tok/s on M3 Ultra | Real kernel work. Not Pathom’s job |

Everyone shipped a draft flag. Almost nobody shipped the inequality that turns the flag *off*.

The wedge is the refusal.

---

## The inequality

Speculate on a step only when

```
          E[tokens] · t_decode
          ──────────────────   ≥   1.04
           t_draft + t_verify
```

- `t_decode` is weight bytes over `peak_bandwidth × 0.68`, plus KV, plus 0.35 ms host.
- `t_verify(K)` is **superlinear** in K:

```
1 + 0.15K + 0.16 · K(K−1)/2
```

  That is the Metal tax. CUDA treats extra positions as almost free. Metal does not.
- Batch contention multiplies draft+verify by `1 + 0.045·(c−1)`. A draft that wins alone can lose at c=16.
- Heat soak raises the bar to **1.22** and caps K at 1.
- Grammar-constrained tool spans shrink the miss rate. Temperature grows it.
- If the 0.8B drafter does not fit beside the target, that source is not a candidate. It is not “slow.” It is absent.

The constants live in one file so the UI cannot drift from the arithmetic: [`src/lib/fathom/catalog.ts`](src/lib/fathom/catalog.ts).

```ts
export const COST = {
  peakEfficiency: 0.68,
  hostMs: 0.35,
  verifyLinear: 0.15,
  verifyQuad: 0.16,
  minSpeedup: 1.04,
  heatMinSpeedup: 1.22,
  // …
} as const;
```

---

## What ships

| Module | What it actually does |
| --- | --- |
| [`governor.ts`](src/lib/fathom/governor.ts) | Picks `off` / `pld` / `mtp` / `draft` and K from the inequality |
| [`pld.ts`](src/lib/fathom/pld.ts) | Prompt-lookup decoding. Copies the span after the last matching n-gram |
| [`cache.ts`](src/lib/fathom/cache.ts) | Content-addressed KV blocks. Parent hash + tokens. Hot LRU, cold write-behind, COW fork |
| [`sandbox.ts`](src/lib/fathom/sandbox.ts) | Registered tools only. `..` is refused, not resolved. Shell is not a tool. Audit is a hash chain |
| [`experts.ts`](src/lib/fathom/experts.ts) | MoE residency + draft-named prefetch. Misses pay an assumed SSD penalty |
| [`simulate.ts`](src/lib/fathom/simulate.ts) | Deterministic tape. Rejection against a scripted target. Same algorithm the UI plays |
| [`selfcheck.ts`](src/lib/fathom/selfcheck.ts) | Asserts the stories: echo beats off, MTP×4 loses on prose, 27B refuses 16 GB, shell is denied |
| [`fathom-app.tsx`](src/components/fathom/fathom-app.tsx) | Instrument panel. Token tape, radix tree, expert grid, sandbox judge, bench, ledger |

This is not mlx-lm. There is no Metal kernel in this repo. Wire the governor onto a real process if you have a Mac. The decision layer is the product.

---

## 30-second start

```bash
git clone https://github.com/thakurpragyan75-collab/pathom.git
cd pathom
npm install
npm run check      # engine invariants
npm run dev        # instrument panel at :5173
```

`npm run check` must print:

```
selfcheck ok
echo <n> tok/s  prose <n> vs mtp4 <n>
```

Open the URL Vite prints. Then walk the floor:

1. **Echo → Run.** Lookup copies the passage. Brass tokens are accepted drafts.
2. **Prose + MTP ×4 → Run.** Deep speculation falls under 1×. That is the CUDA habit the governor exists to stop.
3. **Patch + batch 16.** Model drafts turn off. A free copy can stay on.
4. **M4 · 16 GB + Qwen 27B.** The run is refused. Weights do not fit beside the OS.
5. **Sandbox.** `/repo/src/governor.ts` allow. `../secrets` deny. Network deny. `shell` never.
6. **Radix.** Two chats with the same system prompt share one physical trunk.
7. **Experts.** Switch to Qwen3.6 35B-A3B. The drafter names SSD pages while the target verifies.
8. **Ledger.** The comparison, the citations, the things we refused to claim.

---

## Pathom vs the field

| Concern | oMLX 0.5 | vllm-metal 0.28 | Pathom |
| --- | --- | --- | --- |
| Metal kernels, paged serving | Yes | Yes | Not the job |
| MTP, draft model, n-gram | Lightning MTP | All three | Picks per step |
| Refuses a losing draft | Adaptive depth | Opt-in; TTFT can regress | **The product** |
| Non-greedy exact sampling | Not the headline | Metal path is greedy | Rejection rule |
| Batch-aware speculation | Partial | The open sore | Contention is in the inequality |
| MoE expert prefetch | Custom kernels | — | Draft names the pages |
| Cross-session prefix | Tiered KV | Paged prefix | Hash chain; side channel documented |
| Tools | Apps around it | Structured output | Manifest, no shell, hashed audit |

A shared content-addressed cache is a **timing side channel** if two users ever share a machine. Documented on purpose. Fine for a single-user local tool.

---

## Workloads the governor is judged on

| Id | Story | What should happen |
| --- | --- | --- |
| `echo` | The passage is already in the prompt | PLD copies. Governor beats `off`. |
| `patch` | Rename one identifier in a function | Most tokens accept. The rename rejects. |
| `tool` | JSON tool calls against a capability manifest | Allow the in-root read and write. Deny traversal and network. Never shell. |
| `prose` | Two original sentences. Nothing to copy | Forced MTP ×4 loses to the governor. |
| `brief` | Same system prompt as the night shift | Shared trunk hits. Prefill shrinks. |

These are scripts, not a leaderboard. The panel stamps **cost model** under every figure.

---

## What we dropped on purpose

- “Bypasses virtualization / zero-copy past HTTP.” Unified memory already shares RAM. SSE is still HTTP.
- Invented tok/s with no script. The panel stamps **cost model** under every figure.
- “Run local commands at hardware speed.” That is a liability. Pathom parses JSON and dispatches a fixed set of functions.
- A third API dialect. When this grows a server it will speak `/v1/chat/completions` and `/v1/messages`, nothing else.
- DFlash / EAGLE heads with fake constants. They plug into the same inequality when a real MLX checkpoint exists.
- Claiming device measurements from a Linux sandbox. There is no Metal here. The selfcheck is arithmetic.

---

## Layout

```
pathom/
├── README.md
├── LICENSE
├── package.json
├── benchmarks/
│   └── methodology.md          how the numbers are allowed to be read
├── src/
│   ├── main.tsx
│   ├── styles.css
│   ├── lib/fathom/             control plane — no React
│   │   ├── catalog.ts          chips, models, COST constants
│   │   ├── governor.ts         the inequality
│   │   ├── pld.ts              prompt lookup
│   │   ├── cache.ts            radix / Merkle blocks
│   │   ├── sandbox.ts          capability manifest
│   │   ├── experts.ts          MoE residency
│   │   ├── simulate.ts         deterministic runner
│   │   ├── selfcheck.ts        invariants
│   │   ├── hash.ts             sync SHA-256
│   │   ├── text.ts             tokenize / detokenize
│   │   └── workloads.ts        five scripts
│   └── components/fathom/      instrument panel
│       ├── fathom-app.tsx
│       └── ui.tsx
└── .github/workflows/check.yml
```

---

## What to use this for

- **Teach the Metal tax.** Show why K=4 that wins on an H100 can lose on an M4 Pro.
- **Design a serving policy** before you wire mlx-lm. The governor is a pure function of chip, model, batch, heat, grammar, and prior acceptance.
- **Audit tool calls** that a local agent is about to emit. The sandbox is the judge, not the executor.
- **See prefix reuse.** Two sessions with the same system prompt share blocks. That is a feature and a side channel.
- **Refuse a fit that does not fit.** 27B 4-bit on 16 GB is not a slow run. It is a no.

Wire-up sketch if you have a Mac and mlx-lm already serving:

```
client  →  pathom.chooseDraft(state)  →  mlx-lm generate / verify  →  pathom.record(accept)
```

The kernels stay upstream. The refusal is ours.

---

## License

MIT. Kernels stay upstream. The refusal is ours.
