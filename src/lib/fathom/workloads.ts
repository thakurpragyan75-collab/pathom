export type WorkloadId = "echo" | "patch" | "tool" | "prose" | "brief";

export type Workload = {
  id: WorkloadId;
  label: string;
  kicker: string;
  prompt: string;
  target: string;
  grammar: boolean;
  session: string;
  priors: { pld: number; mtp: number; draft: number };
};

export const TEAM_PROMPT =
  "System. You are the on-device engineer for a single Mac shared by the desk. Rules you do not break: speculate only when bandwidth pays for the draft, keep tool calls inside the schema, never pass freeform text to a shell, and prefer the short answer over a performance. The harbor channel is shared context for every night shift.";

const PASSAGE = "The keel holds the line only while the water pays for the sail.";

const FN = `function speculate(depth, bandwidth) {
  if (bandwidth < depth) return 0;
  return depth * bandwidth;
}`;

const FN_PATCHED = `function speculate(draftDepth, bandwidth) {
  if (bandwidth < draftDepth) return 0;
  return draftDepth * bandwidth;
}`;

export const WORKLOADS: Workload[] = [
  {
    id: "echo",
    label: "Echo",
    kicker: "The passage is already in the prompt. Lookup should copy it.",
    prompt: `Passage: ${PASSAGE}\nRepeat starting at: The keel`,
    target: "holds the line only while the water pays for the sail.",
    grammar: false,
    session: "echo",
    priors: { pld: 0.93, mtp: 0.42, draft: 0.48 },
  },
  {
    id: "patch",
    label: "Patch",
    kicker: "Most tokens are copies. The rename is the only rejection.",
    prompt: `${FN}\nRename depth to draftDepth. Return only the function.`,
    target: FN_PATCHED,
    grammar: false,
    session: "patch",
    priors: { pld: 0.64, mtp: 0.6, draft: 0.5 },
  },
  {
    id: "tool",
    label: "Tools",
    kicker: "Grammar mask on. Calls are judged by the manifest, never exec'd.",
    prompt: `${TEAM_PROMPT}\nTools: read_file, write_file, fetch_url. Example call: {"name":"read_file","arguments":{"path":"/repo/src/governor.ts"}}\nRead the governor, append the night log, and do not touch the network.`,
    target: [
      '{"name":"read_file","arguments":{"path":"/repo/src/governor.ts"}}',
      '{"name":"read_file","arguments":{"path":"/repo/../secrets/keys"}}',
      '{"name":"fetch_url","arguments":{"url":"https://example.com/weights"}}',
      '{"name":"write_file","arguments":{"path":"/notes/log.txt","content":"night watch"}}',
    ].join("\n"),
    grammar: true,
    session: "tools",
    priors: { pld: 0.72, mtp: 0.7, draft: 0.55 },
  },
  {
    id: "prose",
    label: "Prose",
    kicker: "Nothing to copy. A deep draft should lose on this bandwidth.",
    prompt:
      "Write two original sentences about a harbor at night. Do not quote the instructions or any passage you were shown.",
    target: "Lanterns stitch a broken line across the black water. The mooring lines tick, once, against the pile.",
    grammar: false,
    session: "prose",
    priors: { pld: 0.07, mtp: 0.24, draft: 0.2 },
  },
  {
    id: "brief",
    label: "Shared",
    kicker: "Same system prompt as the night shift. The trunk should already be cached.",
    prompt: `${TEAM_PROMPT}\nUser. One sentence: what do you refuse to speed up?`,
    target: "A draft that costs more bandwidth than the tokens it saves.",
    grammar: false,
    session: "brief",
    priors: { pld: 0.16, mtp: 0.46, draft: 0.4 },
  },
];

export function workloadById(id: string): Workload {
  return WORKLOADS.find((item) => item.id === id) ?? WORKLOADS[0]!;
}
