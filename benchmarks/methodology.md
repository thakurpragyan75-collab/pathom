# Methodology

These numbers are a **bandwidth cost model**, not a device measurement.

If you publish a Pathom number as tok/s of a Mac, attach the script, the chip, the quant, the context length, and whether the run was single-stream. Anything else gets discounted.

## What is measured

The engine walks five scripted workloads under five policies (`governor`, `mtp1`, `mtp4`, `pld`, `off`) and reports:

- planned vs realized speedup of each speculative step
- tokens / second as `emitted_tokens / generation_ms`
- TTFT as `prefill_ms × queue(concurrency) + first_step_ms`
- draft acceptance as `accepted_drafts / proposed_drafts`
- prefix hits as content-addressed block matches (`parent || tokens`)

Generation time comes from:

1. published peak memory bandwidth of the selected chip
2. a 0.68 peak-efficiency factor
3. a superlinear Metal verify cost in K
4. a batch-contention term `1 + 0.045·(c−1)`
5. an optional heat-soak floor of 1.22× with K capped at 1
6. an assumed SSD penalty on MoE expert misses

Constants live in `src/lib/fathom/catalog.ts` so the panel and the arithmetic cannot drift.

## What is not measured

- No Metal kernel ran.
- No mlx-lm process ran.
- No powermetrics sample was taken.
- SSD GB/s values are assumptions, labeled as such in the UI.
- Acceptance of MTP / draft tokens is a scripted prior plus rejection against a known target, not a sampled model.

## Why the shape matches 2026 papers anyway

- mlx-optiq (May 2026, M4 Pro): MTP K=1 wins, K=4 ≈ 0.74×. The verify batch is not free on Metal. Pathom’s `verifyQuad` term is how that fact enters the inequality.
- vllm-metal 0.28 (22 Sep 2026): Gemma 4 MTP helps a single stream and pushes TTFT the wrong way at concurrency 16. Pathom multiplies draft+verify by a contention term so a win at c=1 can flip at c=16.
- mlx-serve: prompt-lookup wins on echo/code; speculation is gated off on creative writing. Pathom’s `echo` and `prose` scripts exist to make that visible without a GPU.
- oMLX 0.5 Lightning MTP: real kernel wins on Qwen3.6. Pathom does not claim those kernels.

## Invariants the selfcheck will not let drift

```
npm run check
```

- empty SHA-256 matches the published digest
- echo uses PLD and beats `off`
- forced MTP K=4 loses to the governor on prose
- patch rejects the renamed identifier
- tool tape allows ≥1 call and denies ≥2
- shared system prompt hits ≥16 tokens
- Qwen3.6 27B does not fit in 16 GB
- `shell` is never a tool
