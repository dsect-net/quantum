/**
 * QButton complex-children guard (TRK-0492).
 *
 * The vendored Untitled Button wraps ALL children in a single
 * `<span data-text>` label span inside an `inline-flex justify-center
 * whitespace-nowrap` root. QButton is therefore only safe with a text
 * label, optionally flanked by self-closing icon elements. Any complex
 * child (a layout element, an Avatar, a flex row, a fragment of
 * elements, an expression that renders JSX) silently overflows or
 * clips — see TRK-0484, where the Mail MessageRow overflowed at 390px.
 *
 * This module is the pure scanner behind qbutton-guard.test.ts, which
 * runs in the normal vitest suite and fails on any non-label-shaped
 * QButton usage in src/**. No new dependencies: lightweight scanning
 * only, calibrated against the real usages on main.
 */

export interface QButtonUsage {
  /** 1-based line of the `<QButton` opening tag. */
  line: number;
  /** Raw children source between the opening and closing tags ('' if self-closing). */
  children: string;
  selfClosing: boolean;
}

export interface QButtonViolation {
  line: number;
  reason: string;
}

export interface QButtonAllowlistEntry {
  /** Path relative to src/, e.g. "screens/Create/GalleryView.tsx". */
  file: string;
  /** 1-based line of the `<QButton` opening tag. */
  line: number;
  /** Why this pre-existing usage is tolerated. New usages may not copy it. */
  reason: string;
}

/**
 * Explicit allowlist for pre-existing complex usages. Each entry is
 * per-file + per-line with a reason; the repo-scan test also fails if
 * an entry no longer matches a real violation (no stale exemptions).
 *
 * The list is EMPTY as of TRK-0498 — the one entry it ever held
 * (GalleryView's list row) was migrated to a native list-row button,
 * so an empty allowlist is the healthy state: every complex-children
 * QButton usage in src/** now fails the repo scan, no exceptions.
 */
export const QBUTTON_ALLOWLIST: QButtonAllowlistEntry[] = [];

function isQuote(ch: string): boolean {
  return ch === '"' || ch === "'" || ch === '`';
}

/** Index of the `>` that ends the tag starting at `start`, respecting {} and quotes. */
function findTagEnd(source: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote && source[i - 1] !== '\\') quote = null;
    } else if (isQuote(ch)) quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) return i;
  }
  return -1;
}

/** Index of the `}` matching the `{` at `start`, respecting quotes. */
function findBraceEnd(source: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote && source[i - 1] !== '\\') quote = null;
    } else if (isQuote(ch)) quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Remove string/template literals so `<` inside a label is not read as JSX. */
function stripStrings(source: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote && source[i - 1] !== '\\') quote = null;
    } else if (isQuote(ch)) quote = ch;
    else out += ch;
  }
  return out;
}

const JSX_RE = /<[A-Za-z][\w.]*[\s/>]|<>|<\/[A-Za-z]/;

function expressionRendersJsx(expr: string): boolean {
  return JSX_RE.test(stripStrings(expr));
}

/** Find every `<QButton ...>...</QButton>` (and self-closing) usage in a source file. */
export function findQButtonUsages(source: string): QButtonUsage[] {
  const usages: QButtonUsage[] = [];
  let idx = 0;
  while (idx < source.length) {
    const start = source.indexOf('<QButton', idx);
    if (start === -1) break;
    const after = source[start + 8] ?? '';
    if (!/[\s>/]/.test(after)) {
      idx = start + 8;
      continue;
    }
    const tagEnd = findTagEnd(source, start);
    if (tagEnd === -1) break;
    const opening = source.slice(start, tagEnd + 1);
    const line = source.slice(0, start).split('\n').length;
    if (opening.trimEnd().endsWith('/>')) {
      usages.push({ line, children: '', selfClosing: true });
      idx = tagEnd + 1;
      continue;
    }
    const close = source.indexOf('</QButton>', tagEnd);
    if (close === -1) break;
    usages.push({ line, children: source.slice(tagEnd + 1, close), selfClosing: false });
    idx = close + '</QButton>'.length;
  }
  return usages;
}

