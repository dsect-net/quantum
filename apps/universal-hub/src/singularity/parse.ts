import type { Token } from "./types.ts";

/** Mentions are @Name. References are #kind-### optional slug.
 * The kind prefix is required so ordinary hashtags are not treated as objects.
 */
const TOKEN_RE =
  /(@[A-Za-z][\w-]*)|(#(?:goal|task|issue|bounty|memory|service)-[A-Za-z0-9][\w-]*)/g;

export function parseTokens(input: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of input.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > last) {
      tokens.push({ type: "text", text: input.slice(last, index) });
    }
    const raw = match[0];
    if (raw.startsWith("@")) {
      tokens.push({ type: "mention", handle: raw.slice(1) });
    } else {
      tokens.push({ type: "ref", handle: raw.slice(1) });
    }
    last = index + raw.length;
  }
  if (last < input.length) tokens.push({ type: "text", text: input.slice(last) });
  if (tokens.length === 0) tokens.push({ type: "text", text: input });
  return tokens;
}

export function mentionHandles(tokens: Token[]): string[] {
  return tokens.filter((t) => t.type === "mention").map((t) => t.handle);
}

export function refHandles(tokens: Token[]): string[] {
  return tokens.filter((t) => t.type === "ref").map((t) => t.handle);
}
