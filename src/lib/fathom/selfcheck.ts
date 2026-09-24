import { CHIPS, MODELS } from "./catalog";
import { sha256 } from "./hash";
import { chain } from "./sandbox";
import { seedCache, simulate, type PolicyId } from "./simulate";
import { WORKLOADS } from "./workloads";

const chip = CHIPS.find((item) => item.id === "m4-max-128")!;
const model = MODELS[0]!;
const cache = seedCache();

function run(id: string, policy: PolicyId = "governor", extra: Partial<Parameters<typeof simulate>[0]> = {}) {
  const workload = WORKLOADS.find((item) => item.id === id)!;
  return simulate({
    workload,
    model,
    chip,
    cache,
    policy,
    concurrency: 1,
    temperature: 0,
    ngram: 2,
    heat: false,
    ...extra,
  });
}

const empty = sha256("");
if (empty !== "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855") {
  throw new Error(`sha256 empty ${empty}`);
}

const echo = run("echo");
const prose = run("prose");
const proseForced = run("prose", "mtp4");
const patch = run("patch");
const tool = run("tool");
const brief = run("brief");
const unfit = simulate({ workload: WORKLOADS[0]!, model, chip: CHIPS[0]!, cache });

if (!echo.steps.some((step) => step.source === "pld")) throw new Error("echo should use PLD");
if (echo.tokPerS <= run("echo", "off").tokPerS) throw new Error("echo governor should beat off");
if (proseForced.tokPerS >= prose.tokPerS) throw new Error("forced MTP K=4 should lose on prose");
if (!patch.steps.some((step) => step.rejected)) throw new Error("patch should reject the rename");
const allows = tool.decisions.filter((d) => d.allow).length;
const denies = tool.decisions.filter((d) => !d.allow).length;
if (allows < 1 || denies < 2) throw new Error(`tool policy ${allows}/${denies}`);
if (brief.hitTokens < 16) throw new Error("shared prefix should hit");
if (unfit.fit.ok) throw new Error("27B must not fit in 16GB");
if (chain([{ name: "shell" }])[0]?.allow) throw new Error("shell must be denied");

console.log("selfcheck ok");
console.log(`echo ${echo.tokPerS.toFixed(1)} tok/s  prose ${prose.tokPerS.toFixed(1)} vs mtp4 ${proseForced.tokPerS.toFixed(1)}`);
