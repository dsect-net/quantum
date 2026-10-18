import type { Actor, HubData, Ping, Task } from "./types.ts";
import { mentionHandles, parseTokens, refHandles } from "./parse.ts";
import { resolveRef } from "./handles.ts";

export type Assignment = { taskId: string; assigneeId: string; handle: string };

export type RoutePlan = {
  pings: Array<Omit<Ping, "id" | "createdAt" | "acked">>;
  assignments: Assignment[];
  notes: string[];
};

function findActor(actors: Actor[], handle: string): Actor | undefined {
  const key = handle.toLowerCase();
  return actors.find(
    (a) => a.handle.toLowerCase() === key || a.name.toLowerCase() === key,
  );
}

function sentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [text];
}

/**
 * Mention routing.
 * Every @agent becomes a ping. A sentence that names an agent and a task
 * assigns that task to the agent in the sentence (the one asked to do the work),
 * not every agent in the post.
 */
export function planRoute(data: Pick<HubData, "actors" | "tasks" | "goals" | "issues" | "bounties" | "memories" | "services">, body: string, fromId: string): RoutePlan {
  const notes: string[] = [];
  const assignments: Assignment[] = [];
  const pings: RoutePlan["pings"] = [];
  const seenPing = new Set<string>();

  function addPing(actor: Actor, kind: Ping["kind"], subject: string, summary: string, ref?: string) {
    if (actor.role !== "agent") return;
    const key = `${actor.id}:${kind}:${ref ?? ""}`;
    if (seenPing.has(key)) return;
    seenPing.add(key);
    pings.push({ toId: actor.id, fromId, kind, subject, summary, ref, postId: "" });
  }

  for (const sentence of sentences(body)) {
    const tokens = parseTokens(sentence);
    const agents = mentionHandles(tokens)
      .map((h) => findActor(data.actors, h))
      .filter((a): a is Actor => !!a && a.role === "agent");
    const tasks = refHandles(tokens)
      .map((h) => resolveRef(data as HubData, h))
      .filter((r): r is Extract<NonNullable<ReturnType<typeof resolveRef>>, { kind: "task" }> => r?.kind === "task");

    if (agents.length && tasks.length && /\b(assign|work on|take|implement|build|handle|pick up|go ahead)\b/i.test(sentence) && !/\b(do not|don’t|don't|never|not to)\b/i.test(sentence)) {
      const agent = agents[agents.length - 1];
      for (const task of tasks) {
        const full = data.tasks.find((t) => t.handle.toLowerCase() === task.handle.toLowerCase());
        if (!full) continue;
        assignments.push({ taskId: full.id, assigneeId: agent.id, handle: full.handle });
        addPing(
          agent,
          "task",
          `Assigned ${full.handle}`,
          sentence.slice(0, 500),
          full.handle,
        );
        notes.push(`${agent.name} will be pinged and assigned to ${full.handle}.`);
      }
      for (const other of agents.slice(0, -1)) {
        addPing(other, "mention", "Mentioned in a post", sentence.slice(0, 500));
        notes.push(`${other.name} will be pinged.`);
      }
    } else {
      for (const agent of agents) {
        addPing(agent, "mention", "Mentioned in a post", sentence.slice(0, 500));
        notes.push(`${agent.name} will be pinged.`);
      }
    }
  }

  const humans = mentionHandles(parseTokens(body))
    .map((h) => findActor(data.actors, h))
    .filter((a): a is Actor => !!a && a.role === "human");
  for (const human of humans) {
    notes.push(`${human.name} is named in the post.`);
  }

  return { pings, assignments, notes: [...new Set(notes)] };
}

export function applyAssignments(tasks: Task[], assignments: Assignment[]): Task[] {
  if (!assignments.length) return tasks;
  const byId = new Map(assignments.map((a) => [a.taskId, a.assigneeId]));
  return tasks.map((task) => {
    const assigneeId = byId.get(task.id);
    if (!assigneeId) return task;
    return { ...task, assigneeId, status: task.status === "done" ? "done" : "doing" };
  });
}
