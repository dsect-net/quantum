import type { Comment, HubData, LogEntry, Post, ReactionKind } from "./types.ts";
import { parseTokens } from "./parse.ts";
import { applyAssignments, planRoute } from "./routing.ts";

export function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${rand}`;
}

function log(data: HubData, level: LogEntry["level"], message: string, at: string): LogEntry[] {
  const entry: LogEntry = { id: newId("log"), at, level, message };
  return [entry, ...data.logs].slice(0, 200);
}

export function publishPost(data: HubData, authorId: string, body: string, now = new Date().toISOString()): { data: HubData; error?: string } {
  const text = body.trim();
  if (!text) return { data, error: "Write something before posting." };
  if (text.length > 2000) return { data, error: "Posts stop at 2000 characters." };
  const tokens = parseTokens(text);
  const plan = planRoute(data, text, authorId);
  const post: Post = {
    id: newId("post"),
    authorId,
    body: text,
    tokens,
    createdAt: now,
    reactions: { acknowledge: [], useful: [], question: [] },
  };
  const pings = plan.pings.map((p) => ({
    ...p,
    id: newId("ping"),
    postId: post.id,
    createdAt: now,
    acked: false,
  }));
  const tasks = applyAssignments(data.tasks, plan.assignments);
  const note = plan.notes.length ? plan.notes.join(" ") : "Posted with no agent mentions.";
  return {
    data: {
      ...data,
      posts: [post, ...data.posts],
      tasks,
      pings: [...pings, ...data.pings],
      logs: log(data, "info", note, now),
    },
  };
}

export function publishComment(
  data: HubData,
  authorId: string,
  postId: string,
  body: string,
  now = new Date().toISOString(),
): { data: HubData; error?: string } {
  const text = body.trim();
  if (!data.posts.some((p) => p.id === postId)) return { data, error: "That post is gone." };
  if (!text) return { data, error: "Write a comment before sending." };
  if (text.length > 2000) return { data, error: "Comments stop at 2000 characters." };
  const tokens = parseTokens(text);
  const plan = planRoute(data, text, authorId);
  const comment: Comment = {
    id: newId("comment"),
    postId,
    authorId,
    body: text,
    tokens,
    createdAt: now,
  };
  const pings = plan.pings.map((p) => ({
    ...p,
    id: newId("ping"),
    postId,
    createdAt: now,
    acked: false,
    summary: `Comment: ${p.summary}`.slice(0, 500),
  }));
  return {
    data: {
      ...data,
      comments: [...data.comments, comment],
      tasks: applyAssignments(data.tasks, plan.assignments),
      pings: [...pings, ...data.pings],
      logs: log(data, "info", plan.notes.join(" ") || "Comment added.", now),
    },
  };
}

export function toggleReaction(data: HubData, postId: string, actorId: string, kind: ReactionKind): HubData {
  return {
    ...data,
    posts: data.posts.map((post) => {
      if (post.id !== postId) return post;
      const current = post.reactions[kind];
      const next = current.includes(actorId) ? current.filter((id) => id !== actorId) : [...current, actorId];
      return { ...post, reactions: { ...post.reactions, [kind]: next } };
    }),
  };
}

export function ackPing(data: HubData, pingId: string, actorId: string): HubData {
  return {
    ...data,
    pings: data.pings.map((p) => (p.id === pingId && p.toId === actorId ? { ...p, acked: true } : p)),
  };
}
