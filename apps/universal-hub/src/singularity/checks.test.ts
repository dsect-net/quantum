import { describe, expect, it } from "vitest";
import { runSelfChecks } from "./checks";
import { parseTokens } from "./parse";
import { nextHandle } from "./handles";

describe("singularity tokens and routing", () => {
  it("passes the fleet self-checks", () => {
    const failed = runSelfChecks().filter((c) => !c.pass);
    expect(failed.map((c) => `${c.name}: ${c.detail}`)).toEqual([]);
  });

  it("does not swallow punctuation into a mention", () => {
    const tokens = parseTokens("Ask @Iris.");
    expect(tokens[1]).toEqual({ type: "mention", handle: "Iris" });
    expect(tokens[2]).toEqual({ type: "text", text: "." });
  });

  it("maps handles per type", () => {
    expect(nextHandle(["task-001", "goal-004"], "goal")).toBe("goal-005");
    expect(nextHandle(["task-001-example"], "task", "Routing")).toBe("task-002-routing");
  });
});
