import { sha256 } from "./hash";

export type ToolName = "read_file" | "write_file" | "fetch_url" | "shell";

export type ToolCall = {
  name: string;
  path?: string;
  url?: string;
  content?: string;
};

export type Policy = {
  readRoots: string[];
  writeRoots: string[];
  allowNet: boolean;
  maxCpuMs: number;
  maxRssMb: number;
};

export const POLICY: Policy = {
  readRoots: ["/repo/src", "/notes"],
  writeRoots: ["/notes"],
  allowNet: false,
  maxCpuMs: 200,
  maxRssMb: 128,
};

export type Decision = {
  call: ToolCall;
  allow: boolean;
  reason: string;
  audit: string;
  prev: string;
};

export function normalizePath(path: string): { ok: true; path: string } | { ok: false; reason: string } {
  if (!path.startsWith("/")) return { ok: false, reason: "Relative paths are not granted." };
  const parts: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return { ok: false, reason: "Path traversal is refused, not resolved." };
    if (segment.includes("\0")) return { ok: false, reason: "Null byte in path." };
    parts.push(segment);
  }
  return { ok: true, path: `/${parts.join("/")}` };
}

function under(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export function judge(call: ToolCall, policy: Policy = POLICY, prev = "genesis"): Decision {
  const name = call.name as ToolName;
  let allow = false;
  let reason = "Unknown tool. Only registered functions run.";

  if (name === "shell") {
    reason = "Freeform shell is not a tool. Text is never passed to a command interpreter.";
  } else if (name === "fetch_url") {
    if (!policy.allowNet) reason = "Network is not in this manifest.";
    else if (!call.url || !/^https:\/\//.test(call.url)) reason = "Only explicit https URLs are granted.";
    else {
      allow = true;
      reason = `GET ${call.url} within cpu ${policy.maxCpuMs} ms and rss ${policy.maxRssMb} MB.`;
    }
  } else if (name === "read_file" || name === "write_file") {
    const normalized = normalizePath(call.path ?? "");
    if (!normalized.ok) reason = normalized.reason;
    else if (name === "read_file") {
      const root = policy.readRoots.find((item) => under(item, normalized.path));
      if (!root) reason = `${normalized.path} is outside the read roots.`;
      else {
        allow = true;
        reason = `Read ${normalized.path} under ${root}.`;
      }
    } else {
      const root = policy.writeRoots.find((item) => under(item, normalized.path));
      if (!root) reason = `${normalized.path} is not a write root.`;
      else {
        allow = true;
        reason = `Write ${normalized.path} under ${root}, capped at the manifest.`;
      }
    }
  }

  const body = JSON.stringify({ prev, allow, reason, call });
  const audit = sha256(body).slice(0, 16);
  return { call, allow, reason, audit, prev };
}

export function chain(calls: ToolCall[], policy: Policy = POLICY): Decision[] {
  const decisions: Decision[] = [];
  let prev = "genesis";
  for (const call of calls) {
    const decision = judge(call, policy, prev);
    decisions.push(decision);
    prev = decision.audit;
  }
  return decisions;
}

export function extractCalls(text: string): { calls: ToolCall[]; dropped: number } {
  const calls: ToolCall[] = [];
  let dropped = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let end = -1;
    for (let j = i; j < text.length; j++) {
      if (text[j] === "{") depth += 1;
      else if (text[j] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = j + 1;
          break;
        }
      }
    }
    if (end < 0) break;
    const raw = text.slice(i, end);
    i = end - 1;
    try {
      const value = JSON.parse(raw) as { name?: unknown; arguments?: Record<string, unknown> };
      if (!value || typeof value.name !== "string") {
        dropped += 1;
        continue;
      }
      const args = value.arguments ?? {};
      calls.push({
        name: value.name,
        path: typeof args.path === "string" ? args.path : undefined,
        url: typeof args.url === "string" ? args.url : undefined,
        content: typeof args.content === "string" ? args.content : undefined,
      });
    } catch {
      dropped += 1;
    }
  }
  return { calls, dropped };
}
