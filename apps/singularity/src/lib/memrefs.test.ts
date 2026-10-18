import { describe, expect, it } from 'vitest';
import {
  appendMemoryToken,
  normalizeTags,
  parseMemoryIds,
  parseMentions,
  segmentBody,
} from './memrefs';

describe('parseMemoryIds', () => {
  it('extracts [[mem:id]] tokens in order, deduped', () => {
    expect(parseMemoryIds('see [[mem:482]] and [[mem:481]] plus [[mem:482]]')).toEqual([
      '482',
      '481',
    ]);
  });

  it('returns [] for plain text and tolerates null-ish input', () => {
    expect(parseMemoryIds('plain')).toEqual([]);
    expect(parseMemoryIds('')).toEqual([]);
  });

  it('accepts hyphen/underscore ids', () => {
    expect(parseMemoryIds('[[mem:abc-123_x]]')).toEqual(['abc-123_x']);
  });
});

describe('parseMentions', () => {
  it('extracts handles without matching emails or mid-word @', () => {
    expect(parseMentions('cc @Cooper and @qubit!')).toEqual(['cooper', 'qubit']);
    expect(parseMentions('mail scotty@dsect.net')).toEqual([]);
    expect(parseMentions('no mentions @@here')).toEqual([]);
    expect(parseMentions('x@y @ok')).toEqual(['ok']);
  });

  it('dedupes case-insensitively', () => {
    expect(parseMentions('@Cooper @cooper')).toEqual(['cooper']);
  });
});

describe('segmentBody', () => {
  it('splits text / mem / mention segments in order', () => {
    const segs = segmentBody('hi @cooper see [[mem:482]]!');
    expect(segs.map((s) => s.type)).toEqual(['text', 'mention', 'text', 'mem', 'text']);
    expect(segs[1].value).toBe('cooper');
    expect(segs[3].value).toBe('482');
  });

  it('reassembles the original body from text segments and tokens', () => {
    const body = 'start [[mem:1]] middle @ada end';
    const rebuilt = segmentBody(body)
      .map((s) => {
        if (s.type === 'mem') return `[[mem:${s.value}]]`;
        if (s.type === 'mention') return `@${s.value}`;
        return s.value;
      })
      .join('');
    expect(rebuilt).toBe(body);
  });

  it('handles a body that is only a token', () => {
    expect(segmentBody('[[mem:9]]')).toEqual([{ type: 'mem', value: '9' }]);
  });
});

describe('appendMemoryToken', () => {
  it('appends with a space and trims trailing whitespace', () => {
    expect(appendMemoryToken('hello  ', '42')).toBe('hello [[mem:42]]');
    expect(appendMemoryToken('', '42')).toBe('[[mem:42]]');
  });
});

describe('normalizeTags', () => {
  it('lowercases, strips #, dedupes, and caps at 12', () => {
    expect(normalizeTags('#Rules, rules  Agents')).toEqual(['rules', 'agents']);
    const many = Array.from({ length: 20 }, (_, i) => `t${i}`).join(',');
    expect(normalizeTags(many)).toHaveLength(12);
  });
});
