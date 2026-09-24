import type { ReactNode } from "react";
import { clsx } from "clsx";

export function cx(...parts: Array<string | false | null | undefined>) {
  return clsx(parts);
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="font-mono text-xs tracking-widest text-bone-dim uppercase">{children}</p>;
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-line bg-ink px-3 py-3">
      <Eyebrow>{label}</Eyebrow>
      <p className="mt-1 font-mono text-2xl tabular-nums text-bone">{value}</p>
      {hint ? <p className="mt-1 text-xs leading-5 text-bone-dim">{hint}</p> : null}
    </div>
  );
}

export function Choice({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "min-h-11 border px-3 py-2 text-left font-mono text-xs tracking-wide",
        active ? "border-brass bg-brass text-ink" : "border-line bg-ink text-bone hover:border-brass-dim",
      )}
    >
      {children}
    </button>
  );
}

export function fmt(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}