/**
 * Classify one QButton's children. Returns violation reasons; an empty
 * array means label-shaped: plain text, string/template/ternary
 * expressions producing text, self-closing icon/image elements, and
 * text-only inline <span> decorations (no nested elements).
 */
export function analyzeQButtonChildren(children: string): string[] {
  const reasons: string[] = [];
  let i = 0;
  while (i < children.length) {
    const ch = children[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '{') {
      const end = findBraceEnd(children, i);
      if (end === -1) {
        reasons.push('unbalanced expression child');
        break;
      }
      const expr = children.slice(i + 1, end);
      if (expressionRendersJsx(expr)) {
        reasons.push('expression child renders JSX (e.g. a .map() returning elements)');
      }
      i = end + 1;
      continue;
    }
    if (ch === '<') {
      if (children.startsWith('</', i)) break;
      if (children.startsWith('<>', i)) {
        const end = children.indexOf('</>', i);
        const inner = end === -1 ? children.slice(i + 2) : children.slice(i + 2, end);
        if (JSX_RE.test(stripStrings(inner)) || /<[A-Za-z]/.test(inner)) {
          reasons.push('fragment child contains elements');
        } else {
          // Fragment of pure text/expressions: recurse.
          reasons.push(...analyzeQButtonChildren(inner));
        }
        i = end === -1 ? children.length : end + 3;
        continue;
      }
      const tagMatch = /^<([A-Za-z][\w.]*)/.exec(children.slice(i));
      if (!tagMatch) {
        i++;
        continue;
      }
      const tag = tagMatch[1];
      const tagEnd = findTagEnd(children, i);
      if (tagEnd === -1) break;
      const opening = children.slice(i, tagEnd + 1);
      if (opening.trimEnd().endsWith('/>')) {
        // Self-closing icon/image slot (e.g. <Send size={18} />) — allowed.
        i = tagEnd + 1;
        continue;
      }
      // Non-self-closing element: find its matching close, counting same-tag nesting.
      const closeTag = `</${tag}>`;
      let depth = 1;
      let scan = tagEnd + 1;
      let closeIdx = -1;
      while (scan < children.length) {
        const nextOpen = children.indexOf(`<${tag}`, scan);
        const nextClose = children.indexOf(closeTag, scan);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          scan = nextOpen + tag.length + 1;
        } else {
          depth--;
          if (depth === 0) {
            closeIdx = nextClose;
            break;
          }
          scan = nextClose + closeTag.length;
        }
      }
      const inner = closeIdx === -1 ? children.slice(tagEnd + 1) : children.slice(tagEnd + 1, closeIdx);
      const innerHasElement = /<[A-Za-z][\w.]*[\s/>]|<>/.test(stripStrings(inner)) || /<[A-Za-z]/.test(inner);
      if (tag === 'span' && !innerHasElement && !expressionRendersJsx(inner)) {
        // Text-only inline span (e.g. an aria-hidden glyph) stays label-shaped.
      } else {
        reasons.push(`non-self-closing <${tag}> child is complex content, not a label`);
      }
      i = closeIdx === -1 ? children.length : closeIdx + closeTag.length;
      continue;
    }
    // Plain text run up to the next element/expression.
    let j = i;
    while (j < children.length && children[j] !== '<' && children[j] !== '{') j++;
    i = j;
  }
  return reasons;
}

/** All non-allowlisted violations in one file's source. */
export function scanQButtonSource(
  source: string,
  file: string,
  allowlist: QButtonAllowlistEntry[] = QBUTTON_ALLOWLIST,
): QButtonViolation[] {
  const violations: QButtonViolation[] = [];
  for (const usage of findQButtonUsages(source)) {
    for (const reason of analyzeQButtonChildren(usage.children)) {
      const allowed = allowlist.some((e) => e.file === file && e.line === usage.line);
      if (!allowed) violations.push({ line: usage.line, reason });
    }
  }
  return violations;
}
