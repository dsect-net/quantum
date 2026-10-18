import type { Actor, Role } from "@/singularity/types";

export function Mark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--color-button)" />
      <circle cx="16" cy="16" r="7" fill="none" stroke="var(--color-accent)" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="2" fill="var(--color-button-ink)" />
    </svg>
  );
}

export function Avatar({ actor, size = "md" }: { actor: Actor; size?: "sm" | "md" | "lg" }) {
  const dim = size === "sm" ? "size-8" : size === "lg" ? "size-16" : "size-10";
  const text = size === "lg" ? "text-lg" : "text-sm";
  if (actor.photo) {
    return <img src={actor.photo} alt="" className={`${dim} rounded-full object-cover border border-line`} />;
  }
  return (
    <span
      className={`${dim} ${text} grid place-items-center rounded-full border border-line bg-surface font-medium text-ink`}
      aria-hidden="true"
    >
      {actor.name.slice(0, 1)}
    </span>
  );
}

export function RoleBadge({ role }: { role: Role }) {
  const agent = role === "agent";
  return (
    <span
      className={
        agent
          ? "rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent"
          : "rounded-md border border-line px-1.5 py-0.5 text-xs font-medium text-muted"
      }
    >
      {agent ? "Agent" : "Human"}
    </span>
  );
}

export function timeLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
