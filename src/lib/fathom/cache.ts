import { shortHash } from "./hash";
import { detokenize } from "./text";

export const BLOCK = 8;

export type Block = {
  hash: string;
  parent: string | null;
  tokens: string[];
  text: string;
  sessions: string[];
  hits: number;
  tier: "hot" | "cold";
  lastUsed: number;
  bytes: number;
};

export type CacheState = {
  blocks: Record<string, Block>;
  hot: string[];
  coldQueue: string[];
  clock: number;
  hotSlots: number;
  bytesPerToken: number;
};

export function emptyCache(hotSlots = 14, bytesPerToken = 48_000): CacheState {
  return { blocks: {}, hot: [], coldQueue: [], clock: 1, hotSlots, bytesPerToken };
}

function touch(cache: CacheState, hash: string): CacheState {
  const block = cache.blocks[hash];
  if (!block) return cache;
  const blocks = {
    ...cache.blocks,
    [hash]: { ...block, hits: block.hits + 1, lastUsed: cache.clock, tier: "hot" as const },
  };
  let hot = cache.hot.filter((id) => id !== hash);
  hot.push(hash);
  let coldQueue = cache.coldQueue.filter((id) => id !== hash);
  const evicted: string[] = [];
  while (hot.length > cache.hotSlots) {
    const victim = hot.shift();
    if (!victim) break;
    evicted.push(victim);
    const current = blocks[victim];
    if (current) blocks[victim] = { ...current, tier: "cold" };
  }
  if (evicted.length) coldQueue = [...coldQueue, ...evicted];
  return { ...cache, blocks, hot, coldQueue, clock: cache.clock + 1 };
}

function insert(cache: CacheState, block: Block): CacheState {
  const blocks = { ...cache.blocks, [block.hash]: block };
  let hot = [...cache.hot, block.hash];
  let coldQueue = cache.coldQueue;
  while (hot.length > cache.hotSlots) {
    const victim = hot.shift();
    if (!victim) break;
    const current = blocks[victim];
    if (current) blocks[victim] = { ...current, tier: "cold" };
    coldQueue = [...coldQueue, victim];
  }
  return { ...cache, blocks, hot, coldQueue, clock: cache.clock + 1 };
}

export type Walk = {
  cache: CacheState;
  hits: number;
  misses: number;
  hitTokens: number;
  missTokens: number;
  path: string[];
};

export function walk(cache: CacheState, tokens: string[], session: string): Walk {
  let state = cache;
  let parent: string | null = null;
  let hits = 0;
  let misses = 0;
  let hitTokens = 0;
  let missTokens = 0;
  const path: string[] = [];

  for (let i = 0; i + BLOCK <= tokens.length; i += BLOCK) {
    const slice = tokens.slice(i, i + BLOCK);
    const hash = shortHash(`${parent ?? "root"}\n${slice.join("\n")}`);
    path.push(hash);
    const existing = state.blocks[hash];
    if (existing) {
      hits += 1;
      hitTokens += slice.length;
      const sessions = existing.sessions.includes(session)
        ? existing.sessions
        : [...existing.sessions, session];
      state = {
        ...state,
        blocks: { ...state.blocks, [hash]: { ...existing, sessions } },
      };
      state = touch(state, hash);
    } else {
      misses += 1;
      missTokens += slice.length;
      const block: Block = {
        hash,
        parent,
        tokens: slice,
        text: detokenize(slice),
        sessions: [session],
        hits: 1,
        tier: "hot",
        lastUsed: state.clock,
        bytes: slice.length * state.bytesPerToken,
      };
      state = insert(state, block);
    }
    parent = hash;
  }

  const tail = tokens.length % BLOCK;
  if (tail) missTokens += tail;
  return { cache: state, hits, misses, hitTokens, missTokens, path };
}

export function flushCold(cache: CacheState): CacheState {
  if (cache.coldQueue.length < 4) return cache;
  return { ...cache, coldQueue: [] };
}

export function forceFlush(cache: CacheState): CacheState {
  return { ...cache, coldQueue: [] };
}

export function forkSession(cache: CacheState, tokens: string[], session: string, atBlock: number): Walk {
  const cut = Math.max(BLOCK, atBlock * BLOCK);
  const head = tokens.slice(0, cut);
  const tail = tokens.slice(cut);
  const changed = tail.length ? tail.slice() : ["fork"];
  if (changed[0]) changed[0] = `${changed[0]}-fork`;
  return walk(cache, [...head, ...changed], session);
}

export function withSlots(cache: CacheState, hotSlots: number): CacheState {
  const blocks = { ...cache.blocks };
  const ranked = Object.values(blocks).sort((a, b) => b.lastUsed - a.lastUsed);
  const hot: string[] = [];
  for (let i = 0; i < ranked.length; i++) {
    const block = ranked[i]!;
    const tier = i < hotSlots ? "hot" : "cold";
    blocks[block.hash] = { ...block, tier };
    if (tier === "hot") hot.push(block.hash);
  }
  const cold = ranked.filter((block) => blocks[block.hash]?.tier === "cold").map((block) => block.hash);
  return { ...cache, blocks, hot, hotSlots, coldQueue: cold };
}

export type TreeRow = {
  hash: string;
  depth: number;
  text: string;
  hits: number;
  tier: "hot" | "cold";
  shared: boolean;
  sessions: string[];
  bytes: number;
  last: boolean;
};

export function treeRows(cache: CacheState): TreeRow[] {
  const children = new Map<string | null, Block[]>();
  for (const block of Object.values(cache.blocks)) {
    const list = children.get(block.parent) ?? [];
    list.push(block);
    children.set(block.parent, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.hash.localeCompare(b.hash));

  const rows: TreeRow[] = [];
  const visit = (parent: string | null, depth: number) => {
    const list = children.get(parent) ?? [];
    list.forEach((block, index) => {
      rows.push({
        hash: block.hash,
        depth,
        text: block.text.replace(/\s+/g, " ").trim(),
        hits: block.hits,
        tier: block.tier,
        shared: block.sessions.length > 1,
        sessions: block.sessions,
        bytes: block.bytes,
        last: index === list.length - 1,
      });
      visit(block.hash, depth + 1);
    });
  };
  visit(null, 0);
  return rows;
}
