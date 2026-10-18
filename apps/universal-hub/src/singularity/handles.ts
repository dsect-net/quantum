import type { HubData, RefKind } from "./types.ts";

const KINDS: RefKind[] = ["goal", "task", "issue", "bounty", "memory", "service"];

export function kindFromHandle(handle: string): RefKind | null {
  const kind = handle.split("-")[0] as RefKind;
  return KINDS.includes(kind) ? kind : null;
}

export function handlesOfKind(data: Pick<HubData, "goals" | "tasks" | "issues" | "bounties" | "memories" | "services">, kind: RefKind): string[] {
  switch (kind) {
    case "goal":
      return data.goals.map((g) => g.handle);
    case "task":
      return data.tasks.map((t) => t.handle);
    case "issue":
      return data.issues.map((i) => i.handle);
    case "bounty":
      return data.bounties.map((b) => b.handle);
    case "memory":
      return data.memories.map((m) => m.handle);
    case "service":
      return data.services.map((s) => s.handle);
  }
}

/** Sequential per type: goal-001, goal-002, optional human slug. */
export function nextHandle(existing: string[], kind: RefKind, slug?: string): string {
  const nums = existing
    .map((h) => {
      const parts = h.split("-");
      if (parts[0] !== kind) return NaN;
      return Number(parts[1]);
    })
    .filter((n) => Number.isFinite(n));
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  const num = String(n).padStart(3, "0");
  const clean = slug?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return clean ? `${kind}-${num}-${clean}` : `${kind}-${num}`;
}

export type ResolvedRef =
  | { kind: "goal"; handle: string; title: string; status: string; progress: number; ownerId: string; summary: string }
  | { kind: "task"; handle: string; title: string; status: string; assigneeId: string | null; goalHandle: string; summary: string }
  | { kind: "issue"; handle: string; title: string; status: string; repo: string; number: number }
  | { kind: "bounty"; handle: string; title: string; status: string; reward: string }
  | { kind: "memory"; handle: string; title: string; excerpt: string; tier: string; agent: string }
  | { kind: "service"; handle: string; title: string; status: string; summary: string };

export function resolveRef(data: HubData, handle: string): ResolvedRef | null {
  const key = handle.toLowerCase();
  const matches = (value: string) => value.toLowerCase() === key || (/^[a-z]+-\d+$/.test(key) && value.toLowerCase().startsWith(key + "-"));
  const goal = data.goals.find((g) => matches(g.handle));
  if (goal) return { kind: "goal", ...goal };
  const task = data.tasks.find((t) => matches(t.handle));
  if (task) return { kind: "task", ...task };
  const issue = data.issues.find((i) => matches(i.handle));
  if (issue) return { kind: "issue", ...issue };
  const bounty = data.bounties.find((b) => matches(b.handle));
  if (bounty) return { kind: "bounty", ...bounty };
  const memory = data.memories.find((m) => matches(m.handle));
  if (memory) return { kind: "memory", ...memory };
  const service = data.services.find((s) => matches(s.handle));
  if (service) return { kind: "service", ...service };
  return null;
}
