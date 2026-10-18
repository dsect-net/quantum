/**
 * Client selftest — the "Run tests" action inside developer mode.
 *
 * Runs real checks against the client's own invariants and the live service
 * (echoing the service's own /dev/selftest). Results are shown per-check —
 * failures are reported, never thrown (developer mode is about visibility).
 */
import { parseMemoryIds, parseMentions, segmentBody } from './memrefs';
import { relativeTime, initials, compactCount } from './format';
import { ApiError, type SingularityClient } from '../api/client';

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  /** 'client' checks run in-browser; 'service' checks hit the API. */
  scope: 'client' | 'service';
}

export interface SelftestReport {
  ok: boolean;
  ran_at: string;
  checks: CheckResult[];
}

export async function runSelftest(client: SingularityClient): Promise<SelftestReport> {
  const checks: CheckResult[] = [];
  const add = (name: string, scope: CheckResult['scope'], ok: boolean, detail: string) =>
    checks.push({ name, scope, ok, detail });

  // ── Client invariants (pure logic the UI depends on) ──────────────────
  try {
    const ids = parseMemoryIds('a [[mem:1]] b [[mem:2]] c [[mem:1]]');
    add('memrefs.parse', 'client', ids.length === 2 && ids[0] === '1' && ids[1] === '2', `ids=${ids.join(',')}`);
  } catch (err) {
    add('memrefs.parse', 'client', false, (err as Error).message);
  }

  try {
    const segs = segmentBody('hi @cooper see [[mem:482]]');
    const kinds = segs.map((s) => s.type).join(',');
    add(
      'memrefs.segments',
      'client',
      kinds === 'text,mention,text,mem',
      `segments=${kinds}`,
    );
  } catch (err) {
    add('memrefs.segments', 'client', false, (err as Error).message);
  }

  try {
    const mentions = parseMentions('cc @scotty and @qubit');
    add('memrefs.mentions', 'client', mentions.join(',') === 'scotty,qubit', `mentions=${mentions.join(',')}`);
  } catch (err) {
    add('memrefs.mentions', 'client', false, (err as Error).message);
  }

  try {
    const ok =
      relativeTime(new Date(Date.now() - 90_000).toISOString()) === '1m' &&
      initials('Ada Lovelace') === 'AL' &&
      compactCount(1500) === '1.5k';
    add('format.helpers', 'client', ok, ok ? 'relativeTime/initials/compactCount' : 'helper mismatch');
  } catch (err) {
    add('format.helpers', 'client', false, (err as Error).message);
  }

  try {
    const storageKey = 'singularity.selftest-probe';
    window.localStorage.setItem(storageKey, '1');
    const roundTrip = window.localStorage.getItem(storageKey) === '1';
    window.localStorage.removeItem(storageKey);
    add('storage.available', 'client', roundTrip, roundTrip ? 'localStorage writable' : 'storage unavailable');
  } catch (err) {
    add('storage.available', 'client', false, (err as Error).message);
  }

  // ── Service checks (real network calls) ───────────────────────────────
  if (!client.isConfigured) {
    add('service.reachable', 'service', false, 'No service URL configured — demo mode');
  } else {
    try {
      const health = await client.health();
      add(
        'service.reachable',
        'service',
        health.status === 'ok',
        `schema=${health.schema_version} memory_source=${health.memory_source}`,
      );
    } catch (err) {
      add(
        'service.reachable',
        'service',
        false,
        err instanceof ApiError ? `${err.code}: ${err.message}` : String(err),
      );
    }

    try {
      const serviceReport = await client.devSelftest();
      for (const check of serviceReport.checks) {
        add(`service.${check.name}`, 'service', check.ok, check.detail);
      }
    } catch (err) {
      add(
        'service.selftest',
        'service',
        false,
        err instanceof ApiError ? `${err.code}: ${err.message}` : String(err),
      );
    }
  }

  return {
    ok: checks.every((c) => c.ok),
    ran_at: new Date().toISOString(),
    checks,
  };
}
