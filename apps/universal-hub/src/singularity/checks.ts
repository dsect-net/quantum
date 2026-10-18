import { seedData, DEMO_POST } from "./seed.ts";
import { parseTokens } from "./parse.ts";
import { kindFromHandle, nextHandle } from "./handles.ts";
import { planRoute } from "./routing.ts";
import { publishPost } from "./domain.ts";

export type Check = { name: string; pass: boolean; detail: string };

export function runSelfChecks(): Check[] {
  const checks: Check[] = [];
  function add(name: string, pass: boolean, detail: string) {
    checks.push({ name, pass, detail });
  }

  const tokens = parseTokens(DEMO_POST);
  add(
    "parser keeps the example mentions",
    tokens.filter((t) => t.type === "mention").map((t) => t.handle).join(",") === "Cooper,Iris",
    tokens.map((t) => t.type).join(" "),
  );
  add(
    "parser keeps the example refs",
    tokens.filter((t) => t.type === "ref").map((t) => t.handle).join(",") === "goal-001-example,task-001-example",
    "refs",
  );
  add("plain words stay text", parseTokens("hello fleet").every((t) => t.type === "text"), "text");
  add("unknown hash is not a ref", parseTokens("see #random").every((t) => t.type === "text"), "hash");

  add("kind from goal handle", kindFromHandle("goal-001-example") === "goal", "goal");
  add("kind rejects junk", kindFromHandle("nope") === null, "null");
  const seeded = seedData();
  add(
    "next task handle is sequential",
    nextHandle(seeded.tasks.map((t) => t.handle), "task") === "task-002",
    nextHandle(seeded.tasks.map((t) => t.handle), "task"),
  );
  add(
    "slug appends",
    nextHandle(["goal-001-example"], "goal", "Feed") === "goal-002-feed",
    "slug",
  );

  const plan = planRoute(seeded, DEMO_POST, "actor-scotty");
  const pingNames = plan.pings.map((p) => seeded.actors.find((a) => a.id === p.toId)?.name);
  add("Cooper is pinged", pingNames.includes("Cooper"), pingNames.join(","));
  add("Iris is pinged as a task", plan.pings.some((p) => p.toId === "actor-iris" && p.kind === "task"), "iris");
  add("Iris is the assignee", plan.assignments.some((a) => a.assigneeId === "actor-iris" && a.handle === "task-001-example"), "assign");
  add("Cooper is not assigned the task", !plan.assignments.some((a) => a.assigneeId === "actor-cooper"), "cooper");

  const published = publishPost({ ...seeded, session: { actorId: "actor-scotty", mode: "preview", email: "scotty@dsect.net" } }, "actor-scotty", DEMO_POST, "2026-10-18T06:00:00.000Z");
  const task = published.data.tasks.find((t) => t.handle === "task-001-example");
  add("publish stores tokens", (published.data.posts[0]?.tokens.length ?? 0) > 1, "tokens");
  add("publish assigns Iris", task?.assigneeId === "actor-iris" && task.status === "doing", task?.assigneeId ?? "none");
  add("publish creates two pings", published.data.pings.length === 2, String(published.data.pings.length));
  add("empty post errors", Boolean(publishPost(seeded, "actor-scotty", "  ").error), "empty");

  return checks;
}
