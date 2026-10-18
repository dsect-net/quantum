import type { Actor, HubData } from "@/singularity/types";
import { resolveRef } from "@/singularity/handles";
import { actorById } from "@/singularity/store";

export function MentionChip({ name, agent }: { name: string; agent: boolean }) {
  return (
    <span
      className={
        agent
          ? "inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-sm font-medium text-accent align-baseline"
          : "inline-flex items-center rounded-full border border-line bg-surface px-2 py-0.5 text-sm font-medium text-ink align-baseline"
      }
    >
      {name}
    </span>
  );
}

export function RichText({
  body,
  tokens,
  actors,
  onMention,
  onRef,
}: {
  body: string;
  tokens: HubData["posts"][number]["tokens"];
  actors: Actor[];
  onMention?: (handle: string) => void;
  onRef?: (handle: string) => void;
}) {
  return (
    <p className="text-[15px] leading-6 text-ink whitespace-pre-wrap">
      {tokens.map((token, i) => {
        if (token.type === "text") return <span key={i}>{token.text}</span>;
        if (token.type === "mention") {
          const actor = actors.find(
            (a) => a.handle.toLowerCase() === token.handle.toLowerCase() || a.name.toLowerCase() === token.handle.toLowerCase(),
          );
          if (!actor) {
            return (
              <span key={i} className="text-muted">
                @{token.handle}
              </span>
            );
          }
          return (
            <button
              key={i}
              type="button"
              className="inline p-0 align-baseline"
              onClick={() => onMention?.(actor.handle)}
            >
              <MentionChip name={actor.name} agent={actor.role === "agent"} />
            </button>
          );
        }
        return (
          <button key={i} type="button" className="inline p-0 align-baseline text-sm font-medium text-accent" onClick={() => onRef?.(token.handle)}>
            #{token.handle}
          </button>
        );
      })}
      {tokens.every((t) => t.type !== "text") ? null : null}
      {!tokens.length ? body : null}
    </p>
  );
}

export function RefCard({
  handle,
  data,
  onOpen,
}: {
  handle: string;
  data: HubData;
  onOpen: (handle: string) => void;
}) {
  const ref = resolveRef(data, handle);
  if (!ref) {
    return (
      <div className="rounded-card border border-line bg-canvas px-3 py-2 text-sm text-muted">
        No object for #{handle}
      </div>
    );
  }
  const owner = ref.kind === "goal" ? actorById(data.actors, ref.ownerId) : undefined;
  const assignee = ref.kind === "task" ? actorById(data.actors, ref.assigneeId) : undefined;
  return (
    <button
      type="button"
      onClick={() => onOpen(ref.handle)}
      className="block w-full rounded-card border border-line bg-surface px-3 py-3 text-left hover:border-ink"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-accent">#{ref.handle}</span>
        <span className="text-xs text-muted capitalize">{ref.kind === "memory" ? ref.tier : ref.status}</span>
      </div>
      <p className="mt-1 text-sm font-medium text-ink">{ref.title}</p>
      {ref.kind === "goal" ? (
        <div className="mt-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-canvas">
            <div className="h-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, ref.progress))}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted">
            {ref.progress}% · {owner?.name ?? "Unowned"}
          </p>
        </div>
      ) : null}
      {ref.kind === "task" ? (
        <p className="mt-1 text-xs text-muted">Assignee {assignee?.name ?? "Unassigned"}</p>
      ) : null}
      {ref.kind === "memory" ? <p className="mt-1 text-xs text-muted line-clamp-2">{ref.excerpt}</p> : null}
      {ref.kind === "issue" ? (
        <p className="mt-1 text-xs text-muted">
          {ref.repo} #{ref.number}
        </p>
      ) : null}
      {ref.kind === "bounty" ? <p className="mt-1 text-xs text-muted">{ref.reward}</p> : null}
      {ref.kind === "service" ? <p className="mt-1 text-xs text-muted">{ref.summary}</p> : null}
    </button>
  );
}

export function refHandlesIn(tokens: HubData["posts"][number]["tokens"]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    if (token.type !== "ref") continue;
    const key = token.handle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token.handle);
  }
  return out;
}
