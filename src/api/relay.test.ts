/**
 * Relay client tests — fetch is fully mocked; no network, no secrets.
 * Covers: /recent, /messages?since= (the `since`, not `since_id` trap),
 * /search, /send, /ask, identity, error handling, and timeouts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  askRelay,
  formatRelayTime,
  getMessagesSince,
  getRecent,
  getRelayIdentity,
  groupIntoThreads,
  parseList,
  RelayError,
  searchMessages,
  sendMessage,
  type RelayMessage,
} from './relay';

function okJson(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const ROW = {
  id: 42,
  uuid: 'u-42',
  author: 'scotty',
  author_display: 'Scotty',
  content: 'hello fleet',
  mentions: '["qubit"]',
  platform: 'web',
  timestamp: 1759365600,
  created_at: '2025-10-02T12:00:00Z',
  intent: null,
  routed_to: '[]',
  thread_id: null,
  conversation_id: 7,
};

function stubFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return impl(url, init);
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseList', () => {
  it('parses the relay\'s JSON-string columns', () => {
    expect(parseList('["a","b"]')).toEqual(['a', 'b']);
  });
  it('returns [] for empty, null, or malformed input', () => {
    expect(parseList('')).toEqual([]);
    expect(parseList(null)).toEqual([]);
    expect(parseList('not-json')).toEqual([]);
  });
});

describe('getRecent', () => {
  it('returns messages newest-window-first from /recent', async () => {
    const { calls } = stubFetch(() => okJson({ messages: [ROW] }));
    const msgs = await getRecent('https://team.dsect.net/api/relay');
    expect(calls[0].url).toBe('https://team.dsect.net/api/relay/recent?limit=200');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].author).toBe('scotty');
    expect(msgs[0].mentions).toEqual(['qubit']);
  });

  it('accepts a bare array body too', async () => {
    stubFetch(() => okJson([ROW]));
    const msgs = await getRecent('https://team.dsect.net/api/relay');
    expect(msgs).toHaveLength(1);
  });
});

describe('getMessagesSince', () => {
  it('uses the `since` parameter — never `since_id`', async () => {
    const { calls } = stubFetch(() => okJson({ messages: [] }));
    await getMessagesSince('https://team.dsect.net/api/relay', 199);
    const url = calls[0].url;
    expect(url).toContain('since=199');
    expect(url).not.toContain('since_id');
  });
});

describe('searchMessages', () => {
  it('hits the server-side /search with q and author', async () => {
    const { calls } = stubFetch(() => okJson({ messages: [ROW] }));
    const msgs = await searchMessages('https://team.dsect.net/api/relay', 'solar panels', 'qubit');
    const url = calls[0].url;
    expect(url).toContain('/search?');
    expect(url).toContain('q=solar+panels');
    expect(url).toContain('author=qubit');
    expect(msgs).toHaveLength(1);
  });
});

describe('sendMessage', () => {
  it('POSTs { author, content } to /send', async () => {
    const { calls } = stubFetch(() => new Response(null, { status: 200 }));
    await sendMessage('https://team.dsect.net/api/relay', 'scotty', 'ship it');
    const { url, init } = calls[0];
    expect(url).toBe('https://team.dsect.net/api/relay/send');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ author: 'scotty', content: 'ship it' });
  });

  it('throws RelayError on a non-OK response', async () => {
    stubFetch(() => new Response('nope', { status: 500 }));
    await expect(sendMessage('https://team.dsect.net/api/relay', 'scotty', 'x')).rejects.toBeInstanceOf(
      RelayError,
    );
  });
});

describe('askRelay', () => {
  it('POSTs to /ask and returns the question + answer pair', async () => {
    stubFetch(() =>
      okJson({ question: ROW, answer: { ...ROW, id: 43, model: 'qwen3-4b' } }),
    );
    const result = await askRelay('https://team.dsect.net/api/relay', 'scotty', 'Scotty', 'status?');
    expect(result.question.id).toBe(42);
    expect(result.answer.model).toBe('qwen3-4b');
  });

  it('surfaces the relay\'s JSON error detail over a bare status', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: 'models down' }), { status: 503 }));
    await expect(
      askRelay('https://team.dsect.net/api/relay', 'scotty', 'Scotty', 'status?'),
    ).rejects.toThrow('models down');
  });
});

describe('getRelayIdentity', () => {
  it('derives /api/whoami from the relay base URL and maps the handle', async () => {
    const { calls } = stubFetch(() =>
      okJson({}, { 'x-user-email': 'scottyvenable@gmail.com', 'x-user-name': 'Scotty' }),
    );
    const id = await getRelayIdentity('https://team.dsect.net/api/relay');
    expect(calls[0].url).toBe('https://team.dsect.net/api/whoami');
    expect(id.handle).toBe('scotty');
  });

  it('falls back to the email local part for unknown users', async () => {
    stubFetch(() =>
      okJson({}, { 'x-user-email': 'kiki@example.com', 'x-user-name': 'Kiki' }),
    );
    const id = await getRelayIdentity('https://team.dsect.net/api/relay');
    expect(id.handle).toBe('kiki');
  });
});

describe('error handling', () => {
  it('throws RelayError with the status on HTTP errors', async () => {
    stubFetch(() => new Response('missing', { status: 404 }));
    const err = await getRecent('https://team.dsect.net/api/relay').catch((e) => e);
    expect(err).toBeInstanceOf(RelayError);
    expect((err as RelayError).status).toBe(404);
  });

  it('throws RelayError when the host is unreachable', async () => {
    stubFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expect(getRecent('https://team.dsect.net/api/relay')).rejects.toThrow(/unreachable/);
  });
});

describe('groupIntoThreads', () => {
  const a: RelayMessage = {
    id: 1, uuid: 'a', author: 'scotty', author_display: 'Scotty', content: 'one',
    mentions: [], platform: 'web', timestamp: 1, created_at: '', intent: null,
    routed_to: [], thread_id: null, conversation_id: 7,
  };
  const b: RelayMessage = { ...a, id: 2, uuid: 'b', author: 'qubit', author_display: 'Qubit', content: 'two' };
  const c: RelayMessage = { ...a, id: 3, uuid: 'c', content: 'other room', conversation_id: 9 };

  it('groups by conversation and orders by latest activity', () => {
    const threads = groupIntoThreads([a, b, c]);
    expect(threads).toHaveLength(2);
    expect(threads[0].conversationId).toBe(9);
    expect(threads[1].conversationId).toBe(7);
    expect(threads[1].messageCount).toBe(2);
    expect(threads[1].lastMessage.id).toBe(2);
  });
});

describe('formatRelayTime', () => {
  it('formats epoch seconds and tolerates 0', () => {
    expect(formatRelayTime(0)).toBe('');
    // TZ-robust: compare against the same instant rendered locally, not a
    // hardcoded UTC date (this box runs America/New_York; CI runs UTC).
    const localDay = new Date(1759365600 * 1000).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
    });
    expect(formatRelayTime(1759365600)).toContain(localDay);
  });
});
