/**
 * Memory-reference & mention parsing for post bodies.
 *
 * Convention (docs/MEMORY.md — memory convention): cite Hive memories
 * inline as `[[mem:<id>]]`; mention members with `@handle`. This module is
 * pure and unit-tested — it powers both the composer preview and the feed
 * renderer so tokens never get out of sync between write and read paths.
 */

export interface BodySegment {
  type: 'text' | 'mem' | 'mention';
  value: string;
}

const TOKEN_RE = /\[\[mem:([A-Za-z0-9_-]+)\]\]/g;
const MENTION_RE = /(^|[^A-Za-z0-9_@])@([a-z0-9][a-z0-9_-]{1,38})/gi;

/** Ordered, de-duplicated memory ids referenced inline in a body. */
export function parseMemoryIds(body: string): string[] {
  const ids: string[] = [];
  for (const m of (body ?? '').matchAll(TOKEN_RE)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

/** Ordered, de-duplicated mention handles (lowercased) in a body. */
export function parseMentions(body: string): string[] {
  const handles: string[] = [];
  for (const m of (body ?? '').matchAll(MENTION_RE)) {
    const handle = m[2].toLowerCase();
    if (!handles.includes(handle)) handles.push(handle);
  }
  return handles;
}

/**
 * Split a body into renderable segments, preserving order: plain text,
 * memory tokens, and mentions. Rendering stays dumb; styling is CSS.
 */
export function segmentBody(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  const marks: { start: number; end: number; seg: BodySegment }[] = [];

  for (const m of (body ?? '').matchAll(TOKEN_RE)) {
    marks.push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      seg: { type: 'mem', value: m[1] },
    });
  }
  for (const m of (body ?? '').matchAll(MENTION_RE)) {
    const atStart = (m.index ?? 0) + m[1].length;
    marks.push({
      start: atStart,
      end: atStart + 1 + m[2].length,
      seg: { type: 'mention', value: m[2].toLowerCase() },
    });
  }

  marks.sort((a, b) => a.start - b.start);

  let cursor = 0;
  for (const mark of marks) {
    if (mark.start < cursor) continue; // overlapping match — skip
    if (mark.start > cursor) {
      segments.push({ type: 'text', value: body.slice(cursor, mark.start) });
    }
    segments.push(mark.seg);
    cursor = mark.end;
  }
  if (cursor < body.length) {
    segments.push({ type: 'text', value: body.slice(cursor) });
  }
  return segments;
}

/** Insert a memory token at the end of a draft body (composer helper). */
export function appendMemoryToken(body: string, memoryId: string): string {
  const token = `[[mem:${memoryId}]]`;
  const trimmed = (body ?? '').replace(/\s+$/, '');
  return trimmed ? `${trimmed} ${token}` : token;
}

/** Validate a tag list for the composer: normalized, deduped, capped. */
export function normalizeTags(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((t) => t.trim().replace(/^#/, '').toLowerCase())
    .filter(Boolean)
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .slice(0, 12);
}
