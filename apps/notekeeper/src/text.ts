/**
 * Text formatting and Markdown stripping utilities for Quantum Notekeeper.
 */

/**
 * Strips common Markdown formatting and returns clean plain-text.
 * Removes headings, bold/italic, code blocks, inline backticks, blockquotes,
 * list bullets/numbers, images, and replaces links with their anchor text.
 */
export function stripMarkdown(markdown?: string | null): string {
  if (!markdown) return '';

  let text = markdown;

  // Code blocks (fenced)
  text = text.replace(/```[\s\S]*?```/g, '');

  // Inline code backticks
  text = text.replace(/`([^`]+)`/g, '$1');

  // Images: ![alt](url) -> ''
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '');

  // Links: [text](url) -> text
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // Headings: # Heading
  text = text.replace(/^#{1,6}\s+/gm, '');

  // Blockquotes: > Quote
  text = text.replace(/^>\s+/gm, '');

  // Bullet list markers: * item, - item, + item
  text = text.replace(/^[\s]*[-*+]\s+/gm, '');

  // Numbered list markers: 1. item
  text = text.replace(/^[\s]*\d+\.\s+/gm, '');

  // Bold & italic: ***text***, **text**, *text*, ___text___, __text__, _text_
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/___([^_]+)___/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');
  text = text.replace(/~~([^~]+)~~/g, '$1');

  // Horizontal rules
  text = text.replace(/^([-*_]){3,}\s*$/gm, '');

  // Collapse consecutive whitespaces and line breaks into single space
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

/**
 * Returns a clean plain-text excerpt up to maxLength characters.
 */
export function excerptText(text?: string | null, maxLength: number = 180): string {
  const plain = stripMarkdown(text);
  if (!plain) return '';
  if (plain.length <= maxLength) return plain;
  return plain.slice(0, maxLength).trim() + '…';
}
