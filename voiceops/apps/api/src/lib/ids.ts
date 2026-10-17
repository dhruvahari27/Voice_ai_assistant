import { createHash, randomInt } from "node:crypto";

// No 0/O/1/I/L: easy to read out on a phone call.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Short human-friendly booking reference, e.g. "AC-7K3PQ". */
export function bookingRef(prefix: string): string {
  let s = "";
  for (let i = 0; i < 5; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}-${s}`;
}

export function refPrefix(businessName: string): string {
  const letters = businessName
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
  return (letters || "VO").slice(0, 2).padEnd(2, "X");
}

/** Stable hash of tool arguments, stored in the ledger to detect key reuse with different args. */
export function hashArgs(args: unknown): string {
  return createHash("sha256").update(stableStringify(args)).digest("hex").slice(0, 32);
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}
