import { describe, expect, it } from 'vitest';
import { ApiError, SingularityClient, describeError } from './client';

/** Minimal fetch stub — records requests, returns canned responses. */
function stubFetch(status: number, payload: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { impl, calls };
}

describe('SingularityClient', () => {
  it('throws config error in demo mode (no base URL)', async () => {
    const client = new SingularityClient({ baseUrl: '' });
    await expect(client.feed()).rejects.toMatchObject({ code: 'config' });
  });

  it('maps HTTP statuses to error codes', async () => {
    const cases: [number, string][] = [
      [400, 'validation'],
      [401, 'auth'],
      [403, 'auth'],
      [404, 'not_found'],
      [500, 'server'],
      [418, 'http'],
    ];
    for (const [status, code] of cases) {
      const { impl } = stubFetch(status, { message: `boom ${status}` });
      const client = new SingularityClient({ baseUrl: 'http://svc', fetchImpl: impl });
      await expect(client.health()).rejects.toMatchObject({ code, status });
    }
  });

  it('maps fetch rejections to network errors', async () => {
    const impl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const client = new SingularityClient({ baseUrl: 'http://svc', fetchImpl: impl });
    await expect(client.feed()).rejects.toMatchObject({ code: 'network' });
  });

  it('attaches the bearer token and JSON content-type', async () => {
    const { impl, calls } = stubFetch(200, { posts: [], total: 0, offset: 0, limit: 20 });
    const client = new SingularityClient({
      baseUrl: 'http://svc/',
      session: { token: 'tok123', user: {} as never, expires_at: '2030-01-01' },
      fetchImpl: impl,
    });
    await client.feed();
    expect(calls[0].url).toBe('http://svc/api/v1/feed');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok123');
  });

  it('builds query strings for the feed', async () => {
    const { impl, calls } = stubFetch(200, { posts: [], total: 0, offset: 0, limit: 20 });
    const client = new SingularityClient({ baseUrl: 'http://svc', fetchImpl: impl });
    await client.feed({ kind: 'collab', tag: 'infra', limit: 5 });
    expect(calls[0].url).toBe('http://svc/api/v1/feed?kind=collab&tag=infra&limit=5');
  });

  it('parses empty 204 responses', async () => {
    const impl = (async () => new Response(null, { status: 204 })) as typeof fetch;
    const client = new SingularityClient({ baseUrl: 'http://svc', fetchImpl: impl });
    await expect(client.logout()).resolves.toBeUndefined();
  });

  it('retries are plausible only for network/timeout/server', () => {
    expect(new ApiError('network', 'x').retryable).toBe(true);
    expect(new ApiError('timeout', 'x').retryable).toBe(true);
    expect(new ApiError('server', 'x').retryable).toBe(true);
    expect(new ApiError('validation', 'x').retryable).toBe(false);
    expect(new ApiError('auth', 'x').retryable).toBe(false);
  });
});

describe('describeError', () => {
  it('produces human copy per code', () => {
    expect(describeError(new ApiError('config', 'x'))).toMatch(/service URL/i);
    expect(describeError(new ApiError('network', 'x'))).toMatch(/reach/i);
    expect(describeError(new ApiError('auth', 'x', 401))).toMatch(/sign in/i);
    expect(describeError(new ApiError('auth', 'x', 403))).toMatch(/permission/i);
    expect(describeError(new ApiError('validation', 'too long'))).toBe('too long');
    expect(describeError(new Error('plain'))).toBe('plain');
    expect(describeError('weird')).toMatch(/went wrong/);
  });
});
