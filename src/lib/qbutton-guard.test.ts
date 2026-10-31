import { describe, expect, it } from 'vitest';
import {
  QBUTTON_ALLOWLIST,
  analyzeQButtonChildren,
  findQButtonUsages,
  scanQButtonSource,
} from './qbutton-guard';

describe('analyzeQButtonChildren (fixture cases)', () => {
  it('allows a plain text label', () => {
    expect(analyzeQButtonChildren('Save settings')).toEqual([]);
  });

  it('allows an icon plus a text label', () => {
    expect(analyzeQButtonChildren('<Send size={18} />\nSend')).toEqual([]);
    expect(analyzeQButtonChildren('<RefreshCw size={16} /> Retry')).toEqual([]);
  });

  it('allows an icon-only button', () => {
    expect(analyzeQButtonChildren('<ArrowLeft size={18} />')).toEqual([]);
  });

  it('allows string / ternary expressions producing text', () => {
    expect(analyzeQButtonChildren("{sending ? 'Sending…' : 'Send'}")).toEqual([]);
    expect(analyzeQButtonChildren('Sort · {SORT_LABEL[sortMode]}')).toEqual([]);
    expect(analyzeQButtonChildren('{changedAdvanced > 0 && ` (${changedAdvanced} changed)`}')).toEqual([]);
  });

  it('allows a text-only inline span decoration', () => {
    expect(
      analyzeQButtonChildren('<span aria-hidden="true">{showAdvanced ? \'▾\' : \'›\'} </span> Advanced options'),
    ).toEqual([]);
  });

  it('fails a div child', () => {
    expect(analyzeQButtonChildren('<div className="flex"><span>Row</span></div>')).not.toEqual([]);
  });

  it('fails an Avatar (non-self-closing component) child', () => {
    expect(analyzeQButtonChildren('<Avatar size="md">GV</Avatar> Name')).not.toEqual([]);
  });

  it('fails a span wrapping layout elements', () => {
    expect(
      analyzeQButtonChildren('<span className="flex w-full"><span className="block">Title</span></span>'),
    ).not.toEqual([]);
  });

  it('fails a fragment containing elements', () => {
    expect(analyzeQButtonChildren('<><span>One</span><span>Two</span></>')).not.toEqual([]);
  });

  it('fails an expression / map block returning JSX', () => {
    expect(analyzeQButtonChildren('{items.map((item) => <span key={item.id}>{item.label}</span>)}')).not.toEqual([]);
    expect(analyzeQButtonChildren('{open ? <span>Hide</span> : "Show"}')).not.toEqual([]);
  });
});

describe('findQButtonUsages', () => {
  it('finds paired and self-closing usages with line numbers', () => {
    const src = 'const a = 1;\n<QButton onPress={x}>Hi</QButton>\n<QButton aria-label="Back" />\n';
    const usages = findQButtonUsages(src);
    expect(usages).toHaveLength(2);
    expect(usages[0]).toMatchObject({ line: 2, children: 'Hi', selfClosing: false });
    expect(usages[1]).toMatchObject({ line: 3, selfClosing: true });
  });

  it('does not match QButton-like identifiers', () => {
    expect(findQButtonUsages('<QButtonExtra>Hi</QButtonExtra>')).toEqual([]);
  });
});

// Every src/**/*.tsx source, loaded raw through Vite (no Node types or
// new dependencies needed). Keys look like "../screens/HomeScreen.tsx".
const RAW_SOURCES = import.meta.glob<string>('../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function repoSources(): { rel: string; source: string }[] {
  return Object.entries(RAW_SOURCES)
    .map(([key, source]) => ({ rel: key.replace(/^\.\.\//, ''), source }))
    .filter(({ rel }) => !rel.includes('.test.') && !rel.includes('vendor/'));
}

describe('QButton guard — repo scan (TRK-0492)', () => {
  const files = repoSources();

  it('scans a real number of QButton usages (guard cannot silently find nothing)', () => {
    let total = 0;
    for (const { source } of files) total += findQButtonUsages(source).length;
    // 80 usages on main at 7897b1e; floor leaves room for legitimate removals.
    expect(total).toBeGreaterThanOrEqual(50);
  });

  it('passes on the current tree: every QButton has label-shaped children', () => {
    const failures: string[] = [];
    for (const { rel, source } of files) {
      for (const v of scanQButtonSource(source, rel)) {
        failures.push(`${rel}:${v.line} — ${v.reason}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('allowlist is empty — the last pre-existing complex usage was migrated (TRK-0498)', () => {
    expect(QBUTTON_ALLOWLIST).toEqual([]);
  });

  it('allowlist entries still match real violations (no stale exemptions)', () => {
    for (const entry of QBUTTON_ALLOWLIST) {
      const found = files.find(({ rel }) => rel === entry.file);
      expect(found, `allowlisted file ${entry.file} not found`).toBeTruthy();
      const raw = scanQButtonSource(found!.source, entry.file, []);
      expect(
        raw.some((v) => v.line === entry.line),
        `allowlist entry ${entry.file}:${entry.line} no longer matches a violation — remove or update it`,
      ).toBe(true);
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });
});
